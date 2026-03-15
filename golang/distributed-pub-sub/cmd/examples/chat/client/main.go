package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

// wsMessage mirrors the gateway's WebSocket message format.
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

// chatMessage is the structured format for messages on the room topic.
type chatMessage struct {
	Type    string `json:"type"`              // "chat", "system", "kick"
	From    string `json:"from,omitempty"`    // sender name
	Content string `json:"content,omitempty"` // message text
	Target  string `json:"target,omitempty"`  // for kick: target username
}

// chatConn wraps a WebSocket connection with a write mutex and reconnect logic.
type chatConn struct {
	mu     sync.Mutex
	conn   *websocket.Conn
	wsURL  string
	room   string
	closed chan struct{} // signals the receive loop exited
}

func newChatConn(wsURL, room string) *chatConn {
	return &chatConn{
		wsURL:  wsURL,
		room:   room,
		closed: make(chan struct{}),
	}
}

// connect dials the WebSocket and subscribes to the room.
// Returns nil on success. On failure, returns the error (caller should retry).
func (c *chatConn) connect() error {
	conn, _, err := websocket.DefaultDialer.Dial(c.wsURL, http.Header{})
	if err != nil {
		return fmt.Errorf("dial: %w", err)
	}

	// Subscribe to the room.
	if err := conn.WriteJSON(wsMessage{Type: "subscribe", Topic: c.room}); err != nil {
		conn.Close()
		return fmt.Errorf("subscribe: %w", err)
	}

	var resp wsMessage
	if err := conn.ReadJSON(&resp); err != nil {
		conn.Close()
		return fmt.Errorf("subscribe response: %w", err)
	}
	if resp.Type == "error" {
		conn.Close()
		return fmt.Errorf("subscribe rejected: %s", resp.Message)
	}

	c.mu.Lock()
	c.conn = conn
	c.closed = make(chan struct{})
	c.mu.Unlock()

	return nil
}

// connectWithRetry keeps trying to connect with exponential backoff.
func (c *chatConn) connectWithRetry() {
	backoff := time.Second
	for {
		if err := c.connect(); err != nil {
			log.Printf("reconnect failed: %v (retrying in %s)", err, backoff)
			time.Sleep(backoff)
			if backoff < 10*time.Second {
				backoff *= 2
			}
			continue
		}
		return
	}
}

// writeJSON sends a message, protected by mutex.
func (c *chatConn) writeJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == nil {
		return fmt.Errorf("not connected")
	}
	return c.conn.WriteJSON(v)
}

// readJSON reads a message from the current connection.
func (c *chatConn) readJSON(v interface{}) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("not connected")
	}
	return conn.ReadJSON(v)
}

// signalClosed closes the closed channel to notify the main loop.
func (c *chatConn) signalClosed() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn != nil {
		c.conn.Close()
		c.conn = nil
	}
	select {
	case <-c.closed:
	default:
		close(c.closed)
	}
}

func randomName() string {
	adjectives := []string{"swift", "bright", "calm", "bold", "keen"}
	nouns := []string{"fox", "owl", "elk", "jay", "bee"}
	return fmt.Sprintf("%s-%s-%d",
		adjectives[rand.Intn(len(adjectives))],
		nouns[rand.Intn(len(nouns))],
		rand.Intn(100))
}

