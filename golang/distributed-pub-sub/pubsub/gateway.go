package pubsub

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"distributed-pub-sub/pubsub/storage"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Gateway provides an HTTP and WebSocket API on top of a Node.
type Gateway struct {
	node       *Node
	upgrader   websocket.Upgrader
	promRegistry *prometheus.Registry
}

// NewGateway creates a Gateway wrapping the given Node.
func NewGateway(node *Node) *Gateway {
	reg := prometheus.NewRegistry()
	reg.MustRegister(collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	reg.MustRegister(collectors.NewGoCollector())
	reg.MustRegister(newStatsCollector(&node.stats))

	return &Gateway{
		node: node,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		promRegistry: reg,
	}
}

// Handler returns an http.Handler with all gateway routes registered.
func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", g.handleHealth)
	mux.HandleFunc("/publish", g.handlePublish)
	mux.HandleFunc("/subscribe", g.handleSubscribe)
	mux.HandleFunc("/request", g.handleRequest)
	mux.HandleFunc("/ws", g.handleWS)
	mux.HandleFunc("/dlq/", g.handleDLQ)
	mux.HandleFunc("/services", g.handleServices)
	mux.HandleFunc("/topics/", g.handleTopics)
	mux.HandleFunc("/svc/", g.handleSvc)
	mux.HandleFunc("/routes", g.handleRoutes)
	mux.Handle("/metrics", promhttp.HandlerFor(g.promRegistry, promhttp.HandlerOpts{}))
	return mux
}

// --- Health ---

func (g *Gateway) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	stats := g.node.GetStats()
	resp := map[string]interface{}{
		"status":  "ok",
		"node_id": g.node.opts.NodeID,
		"stats":   stats,
	}
	writeJSON(w, http.StatusOK, resp)
}

// --- Publish ---

type publishRequest struct {
	Topic   string `json:"topic"`
	Payload string `json:"payload"` // base64-encoded
	ReplyTo string `json:"reply_to"`
}

type publishResponse struct {
	ID string `json:"id"`
}

func (g *Gateway) handlePublish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req publishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	payload, err := base64.StdEncoding.DecodeString(req.Payload)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid base64 payload"})
		return
	}

	msg := &Message{
		ID:          uuid.New().String(),
		Source:      g.node.opts.NodeID,
		Destination: req.Topic,
		Payload:     payload,
		Timestamp:   time.Now().UnixNano(),
		ReplyTo:     req.ReplyTo,
	}

	if err := g.node.Publish(msg); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, publishResponse{ID: msg.ID})
}

// --- Subscribe (WebSocket per-topic) ---

func (g *Gateway) handleSubscribe(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	topic := r.URL.Query().Get("topic")
	if topic == "" {
		http.Error(w, "missing topic query parameter", http.StatusBadRequest)
		return
	}

	conn, err := g.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return // Upgrade writes the error response
	}
	defer conn.Close()

	subID, err := g.node.Subscribe(topic, func(msg *Message) error {
		data := wsMessage{
			Type:     "message",
			Topic:    msg.Destination,
			Payload:  base64.StdEncoding.EncodeToString(msg.Payload),
			ID:       msg.ID,
			ReplyTo:  msg.ReplyTo,
			StreamID: msg.StreamID,
		}
		return conn.WriteJSON(data)
	})
	if err != nil {
		conn.WriteJSON(wsMessage{Type: "error", Message: err.Error()})
		return
	}
	defer g.node.Unsubscribe(subID)

	// Block until the client disconnects.
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

// --- Request-Response ---

type requestReq struct {
	Topic   string `json:"topic"`
	Payload string `json:"payload"` // base64
	Timeout string `json:"timeout"` // e.g. "5s"
}

func (g *Gateway) handleRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req requestReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	payload, err := base64.StdEncoding.DecodeString(req.Payload)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid base64 payload"})
		return
	}

	timeout := 5 * time.Second
	if req.Timeout != "" {
		if d, err := time.ParseDuration(req.Timeout); err == nil {
			timeout = d
		}
	}

	resp, err := g.node.Request(r.Context(), req.Topic, payload, timeout)
	if err != nil {
		writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, wsMessage{
		Type:    "response",
		ID:      resp.ID,
		Payload: base64.StdEncoding.EncodeToString(resp.Payload),
	})
}

// --- Full bidirectional WebSocket ---

