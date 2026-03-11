package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type ClientMessage struct {
	Action  string          `json:"action"`
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

type HistoryMessage struct {
	ID        string          `json:"id"`
	Source    string          `json:"source"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp int64           `json:"timestamp"`
}

type ServerMessage struct {
	Type        string           `json:"type"`
	ID          string           `json:"id,omitempty"`
	Source      string           `json:"source,omitempty"`
	Destination string           `json:"destination,omitempty"`
	Payload     json.RawMessage  `json:"payload,omitempty"`
	Timestamp   int64            `json:"timestamp,omitempty"`
	ReplyTo     string           `json:"reply_to,omitempty"`
	Topic       string           `json:"topic,omitempty"`
	Error       string           `json:"error,omitempty"`
	Messages    []HistoryMessage `json:"messages,omitempty"`
}

// connManager holds the current WebSocket connection and allows
// safe concurrent access with automatic reconnection.
type connManager struct {
	mu   sync.Mutex
	conn *websocket.Conn
	url  string

	// reconnected signals the read loop to restart
	reconnected chan struct{}
}

func newConnManager(url string) *connManager {
	return &connManager{
		url:         url,
		reconnected: make(chan struct{}, 1),
	}
}

func (cm *connManager) connect() error {
	cm.mu.Lock()
	defer cm.mu.Unlock()

	if cm.conn != nil {
		cm.conn.Close()
	}

	conn, _, err := websocket.DefaultDialer.Dial(cm.url, nil)
	if err != nil {
		cm.conn = nil
		return err
	}
	cm.conn = conn

	// Signal read loop to restart
	select {
	case cm.reconnected <- struct{}{}:
	default:
	}

	return nil
}

func (cm *connManager) reconnectLoop() {
	backoff := time.Second
	maxBackoff := 10 * time.Second

	for {
		fmt.Fprintf(os.Stderr, "\rreconnecting in %v...\n", backoff)
		time.Sleep(backoff)

		if err := cm.connect(); err != nil {
			fmt.Fprintf(os.Stderr, "\rreconnect failed: %v\n", err)
			backoff = min(backoff*2, maxBackoff)
			continue
		}

		fmt.Printf("\rreconnected\n> ")
		return
	}
}

func (cm *connManager) writeJSON(v any) error {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if cm.conn == nil {
		return fmt.Errorf("not connected")
	}
	return cm.conn.WriteJSON(v)
}

func (cm *connManager) readMessage() (int, []byte, error) {
	cm.mu.Lock()
	conn := cm.conn
	cm.mu.Unlock()
	if conn == nil {
		return 0, nil, fmt.Errorf("not connected")
	}
	return conn.ReadMessage()
}

func (cm *connManager) close() {
	cm.mu.Lock()
	defer cm.mu.Unlock()
	if cm.conn != nil {
		cm.conn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
		)
		cm.conn.Close()
		cm.conn = nil
	}
}

func main() {
	addr := flag.String("addr", "ws://localhost:8080", "server base URL")
	user := flag.String("user", "", "your user ID")
	topic := flag.String("topic", "chat.general", "topic to join")
	flag.Parse()

	if *user == "" {
		fmt.Fprintln(os.Stderr, "usage: client -user NAME [-topic TOPIC] [-addr URL]")
		os.Exit(1)
	}

	wsURL := fmt.Sprintf("%s/subscribe?topic=%s&id=%s", *addr, *topic, *user)
	cm := newConnManager(wsURL)

	if err := cm.connect(); err != nil {
		log.Fatalf("connect failed: %v", err)
	}

	currentUser := *user
	currentTopic := *topic

	// Handle incoming messages with auto-reconnect
	go func() {
		for {
			_, raw, err := cm.readMessage()
			if err != nil {
				fmt.Fprintf(os.Stderr, "\rdisconnected: %v\n", err)
				cm.reconnectLoop()
				continue
			}

			var msg ServerMessage
			if err := json.Unmarshal(raw, &msg); err != nil {
				continue
			}

			switch msg.Type {
			case "message":
				var payload map[string]any
				json.Unmarshal(msg.Payload, &payload)

				// Check if this is a read receipt
				if payloadType, _ := payload["type"].(string); payloadType == "receipt" {
					reader, _ := payload["reader"].(string)
					if reader != currentUser {
						readAt, _ := payload["read_at"].(float64)
						ts := time.UnixMilli(int64(readAt)).Format("15:04:05")
						fmt.Printf("\r  [read by %s at %s]\n> ", reader, ts)
					}
					continue
				}

				ts := time.UnixMilli(msg.Timestamp).Format("15:04:05")
				text, _ := payload["text"].(string)
				fmt.Printf("\r[%s] %s: %s\n> ", ts, msg.Source, text)

				// Send read receipt for messages from others
				if msg.Source != currentUser {
					receiptPayload, _ := json.Marshal(map[string]any{
						"type":       "receipt",
						"message_id": msg.ID,
						"reader":     currentUser,
						"read_at":    time.Now().UnixMilli(),
					})
					cm.writeJSON(ClientMessage{
						Action:  "publish",
						Topic:   currentTopic,
						Payload: json.RawMessage(receiptPayload),
					})
				}

			case "history":
				fmt.Printf("\r--- history for #%s ---\n", msg.Topic)
				for _, m := range msg.Messages {
					var payload map[string]any
					json.Unmarshal(m.Payload, &payload)
					ts := time.UnixMilli(m.Timestamp).Format("15:04:05")
					text, _ := payload["text"].(string)
					fmt.Printf("[%s] %s: %s\n", ts, m.Source, text)
				}
				fmt.Printf("--- end history ---\n> ")

			case "subscribed":
				fmt.Printf("joined #%s\n> ", msg.Topic)
			case "unsubscribed":
				fmt.Printf("left #%s\n> ", msg.Topic)
			case "error":
				fmt.Printf("error: %s\n> ", msg.Error)
			}
		}
	}()

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	go func() {
		<-sigCh
		fmt.Println("\nbye")
		cm.close()
		os.Exit(0)
	}()

	// Read stdin
	fmt.Printf("connected as %s to #%s\n> ", *user, *topic)
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		text := scanner.Text()
		if text == "" {
			fmt.Print("> ")
			continue
		}
		payload, _ := json.Marshal(map[string]string{"text": text})
		if err := cm.writeJSON(ClientMessage{
			Action:  "publish",
			Topic:   *topic,
			Payload: json.RawMessage(payload),
		}); err != nil {
			fmt.Fprintf(os.Stderr, "\rsend failed: %v\n> ", err)
		}
		fmt.Print("> ")
	}
}
