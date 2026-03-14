package pubsub

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// HistoryProvider returns recent messages for a topic. Implement this
// to back the gateway with a database or in-memory store.
type HistoryProvider interface {
	// Recent returns up to limit messages for the topic, in chronological order.
	Recent(topic string, limit int) []*Message
}

// Gateway exposes a Node over HTTP. Use it as an http.Handler.
//
// Routes:
//
//	POST /publish         — publish a message
//	POST /request         — request-response (blocks until reply)
//	GET  /subscribe       — WebSocket: stream messages + send publishes/acks
//	GET  /stats           — node stats + topology as JSON
//	GET  /topics          — topic subscriber counts
//	GET  /peers           — connected peer info
//	GET  /sessions        — active gateway sessions
type Gateway struct {
	node    *Node
	history HistoryProvider
	mux     *http.ServeMux

	sessionMu  sync.Mutex
	sessions   map[string]*gwSession // clientID -> session
	sessionTTL time.Duration         // how long sessions survive without a WS connection
}

// gwSession tracks a client's subscriptions across WebSocket reconnects.
type gwSession struct {
	id        string
	topics    map[string]struct{} // subscribed topics
	expiresAt time.Time           // when to clean up if no WS is attached

	mu      sync.Mutex
	conn    *websocket.Conn // current WS connection, nil if disconnected
	writeMu sync.Mutex      // serializes writes to conn
}

// GatewayOption configures a Gateway.
type GatewayOption func(*Gateway)

// WithHistory sets a history provider for the gateway.
func WithHistory(hp HistoryProvider) GatewayOption {
	return func(gw *Gateway) { gw.history = hp }
}

// WithSessionTTL sets how long sessions persist after WebSocket disconnect.
// Default is 60 seconds.
func WithSessionTTL(d time.Duration) GatewayOption {
	return func(gw *Gateway) { gw.sessionTTL = d }
}

// NewGateway creates an HTTP gateway for the given node.
func NewGateway(node *Node, opts ...GatewayOption) *Gateway {
	gw := &Gateway{
		node:       node,
		mux:        http.NewServeMux(),
		sessions:   make(map[string]*gwSession),
		sessionTTL: 60 * time.Second,
	}
	for _, o := range opts {
		o(gw)
	}
	gw.mux.HandleFunc("POST /publish", gw.handlePublish)
	gw.mux.HandleFunc("POST /request", gw.handleRequest)
	gw.mux.HandleFunc("GET /subscribe", gw.handleSubscribe)
	gw.mux.HandleFunc("GET /stats", gw.handleStats)
	gw.mux.HandleFunc("GET /topics", gw.handleTopics)
	gw.mux.HandleFunc("GET /peers", gw.handlePeers)
	gw.mux.HandleFunc("GET /sessions", gw.handleSessions)

	go gw.sessionCleanupLoop()

	return gw
}

func (gw *Gateway) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	gw.mux.ServeHTTP(w, r)
}

// --- POST /publish ---

type publishRequest struct {
	Source  string          `json:"source"`
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload"`
}

type publishResponse struct {
	ID string `json:"id"`
}

func (gw *Gateway) handlePublish(w http.ResponseWriter, r *http.Request) {
	var req publishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	if req.Source == "" || req.Topic == "" {
		http.Error(w, `{"error":"source and topic required"}`, http.StatusBadRequest)
		return
	}

	id, err := gw.node.Publish(r.Context(), req.Source, req.Topic, req.Payload)
	if err != nil {
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(publishResponse{ID: id})
}

// --- POST /request ---

type rpcRequest struct {
	Source  string          `json:"source"`
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload"`
}

func (gw *Gateway) handleRequest(w http.ResponseWriter, r *http.Request) {
	var req rpcRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	if req.Source == "" || req.Topic == "" {
		http.Error(w, `{"error":"source and topic required"}`, http.StatusBadRequest)
		return
	}

	reply, err := gw.node.Request(r.Context(), req.Source, req.Topic, req.Payload)
	if err != nil {
		w.WriteHeader(http.StatusGatewayTimeout)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(reply)
}

// --- GET /stats ---

func (gw *Gateway) handleStats(w http.ResponseWriter, r *http.Request) {
	snap := gw.node.Stats()
	topics := gw.node.TopicSubscriberCounts()
	peers := gw.node.PeerInfo()

	gw.sessionMu.Lock()
	activeSessions := len(gw.sessions)
	gw.sessionMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"counters":        snap,
		"topics":          topics,
		"peer_count":      len(peers),
		"active_sessions": activeSessions,
	})
}

