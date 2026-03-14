package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// RemoteTransport connects to a pubsub mesh node's HTTP/WebSocket gateway.
// Applications use this to talk to the mesh without embedding a pubsub.Node.
//
// If the WebSocket connection drops, the transport automatically reconnects
// and re-subscribes to all topics. Callers can register a callback via
// OnReconnect to perform recovery (e.g. fetch missed messages).
type RemoteTransport struct {
	urls []string // gateway URLs, e.g. ["http://localhost:8080", "http://localhost:8081"]
	url  string   // currently connected URL

	mu       sync.Mutex
	conn     *websocket.Conn
	connID   string
	handlers map[string]map[string]MessageHandler // topic -> subID -> handler
	closed   bool
	ctx      context.Context
	cancel   context.CancelFunc

	reconnectCb func() // called after successful reconnect
}

// NewRemoteTransport creates a transport that connects to one or more gateway URLs.
// When multiple URLs are provided, the transport cycles through them on reconnect.
// Call Connect to establish the WebSocket connection.
func NewRemoteTransport(gatewayURLs ...string) *RemoteTransport {
	urls := make([]string, len(gatewayURLs))
	for i, u := range gatewayURLs {
		urls[i] = strings.TrimRight(u, "/")
	}
	return &RemoteTransport{
		urls:     urls,
		url:      urls[0],
		handlers: make(map[string]map[string]MessageHandler),
	}
}

// OnReconnect registers a callback that fires after the transport reconnects
// and re-subscribes to all topics. Use this to fetch missed messages.
func (t *RemoteTransport) OnReconnect(fn func()) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.reconnectCb = fn
}

// Connect establishes the WebSocket connection and starts the read loop.
// Must be called before Subscribe.
func (t *RemoteTransport) Connect(ctx context.Context) error {
	t.mu.Lock()
	t.ctx, t.cancel = context.WithCancel(ctx)
	t.mu.Unlock()

	return t.dial()
}

// dial creates a new WebSocket connection to the gateway.
func (t *RemoteTransport) dial() error {
	connID := uuid.New().String()
	wsURL := t.wsURL() + "/subscribe?topic=_noop&id=" + connID
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return fmt.Errorf("connect to %s: %w", wsURL, err)
	}

	// Keepalive: respond to server pings, timeout if no pings for 40s
	conn.SetReadDeadline(time.Now().Add(40 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(40 * time.Second))
		return nil
	})
	conn.SetPingHandler(func(msg string) error {
		conn.SetReadDeadline(time.Now().Add(40 * time.Second))
		t.mu.Lock()
		defer t.mu.Unlock()
		conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
		return conn.WriteMessage(websocket.PongMessage, []byte(msg))
	})

	t.mu.Lock()
	t.conn = conn
	t.connID = connID
	t.mu.Unlock()

	go t.readLoop(conn)
	return nil
}

// Close shuts down the WebSocket connection and stops reconnection.
func (t *RemoteTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
	if t.cancel != nil {
		t.cancel()
	}
	if t.conn != nil {
		return t.conn.Close()
	}
	return nil
}

func (t *RemoteTransport) Publish(ctx context.Context, source, topic string, payload json.RawMessage) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"source":  source,
		"topic":   topic,
		"payload": payload,
	})
	resp, err := http.Post(t.url+"/publish", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	var result struct {
		ID    string `json:"id"`
		Error string `json:"error"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	if result.Error != "" {
		return "", fmt.Errorf("%s", result.Error)
	}
	return result.ID, nil
}

func (t *RemoteTransport) Subscribe(topic, id string, handler MessageHandler) error {
	t.mu.Lock()
	if t.handlers[topic] == nil {
		t.handlers[topic] = make(map[string]MessageHandler)
	}
	isNew := len(t.handlers[topic]) == 0
	t.handlers[topic][id] = handler
	conn := t.conn
	t.mu.Unlock()

	// Only send subscribe if this is the first handler for this topic
	if isNew && conn != nil {
		t.wsSend(map[string]string{"action": "subscribe", "topic": topic})
	}
	return nil
}

func (t *RemoteTransport) Unsubscribe(topic, id string) error {
	t.mu.Lock()
	if subs, ok := t.handlers[topic]; ok {
		delete(subs, id)
		if len(subs) == 0 {
			delete(t.handlers, topic)
			t.mu.Unlock()
			t.wsSend(map[string]string{"action": "unsubscribe", "topic": topic})
			return nil
		}
	}
	t.mu.Unlock()
	return nil
}

func (t *RemoteTransport) Request(ctx context.Context, source, topic string, payload json.RawMessage) (*Message, error) {
	body, _ := json.Marshal(map[string]any{
		"source":  source,
		"topic":   topic,
		"payload": payload,
	})

	req, err := http.NewRequestWithContext(ctx, "POST", t.url+"/request", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("request failed (%d): %s", resp.StatusCode, errBody)
	}

	var msg struct {
		ID          string          `json:"id"`
		Source      string          `json:"source"`
		Destination string          `json:"destination"`
		Payload     json.RawMessage `json:"payload"`
		Timestamp   int64           `json:"timestamp"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&msg); err != nil {
		return nil, fmt.Errorf("decode reply: %w", err)
	}
	return &Message{
		ID:        msg.ID,
		Source:    msg.Source,
		Topic:     msg.Destination,
		Payload:   msg.Payload,
		Timestamp: msg.Timestamp,
	}, nil
}

