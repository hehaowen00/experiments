// Chat server — connects to a mesh node and handles chat RPCs with SQLite
// persistence. Run one or more alongside mesh nodes:
//
//	go run ./cmd/mesh/node -grpc :9000 -advertise 127.0.0.1:9000 -http :8080
//	go run ./cmd/chat2/server -node http://localhost:8080 -db chat.db
//
// Multiple servers can share the same SQLite DB or use separate ones.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"log"
	"os"
	"os/signal"
	"strings"

	"distributed-pub-sub/service"

	_ "github.com/mattn/go-sqlite3"
)

type chatMsg struct {
	From string `json:"from"`
	Text string `json:"text"`
	Room string `json:"room,omitempty"`
}

type historyEntry struct {
	ID        string          `json:"id"`
	Source    string          `json:"source"`
	Room      string          `json:"room"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp int64           `json:"timestamp"`
}

func main() {
	nodeURL := flag.String("node", "http://localhost:8080", "mesh node gateway URL")
	dbPath := flag.String("db", "chat.db", "SQLite database path")
	id := flag.String("id", "server-1", "server instance ID")
	rooms := flag.String("rooms", "general", "comma-separated rooms to persist")
	flag.Parse()

	roomList := strings.Split(*rooms, ",")

	// Open SQLite
	db, err := sql.Open("sqlite3", *dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		room TEXT NOT NULL,
		source TEXT NOT NULL,
		payload BLOB NOT NULL,
		timestamp_ms INTEGER NOT NULL
	)`)
	if err != nil {
		log.Fatal(err)
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_messages_room_ts ON messages(room, timestamp_ms)`)
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Connect to mesh node
	transport := service.NewRemoteTransport(*nodeURL)
	if err := transport.Connect(ctx); err != nil {
		log.Fatalf("connect to %s: %v", *nodeURL, err)
	}
	defer transport.Close()

	chat := service.New("chat", transport, *id)

	// Middleware: persist every message flowing through handlers
	chat.Use(func(next service.HandlerFunc) service.HandlerFunc {
		return func(ctx *service.Context) error {
			// Only persist room events (not RPCs, not inbox messages)
			topic := ctx.Topic()
			if strings.HasPrefix(topic, "chat.room.") {
				room := strings.TrimPrefix(topic, "chat.")
				db.Exec(
					`INSERT OR IGNORE INTO messages (id, room, source, payload, timestamp_ms) VALUES (?, ?, ?, ?, ?)`,
					ctx.MessageID(), room, ctx.Source(), []byte(ctx.Payload()), ctx.Timestamp(),
				)
			}
			return next(ctx)
		}
	})

	// Handle "send" RPC — routes DMs to recipient inbox
	chat.Handle("send", func(ctx *service.Context) error {
		var msg struct {
			To   string `json:"to"`
			Text string `json:"text"`
		}
		ctx.Bind(&msg)

		dm := chatMsg{From: ctx.Source(), Text: msg.Text}
		payload, _ := json.Marshal(dm)
		chat.Send(ctx, msg.To, json.RawMessage(payload))

		return ctx.Reply(map[string]string{"status": "delivered"})
	})

	// Handle "history" RPC — stream recent messages from SQLite.
	// Supports both "limit" (most recent N) and "since" (messages after timestamp).
	chat.Handle("history", func(ctx *service.Context) error {
		var req struct {
			Room     string `json:"room"`
			Limit    int    `json:"limit"`
			Since    int64  `json:"since"`
			StreamTo string `json:"_stream_to"`
		}
		ctx.Bind(&req)
		if req.Limit <= 0 || req.Limit > 200 {
			req.Limit = 50
		}
		if req.Room == "" {
			req.Room = "room.general"
		}

		var rows *sql.Rows
		var err error
		if req.Since > 0 {
			rows, err = db.Query(
				`SELECT id, source, payload, timestamp_ms FROM messages WHERE room = ? AND timestamp_ms > ? ORDER BY timestamp_ms ASC LIMIT ?`,
				req.Room, req.Since, req.Limit,
			)
		} else {
			rows, err = db.Query(
				`SELECT id, source, payload, timestamp_ms FROM messages WHERE room = ? ORDER BY timestamp_ms DESC LIMIT ?`,
				req.Room, req.Limit,
			)
		}
		if err != nil {
			if req.StreamTo != "" {
				sw, _ := ctx.Stream()
				if sw != nil {
					sw.Close()
				}
				return nil
			}
			return ctx.Reply([]historyEntry{})
		}
		defer rows.Close()

		var entries []historyEntry
		for rows.Next() {
			var e historyEntry
			var payload []byte
			if err := rows.Scan(&e.ID, &e.Source, &payload, &e.Timestamp); err != nil {
				continue
			}
			e.Room = req.Room
			e.Payload = json.RawMessage(payload)
			entries = append(entries, e)
		}

		// Reverse to chronological if fetched DESC (no "since")
		if req.Since <= 0 {
			for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
				entries[i], entries[j] = entries[j], entries[i]
			}
		}

		// Stream mode: send each entry individually, then close
		if req.StreamTo != "" {
			sw, err := ctx.Stream()
			if err != nil {
				return err
			}
			for _, e := range entries {
				sw.Send(e)
			}
			return sw.Close()
		}

		return ctx.Reply(entries)
	})

	// Subscribe to room topics so messages are persisted by middleware
	for _, room := range roomList {
		room := strings.TrimSpace(room)
		if room == "" {
			continue
		}
		chat.On("room."+room, func(ctx *service.Context) error {
			return nil // middleware handles persistence
		})
	}

	if err := chat.Start(ctx); err != nil {
		log.Fatal(err)
	}
	defer chat.Stop()

	log.Printf("chat server %s — node=%s, db=%s, rooms=%v", *id, *nodeURL, *dbPath, roomList)

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	<-sigCh
	log.Println("shutting down")
}