// --- GET /topics ---

func (gw *Gateway) handleTopics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gw.node.TopicSubscriberCounts())
}

// --- GET /peers ---

func (gw *Gateway) handlePeers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gw.node.PeerInfo())
}

// --- GET /sessions ---

func (gw *Gateway) handleSessions(w http.ResponseWriter, r *http.Request) {
	gw.sessionMu.Lock()
	type sessionInfo struct {
		ID        string   `json:"id"`
		Topics    []string `json:"topics"`
		Connected bool     `json:"connected"`
	}
	result := make([]sessionInfo, 0, len(gw.sessions))
	for _, s := range gw.sessions {
		s.mu.Lock()
		connected := s.conn != nil
		topics := make([]string, 0, len(s.topics))
		for t := range s.topics {
			topics = append(topics, t)
		}
		s.mu.Unlock()
		result = append(result, sessionInfo{
			ID:        s.id,
			Topics:    topics,
			Connected: connected,
		})
	}
	gw.sessionMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// --- GET /subscribe (WebSocket) ---
//
// Query params:
//   - topic (required): initial topic to subscribe to
//   - id (optional): client ID for session resumption, auto-generated if empty
//
// Server pushes messages as JSON. Client can send:
//
//	{"action":"publish", "topic":"...", "payload":{...}}
//	{"action":"subscribe", "topic":"..."}
//	{"action":"unsubscribe", "topic":"..."}

type wsClientMessage struct {
	Action  string          `json:"action"`
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type wsServerMessage struct {
	Type        string          `json:"type"`
	ID          string          `json:"id,omitempty"`
	Source      string          `json:"source,omitempty"`
	Destination string          `json:"destination,omitempty"`
	Payload     json.RawMessage `json:"payload,omitempty"`
	Timestamp   int64           `json:"timestamp,omitempty"`
	ReplyTo     string          `json:"reply_to,omitempty"`
	Topic       string          `json:"topic,omitempty"`
	Error       string          `json:"error,omitempty"`
	Messages    []*Message      `json:"messages,omitempty"`
}

func (gw *Gateway) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	topic := r.URL.Query().Get("topic")
	if topic == "" {
		http.Error(w, `{"error":"topic query param required"}`, http.StatusBadRequest)
		return
	}

	clientID := r.URL.Query().Get("id")
	if clientID == "" {
		clientID = uuid.New().String()
	}

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("gateway: websocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Keepalive: send pings every 30s, expect pong within 40s
	conn.SetReadDeadline(time.Now().Add(40 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(40 * time.Second))
		return nil
	})

	// Get or create session
	sess := gw.getOrCreateSession(clientID)

	// Attach this WS connection to the session
	sess.mu.Lock()
	sess.conn = conn
	sess.mu.Unlock()

	// Ping goroutine
	pingDone := make(chan struct{})
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				sess.writeMu.Lock()
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				err := conn.WriteMessage(websocket.PingMessage, nil)
				sess.writeMu.Unlock()
				if err != nil {
					return
				}
			case <-pingDone:
				return
			}
		}
	}()
	defer close(pingDone)

	writeJSON := func(v any) error {
		sess.writeMu.Lock()
		defer sess.writeMu.Unlock()
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteJSON(v)
	}

	// Subscribe to initial topic (if not already subscribed via session)
	gw.sessionSubscribe(sess, topic, writeJSON)
	writeJSON(wsServerMessage{Type: "subscribed", Topic: topic})

	// Read client messages
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			// Detach WS from session (session stays alive for TTL)
			sess.mu.Lock()
			if sess.conn == conn {
				sess.conn = nil
			}
			sess.expiresAt = time.Now().Add(gw.sessionTTL)
			sess.mu.Unlock()
			return
		}

		var msg wsClientMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			writeJSON(wsServerMessage{Type: "error", Error: "invalid JSON"})
			continue
		}

		switch msg.Action {
		case "subscribe":
			gw.sessionSubscribe(sess, msg.Topic, writeJSON)
			writeJSON(wsServerMessage{Type: "subscribed", Topic: msg.Topic})

		case "unsubscribe":
			gw.sessionUnsubscribe(sess, msg.Topic)
			writeJSON(wsServerMessage{Type: "unsubscribed", Topic: msg.Topic})

		case "publish":
			if _, err := gw.node.Publish(r.Context(), clientID, msg.Topic, msg.Payload); err != nil {
				writeJSON(wsServerMessage{Type: "error", Error: err.Error()})
			}

		default:
			writeJSON(wsServerMessage{Type: "error", Error: "unknown action: " + msg.Action})
		}
	}
}

