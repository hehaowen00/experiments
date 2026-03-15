package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// wsMessage represents a WebSocket protocol message.
type wsMessage struct {
	Type    string `json:"type"`
	Topic   string `json:"topic,omitempty"`
	Payload string `json:"payload,omitempty"` // base64-encoded
}

// httpRequestBody represents the JSON body for an HTTP request-response call.
type httpRequestBody struct {
	Topic   string `json:"topic"`
	Payload string `json:"payload"` // base64-encoded
	Timeout int    `json:"timeout"` // milliseconds
}

// httpResponseBody represents the JSON response from an HTTP request-response call.
type httpResponseBody struct {
	Payload string `json:"payload"` // base64-encoded
	Error   string `json:"error,omitempty"`
}

// RemoteTransport connects to a node via HTTP/WebSocket.
type RemoteTransport struct {
	baseURL  string
	wsURL    string
	conn     *websocket.Conn
	handlers map[string]func(data []byte) []byte
	mu       sync.RWMutex
	ctx      context.Context
	cancel   context.CancelFunc
}

// NewRemoteTransport creates a new RemoteTransport.
// httpBaseURL should be the HTTP base URL of the node (e.g., "http://localhost:8080").
func NewRemoteTransport(httpBaseURL string) *RemoteTransport {
	// Derive WebSocket URL from HTTP URL.
	wsURL := strings.Replace(httpBaseURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)

	ctx, cancel := context.WithCancel(context.Background())

	return &RemoteTransport{
		baseURL:  httpBaseURL,
		wsURL:    wsURL,
		handlers: make(map[string]func(data []byte) []byte),
		ctx:      ctx,
		cancel:   cancel,
	}
}

// Connect establishes the WebSocket connection and starts the read loop.
func (t *RemoteTransport) Connect() error {
	dialer := websocket.DefaultDialer
	conn, _, err := dialer.DialContext(t.ctx, t.wsURL+"/ws", nil)
	if err != nil {
		return fmt.Errorf("failed to connect to %s/ws: %w", t.wsURL, err)
	}

	t.mu.Lock()
	t.conn = conn
	t.mu.Unlock()

	go t.readLoop()
	return nil
}

// readLoop reads incoming WebSocket messages and dispatches them to handlers.
func (t *RemoteTransport) readLoop() {
	for {
		select {
		case <-t.ctx.Done():
			return
		default:
		}

		_, raw, err := t.conn.ReadMessage()
		if err != nil {
			// Connection closed or error.
			select {
			case <-t.ctx.Done():
				return
			default:
				// Unexpected error, exit read loop.
				return
			}
		}

		var msg wsMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		if msg.Type == "message" && msg.Topic != "" {
			t.mu.RLock()
			handler, ok := t.handlers[msg.Topic]
			t.mu.RUnlock()

			if ok {
				payload, err := base64.StdEncoding.DecodeString(msg.Payload)
				if err != nil {
					continue
				}

				result := handler(payload)
				if result != nil {
					// Send response back if handler returned data.
					resp := wsMessage{
						Type:    "response",
						Topic:   msg.Topic,
						Payload: base64.StdEncoding.EncodeToString(result),
					}
					respData, err := json.Marshal(resp)
					if err == nil {
						t.mu.RLock()
						_ = t.conn.WriteMessage(websocket.TextMessage, respData)
						t.mu.RUnlock()
					}
				}
			}
		}
	}
}

// Publish sends a message to a topic over the WebSocket connection.
func (t *RemoteTransport) Publish(topic string, data []byte) error {
	msg := wsMessage{
		Type:    "publish",
		Topic:   topic,
		Payload: base64.StdEncoding.EncodeToString(data),
	}

	raw, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal publish message: %w", err)
	}

	t.mu.RLock()
	conn := t.conn
	t.mu.RUnlock()

	if conn == nil {
		return fmt.Errorf("not connected")
	}

	return conn.WriteMessage(websocket.TextMessage, raw)
}

// Subscribe sends a subscribe message over the WebSocket and registers the local handler.
func (t *RemoteTransport) Subscribe(topic string, handler func(data []byte) []byte) error {
	t.mu.Lock()
	t.handlers[topic] = handler
	conn := t.conn
	t.mu.Unlock()

	if conn == nil {
		return fmt.Errorf("not connected")
	}

	msg := wsMessage{
		Type:  "subscribe",
		Topic: topic,
	}

	raw, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal subscribe message: %w", err)
	}

	return conn.WriteMessage(websocket.TextMessage, raw)
}

// Request sends an HTTP POST request to the node and waits for the response.
func (t *RemoteTransport) Request(ctx context.Context, topic string, data []byte, timeout time.Duration) ([]byte, error) {
	body := httpRequestBody{
		Topic:   topic,
		Payload: base64.StdEncoding.EncodeToString(data),
		Timeout: int(timeout.Milliseconds()),
	}

	raw, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request body: %w", err)
	}

	url := fmt.Sprintf("%s/request", t.baseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("failed to create HTTP request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: timeout + 5*time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request to %s failed: %w", url, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("request failed with status %d: %s", resp.StatusCode, string(respBody))
	}

	var httpResp httpResponseBody
	if err := json.Unmarshal(respBody, &httpResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if httpResp.Error != "" {
		return nil, fmt.Errorf("remote error: %s", httpResp.Error)
	}

	payload, err := base64.StdEncoding.DecodeString(httpResp.Payload)
	if err != nil {
		return nil, fmt.Errorf("failed to decode response payload: %w", err)
	}

	return payload, nil
}

// Close shuts down the WebSocket connection.
func (t *RemoteTransport) Close() error {
	t.cancel()

	t.mu.Lock()
	conn := t.conn
	t.conn = nil
	t.mu.Unlock()

	if conn == nil {
		return nil
	}

	// Send close message to server.
	_ = conn.WriteMessage(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
	)

	return conn.Close()
}
