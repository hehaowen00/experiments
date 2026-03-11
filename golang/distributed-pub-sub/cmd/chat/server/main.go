package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"distributed-pub-sub/pubsub"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

// messageStore persists messages to SQLite.
type messageStore struct {
	db *sql.DB
}

func newMessageStore(dbPath string) (*messageStore, error) {
	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS messages (
		id TEXT PRIMARY KEY,
		topic TEXT NOT NULL,
		source TEXT NOT NULL,
		payload BLOB NOT NULL,
		timestamp_ms INTEGER NOT NULL
	)`)
	if err != nil {
		db.Close()
		return nil, err
	}
	_, err = db.Exec(`CREATE INDEX IF NOT EXISTS idx_messages_topic_ts ON messages(topic, timestamp_ms)`)
	if err != nil {
		db.Close()
		return nil, err
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS files (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		content_type TEXT NOT NULL,
		data BLOB NOT NULL,
		uploaded_by TEXT NOT NULL,
		uploaded_at INTEGER NOT NULL
	)`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &messageStore{db: db}, nil
}

func (s *messageStore) insert(id, topic, source string, payload json.RawMessage, timestampMs int64) {
	_, err := s.db.Exec(
		`INSERT OR IGNORE INTO messages (id, topic, source, payload, timestamp_ms) VALUES (?, ?, ?, ?, ?)`,
		id, topic, source, []byte(payload), timestampMs,
	)
	if err != nil {
		log.Printf("store insert error: %v", err)
	}
}

// Recent implements pubsub.HistoryProvider.
func (s *messageStore) Recent(topic string, limit int) []*pubsub.Message {
	rows, err := s.db.Query(
		`SELECT id, source, payload, timestamp_ms FROM messages WHERE topic = ? ORDER BY timestamp_ms DESC LIMIT ?`,
		topic, limit,
	)
	if err != nil {
		log.Printf("store query error: %v", err)
		return nil
	}
	defer rows.Close()

	var msgs []*pubsub.Message
	for rows.Next() {
		m := &pubsub.Message{Destination: topic}
		var payload []byte
		if err := rows.Scan(&m.ID, &m.Source, &payload, &m.Timestamp); err != nil {
			continue
		}
		m.Payload = json.RawMessage(payload)
		msgs = append(msgs, m)
	}
	// Reverse to chronological order
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs
}

func (s *messageStore) latestTimestamp(topic string) int64 {
	var ts sql.NullInt64
	s.db.QueryRow(`SELECT MAX(timestamp_ms) FROM messages WHERE topic = ?`, topic).Scan(&ts)
	return ts.Int64 // 0 if NULL
}

func (s *messageStore) since(topic string, afterMs int64, limit int) []*pubsub.Message {
	rows, err := s.db.Query(
		`SELECT id, source, payload, timestamp_ms FROM messages WHERE topic = ? AND timestamp_ms > ? ORDER BY timestamp_ms ASC LIMIT ?`,
		topic, afterMs, limit,
	)
	if err != nil {
		log.Printf("store query error: %v", err)
		return nil
	}
	defer rows.Close()

	var msgs []*pubsub.Message
	for rows.Next() {
		m := &pubsub.Message{Destination: topic}
		var payload []byte
		if err := rows.Scan(&m.ID, &m.Source, &payload, &m.Timestamp); err != nil {
			continue
		}
		m.Payload = json.RawMessage(payload)
		msgs = append(msgs, m)
	}
	return msgs
}

type fileRecord struct {
	ID          string
	Name        string
	ContentType string
	Data        []byte
	UploadedBy  string
	UploadedAt  int64
}

func (s *messageStore) insertFile(f *fileRecord) error {
	_, err := s.db.Exec(
		`INSERT INTO files (id, name, content_type, data, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?)`,
		f.ID, f.Name, f.ContentType, f.Data, f.UploadedBy, f.UploadedAt,
	)
	return err
}

