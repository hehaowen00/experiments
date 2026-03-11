package pubsub

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

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
//	GET  /stats           — node stats as JSON
type Gateway struct {
	node    *Node
	history HistoryProvider
	mux     *http.ServeMux
}

// GatewayOption configures a Gateway.
type GatewayOption func(*Gateway)

// WithHistory sets a history provider for the gateway.
func WithHistory(hp HistoryProvider) GatewayOption {
	return func(gw *Gateway) { gw.history = hp }
}

// NewGateway creates an HTTP gateway for the given node.
func NewGateway(node *Node, opts ...GatewayOption) *Gateway {
	gw := &Gateway{node: node, mux: http.NewServeMux()}
	for _, o := range opts {
		o(gw)
	}
	gw.mux.HandleFunc("POST /publish", gw.handlePublish)
	gw.mux.HandleFunc("POST /request", gw.handleRequest)
	gw.mux.HandleFunc("GET /subscribe", gw.handleSubscribe)
	gw.mux.HandleFunc("GET /stats", gw.handleStats)
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
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(gw.node.Stats())
}

// --- GET /subscribe (WebSocket) ---
//
// Query params:
//   - topic (required): topic to subscribe to
//   - id (optional): subscriber ID, auto-generated if empty
//
// Server pushes messages as JSON. Client can send:
//
//	{"action":"publish", "topic":"...", "payload":{...}}
//	{"action":"ack", "topic":"...", "payload":{"message_id":"..."}}
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

	var writeMu sync.Mutex
	writeJSON := func(v any) error {
		writeMu.Lock()
		defer writeMu.Unlock()
		return conn.WriteJSON(v)
	}

	type sub struct {
		topic string
		subID string
	}
	var subs []sub
	var subsMu sync.Mutex

	cleanup := func() {
		subsMu.Lock()
		defer subsMu.Unlock()
		for _, s := range subs {
			gw.node.Unsubscribe(s.topic, s.subID)
		}
	}
	defer cleanup()

	// Helper to subscribe to a topic
	doSubscribe := func(t string) error {
		// Send history before subscribing to live messages
		if gw.history != nil {
			if msgs := gw.history.Recent(t, 100); len(msgs) > 0 {
				writeJSON(wsServerMessage{
					Type:     "history",
					Topic:    t,
					Messages: msgs,
				})
			}
		}

		subID := fmt.Sprintf("%s:%s", clientID, t)
		err := gw.node.Subscribe(t, subID, func(ctx context.Context, m *Message) error {
			return writeJSON(wsServerMessage{
				Type:        "message",
				ID:          m.ID,
				Source:      m.Source,
				Destination: m.Destination,
				Payload:     m.Payload,
				Timestamp:   m.Timestamp,
				ReplyTo:     m.ReplyTo,
			})
		})
		if err != nil {
			return err
		}
		subsMu.Lock()
		subs = append(subs, sub{t, subID})
		subsMu.Unlock()
		return nil
	}

	// Subscribe to the initial topic
	if err := doSubscribe(topic); err != nil {
		writeJSON(wsServerMessage{Type: "error", Error: err.Error()})
		return
	}
	writeJSON(wsServerMessage{Type: "subscribed", Topic: topic})

	// Read client messages
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}

		var msg wsClientMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			writeJSON(wsServerMessage{Type: "error", Error: "invalid JSON"})
			continue
		}

		switch msg.Action {
		case "subscribe":
			if err := doSubscribe(msg.Topic); err != nil {
				writeJSON(wsServerMessage{Type: "error", Error: err.Error()})
				continue
			}
			writeJSON(wsServerMessage{Type: "subscribed", Topic: msg.Topic})

		case "unsubscribe":
			subID := fmt.Sprintf("%s:%s", clientID, msg.Topic)
			gw.node.Unsubscribe(msg.Topic, subID)
			subsMu.Lock()
			for i, s := range subs {
				if s.subID == subID {
					subs = append(subs[:i], subs[i+1:]...)
					break
				}
			}
			subsMu.Unlock()
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