func (t *RemoteTransport) Reply(ctx context.Context, replyTo, source string, payload json.RawMessage) (string, error) {
	return t.Publish(ctx, source, replyTo, payload)
}

// readLoop processes incoming WebSocket messages and dispatches to handlers.
// When the connection drops, it triggers reconnection.
func (t *RemoteTransport) readLoop(conn *websocket.Conn) {
	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			t.mu.Lock()
			closed := t.closed
			t.mu.Unlock()
			if closed {
				return
			}
			log.Printf("remote transport: connection lost: %v", err)
			go t.reconnect()
			return
		}

		var msg struct {
			Type        string          `json:"type"`
			ID          string          `json:"id"`
			Source      string          `json:"source"`
			Destination string          `json:"destination"`
			Payload     json.RawMessage `json:"payload"`
			Timestamp   int64           `json:"timestamp"`
			ReplyTo     string          `json:"reply_to"`
			Error       string          `json:"error"`
		}
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		if msg.Type != "message" {
			continue
		}

		m := &Message{
			ID:        msg.ID,
			Source:    msg.Source,
			Topic:     msg.Destination,
			Payload:   msg.Payload,
			Timestamp: msg.Timestamp,
			ReplyTo:   msg.ReplyTo,
		}

		t.mu.Lock()
		handlers := make([]MessageHandler, 0)
		if subs, ok := t.handlers[msg.Destination]; ok {
			for _, h := range subs {
				handlers = append(handlers, h)
			}
		}
		t.mu.Unlock()

		for _, h := range handlers {
			go func() {
				if err := h(context.Background(), m); err != nil {
					log.Printf("remote transport: handler error: %v", err)
				}
			}()
		}
	}
}

// reconnect attempts to re-establish the WebSocket connection with backoff.
// On success, it re-subscribes to all topics the transport was subscribed to.
// When multiple gateway URLs are configured, it cycles through them.
func (t *RemoteTransport) reconnect() {
	backoff := 500 * time.Millisecond
	maxBackoff := 10 * time.Second

	for {
		t.mu.Lock()
		if t.closed {
			t.mu.Unlock()
			return
		}
		ctx := t.ctx
		t.mu.Unlock()

		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}

		// Try each URL in order
		connected := false
		for _, u := range t.urls {
			t.mu.Lock()
			t.url = u
			t.mu.Unlock()

			log.Printf("remote transport: reconnecting to %s...", u)
			if err := t.dial(); err != nil {
				log.Printf("remote transport: reconnect to %s failed: %v", u, err)
				continue
			}
			connected = true
			break
		}
		if !connected {
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		// Re-subscribe to all topics
		t.mu.Lock()
		topics := make([]string, 0, len(t.handlers))
		for topic := range t.handlers {
			topics = append(topics, topic)
		}
		t.mu.Unlock()

		for _, topic := range topics {
			t.wsSend(map[string]string{"action": "subscribe", "topic": topic})
		}

		log.Printf("remote transport: reconnected, re-subscribed to %d topics", len(topics))

		// Notify caller so they can recover (e.g. fetch missed messages)
		t.mu.Lock()
		cb := t.reconnectCb
		t.mu.Unlock()
		if cb != nil {
			go cb()
		}
		return
	}
}

func (t *RemoteTransport) wsSend(v any) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.conn == nil {
		return fmt.Errorf("not connected")
	}
	return t.conn.WriteJSON(v)
}

func (t *RemoteTransport) wsURL() string {
	url := t.url
	if strings.HasPrefix(url, "http://") {
		return "ws://" + url[7:]
	}
	if strings.HasPrefix(url, "https://") {
		return "wss://" + url[8:]
	}
	return url
}