func (s *messageStore) getFile(id string) (*fileRecord, error) {
	f := &fileRecord{ID: id}
	err := s.db.QueryRow(
		`SELECT name, content_type, data, uploaded_by, uploaded_at FROM files WHERE id = ?`, id,
	).Scan(&f.Name, &f.ContentType, &f.Data, &f.UploadedBy, &f.UploadedAt)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (s *messageStore) close() { s.db.Close() }

// syncFrom fetches messages newer than our latest from a peer's /sync endpoint.
// Deduplication is handled by INSERT OR IGNORE.
func syncFrom(peerURL string, store *messageStore, topic string) {
	since := store.latestTimestamp(topic)
	url := fmt.Sprintf("%s/sync?topic=%s&since=%d", peerURL, topic, since)
	resp, err := http.Get(url)
	if err != nil {
		log.Printf("sync from %s failed: %v", peerURL, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("sync from %s returned %d", peerURL, resp.StatusCode)
		return
	}

	var msgs []struct {
		ID        string          `json:"id"`
		Source    string          `json:"source"`
		Topic     string          `json:"topic"`
		Payload   json.RawMessage `json:"payload"`
		Timestamp int64           `json:"timestamp"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&msgs); err != nil {
		log.Printf("sync decode error: %v", err)
		return
	}

	for _, m := range msgs {
		store.insert(m.ID, m.Topic, m.Source, m.Payload, m.Timestamp)
	}
	log.Printf("synced %d messages from %s for topic %s (since %d)", len(msgs), peerURL, topic, since)
}

// announce periodically sends a UDP multicast packet with this server's HTTP
// address so load balancers can discover it automatically.
func announce(httpAddr, multicastAddr string, interval time.Duration) {
	addr, err := net.ResolveUDPAddr("udp4", multicastAddr)
	if err != nil {
		log.Printf("announce: resolve %s: %v", multicastAddr, err)
		return
	}
	conn, err := net.DialUDP("udp4", nil, addr)
	if err != nil {
		log.Printf("announce: dial: %v", err)
		return
	}
	defer conn.Close()

	msg := []byte(httpAddr)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		conn.Write(msg)
	}
}

func main() {
	httpAddr := flag.String("http", ":8080", "HTTP listen address")
	grpcAddr := flag.String("grpc", ":9000", "internal gRPC listen address")
	advertise := flag.String("advertise", "127.0.0.1:9000", "address other nodes use to reach this node")
	seeds := flag.String("seeds", "", "comma-separated seed node addresses")
	dbPath := flag.String("db", "messages.db", "SQLite database path")
	syncPeer := flag.String("sync-from", "", "HTTP address of a peer to sync history from on startup (e.g. http://localhost:8080)")
	announceAddr := flag.String("announce", "239.1.1.1:9999", "UDP multicast address for LB discovery")
	announceHTTP := flag.String("announce-http", "", "HTTP address to announce (e.g. http://localhost:8080). Empty disables announcing.")
	flag.Parse()

	var seedList []string
	if *seeds != "" {
		seedList = strings.Split(*seeds, ",")
	}

	node, err := pubsub.New(pubsub.Options{
		ListenAddr:    *grpcAddr,
		AdvertiseAddr: *advertise,
		Seeds:         seedList,
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx := context.Background()
	if err := node.Start(ctx); err != nil {
		log.Fatal(err)
	}
	defer node.Stop()

	store, err := newMessageStore(*dbPath)
	if err != nil {
		log.Fatal(err)
	}
	defer store.close()

	// Sync history from a peer before accepting clients
	if *syncPeer != "" {
		syncFrom(*syncPeer, store, "chat.general")
	}

	// History collector: persist all non-receipt messages
	historySubID := fmt.Sprintf("_history:%s", node.ID())
	node.Subscribe("chat.general", historySubID, func(_ context.Context, m *pubsub.Message) error {
		var probe map[string]any
		if json.Unmarshal(m.Payload, &probe) == nil {
			if t, _ := probe["type"].(string); t == "receipt" {
				return nil
			}
		}
		store.insert(m.ID, m.Destination, m.Source, m.Payload, m.Timestamp)
		return nil
	})

	// Gateway handles pub/sub over WebSocket + HTTP, with history replay on subscribe
	gw := pubsub.NewGateway(node, pubsub.WithHistory(store))

	// Sync endpoint: serves stored messages to peers
	mux := http.NewServeMux()
	mux.HandleFunc("GET /sync", func(w http.ResponseWriter, r *http.Request) {
		topic := r.URL.Query().Get("topic")
		if topic == "" {
			topic = "chat.general"
		}
		var sinceMs int64
		if s := r.URL.Query().Get("since"); s != "" {
			fmt.Sscanf(s, "%d", &sinceMs)
		}
		msgs := store.since(topic, sinceMs, 1000)
		type syncEntry struct {
			ID        string          `json:"id"`
			Source    string          `json:"source"`
			Topic     string          `json:"topic"`
			Payload   json.RawMessage `json:"payload"`
			Timestamp int64           `json:"timestamp"`
		}
		out := make([]syncEntry, len(msgs))
		for i, m := range msgs {
			out[i] = syncEntry{
				ID:        m.ID,
				Source:    m.Source,
				Topic:     m.Destination,
				Payload:   m.Payload,
				Timestamp: m.Timestamp,
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(out)
	})
	// File upload: POST /upload (multipart form with "file" field, optional "source" field)
	mux.HandleFunc("POST /upload", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(32 << 20); err != nil { // 32 MB max
			http.Error(w, `{"error":"invalid multipart form"}`, http.StatusBadRequest)
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			http.Error(w, `{"error":"file field required"}`, http.StatusBadRequest)
			return
		}
		defer file.Close()

		data, err := io.ReadAll(file)
		if err != nil {
			http.Error(w, `{"error":"failed to read file"}`, http.StatusInternalServerError)
			return
		}

		source := r.FormValue("source")
		if source == "" {
			source = "anonymous"
		}

		rec := &fileRecord{
			ID:          uuid.New().String(),
			Name:        header.Filename,
			ContentType: header.Header.Get("Content-Type"),
			Data:        data,
			UploadedBy:  source,
			UploadedAt:  time.Now().UnixMilli(),
		}
		if rec.ContentType == "" {
			rec.ContentType = "application/octet-stream"
		}

		if err := store.insertFile(rec); err != nil {
			http.Error(w, `{"error":"store failed"}`, http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"id":   rec.ID,
			"name": rec.Name,
		})
	})

	// File download: GET /download?id=<file-id>
	mux.HandleFunc("GET /download", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		if id == "" {
			http.Error(w, `{"error":"id query param required"}`, http.StatusBadRequest)
			return
		}

		rec, err := store.getFile(id)
		if err != nil {
			http.Error(w, `{"error":"file not found"}`, http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", rec.ContentType)
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, rec.Name))
		w.Write(rec.Data)
	})

	mux.Handle("/", gw)

	// Start UDP multicast announcer for LB discovery
	if *announceHTTP != "" {
		go announce(*announceHTTP, *announceAddr, 2*time.Second)
		log.Printf("announcing %s on %s", *announceHTTP, *announceAddr)
	}

	log.Printf("server listening — HTTP %s, gRPC %s, advertise %s, db %s", *httpAddr, *grpcAddr, *advertise, *dbPath)
	if len(seedList) > 0 {
		log.Printf("seed nodes: %v", seedList)
	}
	log.Fatal(http.ListenAndServe(*httpAddr, mux))
}