type wsMessage struct {
	Type     string `json:"type"`
	Topic    string `json:"topic,omitempty"`
	Payload  string `json:"payload,omitempty"`
	ID       string `json:"id,omitempty"`
	ReplyTo  string `json:"reply_to,omitempty"`
	StreamID string `json:"stream_id,omitempty"`
	Timeout  string `json:"timeout,omitempty"`
	Message  string `json:"message,omitempty"`
}

func (g *Gateway) handleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := g.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var wsMu sync.Mutex
	writeJSON := func(v interface{}) error {
		wsMu.Lock()
		defer wsMu.Unlock()
		return conn.WriteJSON(v)
	}

	subs := make(map[string]string)     // subID -> topic (for cleanup)
	streams := make(map[string]*Stream) // streamID -> *Stream

	defer func() {
		for subID := range subs {
			g.node.Unsubscribe(subID)
		}
		for _, s := range streams {
			s.Close()
		}
	}()

	for {
		var cmd wsMessage
		if err := conn.ReadJSON(&cmd); err != nil {
			break
		}

		switch cmd.Type {
		case "subscribe":
			subID, err := g.node.Subscribe(cmd.Topic, func(msg *Message) error {
				return writeJSON(wsMessage{
					Type:     "message",
					Topic:    msg.Destination,
					Payload:  base64.StdEncoding.EncodeToString(msg.Payload),
					ID:       msg.ID,
					ReplyTo:  msg.ReplyTo,
					StreamID: msg.StreamID,
				})
			})
			if err != nil {
				writeJSON(wsMessage{Type: "error", Message: err.Error()})
				continue
			}
			subs[subID] = cmd.Topic
			writeJSON(wsMessage{Type: "response", ID: subID, Message: "subscribed"})

		case "unsubscribe":
			if err := g.node.Unsubscribe(cmd.ID); err != nil {
				writeJSON(wsMessage{Type: "error", Message: err.Error()})
				continue
			}
			delete(subs, cmd.ID)
			writeJSON(wsMessage{Type: "response", ID: cmd.ID, Message: "unsubscribed"})

		case "publish":
			payload, err := base64.StdEncoding.DecodeString(cmd.Payload)
			if err != nil {
				writeJSON(wsMessage{Type: "error", Message: "invalid base64 payload"})
				continue
			}
			msg := &Message{
				ID:          uuid.New().String(),
				Source:      g.node.opts.NodeID,
				Destination: cmd.Topic,
				Payload:     payload,
				Timestamp:   time.Now().UnixNano(),
			}
			if err := g.node.Publish(msg); err != nil {
				writeJSON(wsMessage{Type: "error", Message: err.Error()})
				continue
			}
			writeJSON(wsMessage{Type: "response", ID: msg.ID})

		case "request":
			payload, err := base64.StdEncoding.DecodeString(cmd.Payload)
			if err != nil {
				writeJSON(wsMessage{Type: "error", Message: "invalid base64 payload"})
				continue
			}
			timeout := 5 * time.Second
			if cmd.Timeout != "" {
				if d, err := time.ParseDuration(cmd.Timeout); err == nil {
					timeout = d
				}
			}
			go func() {
				resp, err := g.node.Request(r.Context(), cmd.Topic, payload, timeout)
				if err != nil {
					writeJSON(wsMessage{Type: "error", Message: err.Error()})
					return
				}
				writeJSON(wsMessage{
					Type:    "response",
					ID:      resp.ID,
					Payload: base64.StdEncoding.EncodeToString(resp.Payload),
				})
			}()

		case "stream_open":
			streamID := cmd.StreamID
			if streamID == "" {
				streamID = uuid.New().String()
			}
			s, err := g.node.OpenStream(cmd.Topic)
			if err != nil {
				writeJSON(wsMessage{Type: "error", Message: err.Error()})
				continue
			}
			s.ID = streamID
			streams[streamID] = s
			// Forward incoming stream messages to the WS client.
			go func(st *Stream) {
				for {
					msg, err := st.Receive()
					if err != nil {
						return
					}
					writeJSON(wsMessage{
						Type:     "message",
						Topic:    msg.Destination,
						Payload:  base64.StdEncoding.EncodeToString(msg.Payload),
						ID:       msg.ID,
						StreamID: st.ID,
					})
				}
			}(s)
			writeJSON(wsMessage{Type: "response", StreamID: streamID, Message: "stream_opened"})

		case "stream_data":
			s, ok := streams[cmd.StreamID]
			if !ok {
				writeJSON(wsMessage{Type: "error", Message: "unknown stream_id"})
				continue
			}
			payload, err := base64.StdEncoding.DecodeString(cmd.Payload)
			if err != nil {
				writeJSON(wsMessage{Type: "error", Message: "invalid base64 payload"})
				continue
			}
			if err := s.Send(payload); err != nil {
				writeJSON(wsMessage{Type: "error", Message: err.Error()})
			}

		case "stream_close":
			s, ok := streams[cmd.StreamID]
			if !ok {
				writeJSON(wsMessage{Type: "error", Message: "unknown stream_id"})
				continue
			}
			s.Close()
			delete(streams, cmd.StreamID)
			writeJSON(wsMessage{Type: "response", StreamID: cmd.StreamID, Message: "stream_closed"})

		case "history":
			msgs := g.node.History(cmd.Topic, 100)
			var items []wsMessage
			for _, msg := range msgs {
				items = append(items, wsMessage{
					Type:    "message",
					Topic:   msg.Destination,
					Payload: base64.StdEncoding.EncodeToString(msg.Payload),
					ID:      msg.ID,
				})
			}
			data, _ := json.Marshal(items)
			writeJSON(wsMessage{
				Type:    "response",
				Topic:   cmd.Topic,
				Payload: base64.StdEncoding.EncodeToString(data),
				Message: "history",
			})

		default:
			writeJSON(wsMessage{Type: "error", Message: fmt.Sprintf("unknown command type: %s", cmd.Type)})
		}
	}
}

