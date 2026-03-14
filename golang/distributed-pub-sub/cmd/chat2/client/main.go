// Chat client — connects to a mesh node and provides an interactive CLI.
//
//	go run ./cmd/chat2/client -node http://localhost:8080 -user alice
//
// Commands:
//
//	hello                     → broadcast to room "general"
//	/room <name>              → switch to a different room
//	/dm <user> <message>      → direct message to a user
//	/history [n]              → show recent messages in current room (streamed)
//	/catchup                  → fetch messages missed since last seen
//	/rooms                    → list joined rooms
//	/quit                     → exit
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"time"

	"distributed-pub-sub/service"
)

type chatMsg struct {
	From string `json:"from"`
	Text string `json:"text"`
	Room string `json:"room,omitempty"`
}

type historyEntry struct {
	Source    string          `json:"source"`
	Room      string          `json:"room"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp int64           `json:"timestamp"`
}

func main() {
	nodeURL := flag.String("node", "http://localhost:8080", "mesh node gateway URL")
	user := flag.String("user", "anon", "your username")
	flag.Parse()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	transport := service.NewRemoteTransport(*nodeURL)
	if err := transport.Connect(ctx); err != nil {
		log.Fatalf("connect to %s: %v", *nodeURL, err)
	}
	defer transport.Close()

	chat := service.New("chat", transport, "client."+*user)
	if err := chat.Start(ctx); err != nil {
		log.Fatal(err)
	}
	defer chat.Stop()

	client := chat.Client(*user)
	defer client.Close()

	// Listen for direct messages
	client.OnMessage(func(c *service.Context) error {
		var msg chatMsg
		c.Bind(&msg)
		fmt.Printf("\n  [DM from %s] %s\n> ", msg.From, msg.Text)
		return nil
	})

	// Track joined rooms and last-seen timestamps (for reconnect)
	var roomsMu sync.Mutex
	rooms := map[string]bool{}
	lastSeen := map[string]int64{} // room -> latest timestamp_ms

	joinRoom := func(room string) {
		roomsMu.Lock()
		if rooms[room] {
			roomsMu.Unlock()
			return
		}
		rooms[room] = true
		roomsMu.Unlock()

		client.On("room."+room, func(c *service.Context) error {
			var msg chatMsg
			c.Bind(&msg)
			// Track last-seen timestamp
			roomsMu.Lock()
			if c.Timestamp() > lastSeen["room."+room] {
				lastSeen["room."+room] = c.Timestamp()
			}
			roomsMu.Unlock()
			if msg.From == *user {
				return nil
			}
			fmt.Printf("\n  [%s] %s: %s\n> ", msg.Room, msg.From, msg.Text)
			return nil
		})
		fmt.Printf("joined #%s\n", room)
	}

	showHistory := func(room string, limit int, since int64) {
		reqCtx, reqCancel := context.WithTimeout(ctx, 5*time.Second)
		defer reqCancel()

		req := map[string]any{
			"room":  "room." + room,
			"limit": limit,
		}
		if since > 0 {
			req["since"] = since
		}

		stream, err := client.CallStream(reqCtx, "history", req)
		if err != nil {
			fmt.Printf("  (history unavailable: %v)\n", err)
			return
		}
		defer stream.Close()

		count := 0
		for item := range stream.Ch {
			var e historyEntry
			json.Unmarshal(item.Payload, &e)
			var msg chatMsg
			json.Unmarshal(e.Payload, &msg)
			ts := time.UnixMilli(e.Timestamp).Format("15:04")
			fmt.Printf("  %s %s: %s\n", ts, msg.From, msg.Text)

			// Update last-seen
			roomsMu.Lock()
			if e.Timestamp > lastSeen["room."+room] {
				lastSeen["room."+room] = e.Timestamp
			}
			roomsMu.Unlock()
			count++
		}
		if count == 0 {
			fmt.Println("  (no history)")
		} else {
			fmt.Printf("  — %d messages —\n", count)
		}
	}

	currentRoom := "general"
	joinRoom(currentRoom)

	// On reconnect: catch up on missed messages for all joined rooms
	transport.OnReconnect(func() {
		fmt.Println("\n  (reconnected — fetching missed messages)")
		roomsMu.Lock()
		roomsCopy := make(map[string]int64)
		for r := range rooms {
			roomsCopy[r] = lastSeen["room."+r]
		}
		roomsMu.Unlock()

		for room, since := range roomsCopy {
			if since > 0 {
				showHistory(room, 200, since)
			}
		}
		fmt.Print("> ")
	})

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt)
		<-sigCh
		fmt.Println("\nbye!")
		cancel()
		os.Exit(0)
	}()

	fmt.Printf("chat — user=%s, node=%s\n", *user, *nodeURL)
	fmt.Println("commands: /dm /room /rooms /history /catchup /quit")

	scanner := bufio.NewScanner(os.Stdin)
	fmt.Print("> ")
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			fmt.Print("> ")
			continue
		}

		switch {
		case line == "/quit":
			return

		case line == "/rooms":
			roomsMu.Lock()
			for r := range rooms {
				marker := " "
				if r == currentRoom {
					marker = "*"
				}
				fmt.Printf("  %s #%s\n", marker, r)
			}
			roomsMu.Unlock()

		case strings.HasPrefix(line, "/room "):
			room := strings.TrimSpace(line[6:])
			if room != "" {
				joinRoom(room)
				currentRoom = room
				fmt.Printf("now chatting in #%s\n", currentRoom)
			}

		case line == "/catchup":
			roomsMu.Lock()
			since := lastSeen["room."+currentRoom]
			roomsMu.Unlock()
			showHistory(currentRoom, 200, since)

		case line == "/history" || strings.HasPrefix(line, "/history "):
			limit := 20
			if parts := strings.Fields(line); len(parts) > 1 {
				if n, err := strconv.Atoi(parts[1]); err == nil && n > 0 {
					limit = n
				}
			}
			showHistory(currentRoom, limit, 0)

		case strings.HasPrefix(line, "/dm "):
			parts := strings.SplitN(line[4:], " ", 2)
			if len(parts) < 2 {
				fmt.Println("usage: /dm <user> <message>")
			} else {
				target := parts[0]
				text := parts[1]
				reqCtx, reqCancel := context.WithTimeout(ctx, 3*time.Second)
				_, err := client.Call(reqCtx, "send", map[string]string{
					"to":   target,
					"text": text,
				})
				reqCancel()
				if err != nil {
					fmt.Printf("  (send failed: %v)\n", err)
				} else {
					fmt.Printf("  → DM to %s\n", target)
				}
			}

		default:
			msg := chatMsg{From: *user, Text: line, Room: currentRoom}
			client.Emit(ctx, "room."+currentRoom, msg)
		}

		fmt.Print("> ")
	}
}