func main() {
	lbAddr := flag.String("lb", "localhost:8081", "load balancer address")
	room := flag.String("room", "chat", "chat room / topic name")
	name := flag.String("name", "", "username (default: random)")
	nodeAddr := flag.String("node", "", "connect directly to a node address instead of LB")
	flag.Parse()

	if *name == "" {
		*name = randomName()
	}

	target := *lbAddr
	if *nodeAddr != "" {
		target = *nodeAddr
	}

	wsURL := fmt.Sprintf("ws://%s/ws", target)
	cc := newChatConn(wsURL, *room)

	// Initial connect.
	if err := cc.connect(); err != nil {
		log.Printf("initial connection failed: %v", err)
		cc.connectWithRetry()
	}
	log.Printf("connected to %s as %s", target, *name)
	log.Printf("subscribed to room %q", *room)

	kicked := make(chan struct{})

	// Receive loop — restarts on disconnect.
	go func() {
		for {
			var msg wsMessage
			if err := cc.readJSON(&msg); err != nil {
				cc.signalClosed()
				// Wait for reconnect (driven by the reconnect goroutine).
				// Block until closed channel is replaced by a new connection.
				return
			}

			switch msg.Type {
			case "message":
				payload, err := base64.StdEncoding.DecodeString(msg.Payload)
				if err != nil {
					continue
				}

				var cm chatMessage
				if err := json.Unmarshal(payload, &cm); err != nil {
					fmt.Println(string(payload))
					continue
				}

				switch cm.Type {
				case "chat":
					fmt.Printf("%s: %s\n", cm.From, cm.Content)
				case "system":
					fmt.Printf("*** %s\n", cm.Content)
				case "kick":
					fmt.Printf("*** %s kicked %s\n", cm.From, cm.Target)
					if cm.Target == *name {
						fmt.Println("*** You have been kicked from the room.")
						close(kicked)
						return
					}
				}

			case "response":
				if msg.Message == "history" && msg.Payload != "" {
					printHistory(msg.Payload)
				}

			case "error":
				log.Printf("server error: %s", msg.Message)
			}
		}
	}()

	// Reconnect goroutine — watches for disconnects and reconnects.
	go func() {
		for {
			<-cc.closed
			// Check if we were kicked.
			select {
			case <-kicked:
				return
			default:
			}

			log.Printf("disconnected, reconnecting...")
			cc.connectWithRetry()
			log.Printf("reconnected to %s", target)

			// Restart the receive loop.
			go func() {
				for {
					var msg wsMessage
					if err := cc.readJSON(&msg); err != nil {
						cc.signalClosed()
						return
					}

					switch msg.Type {
					case "message":
						payload, err := base64.StdEncoding.DecodeString(msg.Payload)
						if err != nil {
							continue
						}

						var cm chatMessage
						if err := json.Unmarshal(payload, &cm); err != nil {
							fmt.Println(string(payload))
							continue
						}

						switch cm.Type {
						case "chat":
							fmt.Printf("%s: %s\n", cm.From, cm.Content)
						case "system":
							fmt.Printf("*** %s\n", cm.Content)
						case "kick":
							fmt.Printf("*** %s kicked %s\n", cm.From, cm.Target)
							if cm.Target == *name {
								fmt.Println("*** You have been kicked from the room.")
								close(kicked)
								return
							}
						}

					case "response":
						if msg.Message == "history" && msg.Payload != "" {
							printHistory(msg.Payload)
						}

					case "error":
						log.Printf("server error: %s", msg.Message)
					}
				}
			}()
		}
	}()

	// Stdin loop: read and publish messages.
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		fmt.Printf("Chat room %q (you are %s). Type /help for commands.\n", *room, *name)
		for scanner.Scan() {
			text := strings.TrimSpace(scanner.Text())
			if text == "" {
				continue
			}

			switch {
			case text == "/help":
				fmt.Println("Commands:")
				fmt.Println("  /rename <name>  — change your display name")
				fmt.Println("  /kick <name>    — kick a user from the room")
				fmt.Println("  /history        — show recent message history")

			case strings.HasPrefix(text, "/rename "):
				newName := strings.TrimSpace(strings.TrimPrefix(text, "/rename "))
				if newName == "" {
					fmt.Println("Usage: /rename <name>")
					continue
				}
				oldName := *name
				*name = newName
				cm := chatMessage{Type: "system", Content: fmt.Sprintf("%s is now known as %s", oldName, newName)}
				publishChat(cc, *room, cm)
				fmt.Printf("*** You are now known as %s\n", newName)

			case strings.HasPrefix(text, "/kick "):
				tgt := strings.TrimSpace(strings.TrimPrefix(text, "/kick "))
				if tgt == "" {
					fmt.Println("Usage: /kick <name>")
					continue
				}
				cm := chatMessage{Type: "kick", From: *name, Target: tgt}
				publishChat(cc, *room, cm)

			case text == "/history":
				if err := cc.writeJSON(wsMessage{Type: "history", Topic: *room}); err != nil {
					log.Printf("send error: %v", err)
				}

			default:
				if strings.HasPrefix(text, "/") {
					fmt.Printf("Unknown command: %s (type /help)\n", text)
					continue
				}
				cm := chatMessage{Type: "chat", From: *name, Content: text}
				publishChat(cc, *room, cm)
			}
		}
	}()

	// Wait for interrupt signal or kick.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-sigCh:
	case <-kicked:
	}

	fmt.Println("\nbye!")
}

func publishChat(cc *chatConn, room string, cm chatMessage) {
	payload, _ := json.Marshal(cm)
	if err := cc.writeJSON(wsMessage{
		Type:    "publish",
		Topic:   room,
		Payload: base64.StdEncoding.EncodeToString(payload),
	}); err != nil {
		log.Printf("send error: %v", err)
	}
}

func printHistory(b64Payload string) {
	payload, err := base64.StdEncoding.DecodeString(b64Payload)
	if err != nil {
		return
	}
	var items []wsMessage
	if err := json.Unmarshal(payload, &items); err != nil {
		return
	}
	if len(items) == 0 {
		fmt.Println("No message history.")
		return
	}
	fmt.Println("--- History ---")
	for _, item := range items {
		raw, err := base64.StdEncoding.DecodeString(item.Payload)
		if err != nil {
			continue
		}
		var cm chatMessage
		if err := json.Unmarshal(raw, &cm); err != nil {
			fmt.Printf("  %s\n", string(raw))
			continue
		}
		fmt.Printf("  %s: %s\n", cm.From, cm.Content)
	}
	fmt.Println("--- End ---")
}