// --- DLQ handlers ---

func (g *Gateway) handleDLQ(w http.ResponseWriter, r *http.Request) {
	// Parse topic from path: /dlq/{topic} or /dlq/{topic}/retry
	path := strings.TrimPrefix(r.URL.Path, "/dlq/")
	if path == "" {
		http.Error(w, "missing topic in path", http.StatusBadRequest)
		return
	}

	isRetry := strings.HasSuffix(path, "/retry")
	topic := strings.TrimSuffix(path, "/retry")

	dlq := g.node.GetDLQStore()
	if dlq == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "DLQ store not configured"})
		return
	}

	switch {
	case r.Method == http.MethodGet && !isRetry:
		g.handleDLQList(w, r, dlq, topic)

	case r.Method == http.MethodPost && isRetry:
		g.handleDLQRetry(w, r, dlq)

	case r.Method == http.MethodDelete && !isRetry:
		g.handleDLQPurge(w, dlq, topic)

	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (g *Gateway) handleDLQList(w http.ResponseWriter, r *http.Request, dlq storage.DLQStore, topic string) {
	limit := queryInt(r, "limit", 50)
	offset := queryInt(r, "offset", 0)
	letters, err := dlq.List(topic, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, letters)
}

func (g *Gateway) handleDLQRetry(w http.ResponseWriter, r *http.Request, dlq storage.DLQStore) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	msg, err := dlq.Retry(req.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	pubMsg := &Message{
		ID:          msg.ID,
		Source:      msg.Source,
		Destination: msg.Destination,
		Payload:     msg.Payload,
		Timestamp:   msg.Timestamp,
		Sequence:    msg.Sequence,
		ReplyTo:     msg.ReplyTo,
		StreamID:    msg.StreamID,
		Attempt:     msg.Attempt,
	}
	if err := g.node.Publish(pubMsg); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "retried", "id": msg.ID})
}

func (g *Gateway) handleDLQPurge(w http.ResponseWriter, dlq storage.DLQStore, topic string) {
	count, err := dlq.Purge(topic)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "purged", "count": count})
}

// --- Services ---

func (g *Gateway) handleServices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, g.node.GetServices())
}

// --- Routes ---

func (g *Gateway) handleRoutes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Collect service names from the local registry.
	allSvcs := g.node.GetServices()
	var services []string
	if local, ok := allSvcs[g.node.opts.NodeID]; ok {
		for svc := range local {
			services = append(services, svc)
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"node_id":  g.node.opts.NodeID,
		"topics":   g.node.Topics(),
		"services": services,
	})
}

// --- Helpers ---

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func queryInt(r *http.Request, key string, defaultVal int) int {
	s := r.URL.Query().Get(key)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return defaultVal
	}
	return v
}

// --- URL-based topic routing ---

// topicMessage is the JSON format for /topics/ WebSocket messages.
// Payloads are raw JSON (not base64).
type topicMessage struct {
	Type     string          `json:"type"`
	Topic    string          `json:"topic,omitempty"`
	Payload  json.RawMessage `json:"payload,omitempty"`
	ID       string          `json:"id,omitempty"`
	ReplyTo  string          `json:"reply_to,omitempty"`
	StreamID string          `json:"stream_id,omitempty"`
	Message  string          `json:"message,omitempty"`
}