// getOrCreateSession returns the existing session for clientID, or creates a new one.
func (gw *Gateway) getOrCreateSession(clientID string) *gwSession {
	gw.sessionMu.Lock()
	defer gw.sessionMu.Unlock()

	if s, ok := gw.sessions[clientID]; ok {
		return s
	}

	s := &gwSession{
		id:     clientID,
		topics: make(map[string]struct{}),
	}
	gw.sessions[clientID] = s
	return s
}

// sessionSubscribe subscribes the session to a topic if not already subscribed.
func (gw *Gateway) sessionSubscribe(sess *gwSession, topic string, writeJSON func(any) error) {
	sess.mu.Lock()
	if _, ok := sess.topics[topic]; ok {
		sess.mu.Unlock()
		return
	}
	sess.topics[topic] = struct{}{}
	sess.mu.Unlock()

	// Send history before subscribing to live messages
	if gw.history != nil {
		if msgs := gw.history.Recent(topic, 100); len(msgs) > 0 {
			writeJSON(wsServerMessage{
				Type:     "history",
				Topic:    topic,
				Messages: msgs,
			})
		}
	}

	subID := fmt.Sprintf("%s:%s", sess.id, topic)
	gw.node.Subscribe(topic, subID, func(ctx context.Context, m *Message) error {
		sess.mu.Lock()
		c := sess.conn
		sess.mu.Unlock()

		if c == nil {
			return nil // no WS attached — drop (client uses catchup on reconnect)
		}

		sess.writeMu.Lock()
		defer sess.writeMu.Unlock()
		c.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return c.WriteJSON(wsServerMessage{
			Type:        "message",
			ID:          m.ID,
			Source:      m.Source,
			Destination: m.Destination,
			Payload:     m.Payload,
			Timestamp:   m.Timestamp,
			ReplyTo:     m.ReplyTo,
		})
	})
}

// sessionUnsubscribe removes a topic from the session and unsubscribes from the node.
func (gw *Gateway) sessionUnsubscribe(sess *gwSession, topic string) {
	sess.mu.Lock()
	delete(sess.topics, topic)
	sess.mu.Unlock()

	subID := fmt.Sprintf("%s:%s", sess.id, topic)
	gw.node.Unsubscribe(topic, subID)
}

// sessionCleanupLoop removes expired sessions that have no connected WebSocket.
func (gw *Gateway) sessionCleanupLoop() {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		now := time.Now()
		gw.sessionMu.Lock()
		for id, s := range gw.sessions {
			s.mu.Lock()
			expired := s.conn == nil && !s.expiresAt.IsZero() && now.After(s.expiresAt)
			var topics []string
			if expired {
				for t := range s.topics {
					topics = append(topics, t)
				}
			}
			s.mu.Unlock()

			if expired {
				for _, t := range topics {
					subID := fmt.Sprintf("%s:%s", id, t)
					gw.node.Unsubscribe(t, subID)
				}
				delete(gw.sessions, id)
			}
		}
		gw.sessionMu.Unlock()
	}
}