// handleTopics handles /topics/{topic} requests.
// GET upgrades to WebSocket and auto-subscribes. POST publishes a message.
func (g *Gateway) handleTopics(w http.ResponseWriter, r *http.Request) {
	topic := strings.TrimPrefix(r.URL.Path, "/topics/")
	if topic == "" {
		http.Error(w, "missing topic in path", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		g.handleTopicWS(w, r, topic)
	case http.MethodPost:
		g.handleTopicPublish(w, r, topic)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleTopicPublish handles POST /topics/{topic} — REST publish.
func (g *Gateway) handleTopicPublish(w http.ResponseWriter, r *http.Request, topic string) {
	var req struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	msg := &Message{
		ID:          uuid.New().String(),
		Source:      g.node.opts.NodeID,
		Destination: topic,
		Payload:     req.Payload,
		Timestamp:   time.Now().UnixNano(),
	}

	if err := g.node.Publish(msg); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, publishResponse{ID: msg.ID})
}

// handleTopicWS handles GET /topics/{topic} — WebSocket subscribe with history replay.
func (g *Gateway) handleTopicWS(w http.ResponseWriter, r *http.Request, topic string) {
	conn, err := g.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	var wsMu sync.Mutex
	wsWrite := func(v interface{}) error {
		wsMu.Lock()
		defer wsMu.Unlock()
		return conn.WriteJSON(v)
	}

	subID, err := g.node.Subscribe(topic, func(msg *Message) error {
		return wsWrite(topicMessage{
			Type:     "message",
			Topic:    msg.Destination,
			Payload:  json.RawMessage(msg.Payload),
			ID:       msg.ID,
			ReplyTo:  msg.ReplyTo,
			StreamID: msg.StreamID,
		})
	})
	if err != nil {
		conn.WriteJSON(topicMessage{Type: "error", Message: err.Error()})
		return
	}
	defer g.node.Unsubscribe(subID)

	// Read loop: client can publish by sending JSON with payload.
	for {
		var cmd topicMessage
		if err := conn.ReadJSON(&cmd); err != nil {
			break
		}
		if len(cmd.Payload) > 0 {
			msg := &Message{
				ID:          uuid.New().String(),
				Source:      g.node.opts.NodeID,
				Destination: topic,
				Payload:     cmd.Payload,
				Timestamp:   time.Now().UnixNano(),
			}
			if err := g.node.Publish(msg); err != nil {
				wsWrite(topicMessage{Type: "error", Message: err.Error()})
				continue
			}
			wsWrite(topicMessage{Type: "response", ID: msg.ID})
		}
	}
}

// --- URL-based service routing ---

// serviceRequest mirrors service.Request to avoid import cycle.
type serviceRequest struct {
	Service string          `json:"service"`
	Method  string          `json:"method"`
	Payload json.RawMessage `json:"payload"`
}

// handleSvc handles POST /svc/{service}/{method} — REST request-response to a service.
func (g *Gateway) handleSvc(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse /svc/{service}/{method}
	path := strings.TrimPrefix(r.URL.Path, "/svc/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		http.Error(w, "path must be /svc/{service}/{method}", http.StatusBadRequest)
		return
	}
	svcName := parts[0]
	method := parts[1]

	var req struct {
		Payload json.RawMessage `json:"payload"`
		Timeout string          `json:"timeout"` // e.g. "5s"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	// Build a service request (same JSON format as service.Request).
	svcReq := serviceRequest{
		Service: svcName,
		Method:  method,
		Payload: req.Payload,
	}
	svcReqData, err := json.Marshal(svcReq)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to encode service request"})
		return
	}

	timeout := 5 * time.Second
	if req.Timeout != "" {
		if d, err := time.ParseDuration(req.Timeout); err == nil {
			timeout = d
		}
	}

	topic := fmt.Sprintf("svc.%s", svcName)
	resp, err := g.node.Request(r.Context(), topic, svcReqData, timeout)
	if err != nil {
		writeJSON(w, http.StatusGatewayTimeout, map[string]string{"error": err.Error()})
		return
	}

	// Try to return payload as raw JSON; if it's not valid JSON, wrap it as a string.
	if json.Valid(resp.Payload) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"payload":%s}`, resp.Payload)
	} else {
		writeJSON(w, http.StatusOK, map[string]string{
			"payload": string(resp.Payload),
		})
	}
}
