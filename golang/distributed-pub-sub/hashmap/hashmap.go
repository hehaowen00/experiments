// Package hashmap provides a distributed key-value store built on top of the
// pubsub mesh. Every node holds a full replica. Writes are broadcast via pubsub
// topics and conflicts are resolved with last-write-wins using wall-clock
// timestamps. New nodes perform anti-entropy sync on startup to pull the full
// state from an existing peer.
package hashmap

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"distributed-pub-sub/pubsub"
)

const (
	topicSet    = "_hashmap.set"
	topicDelete = "_hashmap.delete"
	topicSync   = "_hashmap.sync"
)

// entry is a versioned value stored locally.
type entry struct {
	Value     json.RawMessage `json:"value"`
	Timestamp int64           `json:"ts"`
	Deleted   bool            `json:"deleted,omitempty"`
}

// setPayload is the wire format for set operations.
type setPayload struct {
	Key       string          `json:"key"`
	Value     json.RawMessage `json:"value"`
	Timestamp int64           `json:"ts"`
}

// deletePayload is the wire format for delete operations.
type deletePayload struct {
	Key       string `json:"key"`
	Timestamp int64  `json:"ts"`
}

// syncPayload carries the full state for anti-entropy sync.
type syncPayload struct {
	Entries map[string]entry `json:"entries"`
}

// Options configures the distributed hashmap.
type Options struct {
	// PubsubOptions configures the underlying pubsub node.
	PubsubOptions pubsub.Options

	// SyncTimeout is how long to wait for anti-entropy sync on startup.
	// Defaults to 3 seconds.
	SyncTimeout time.Duration
}

// Map is a distributed hashmap replicated across a pubsub mesh.
type Map struct {
	node *pubsub.Node
	id   string

	mu      sync.RWMutex
	entries map[string]entry

	syncTimeout time.Duration
	hasSeeds    bool
}

// New creates a new distributed hashmap. Call Start to join the mesh.
func New(opts Options) (*Map, error) {
	node, err := pubsub.New(opts.PubsubOptions)
	if err != nil {
		return nil, err
	}

	syncTimeout := opts.SyncTimeout
	if syncTimeout == 0 {
		syncTimeout = 3 * time.Second
	}

	return &Map{
		node:        node,
		id:          node.ID(),
		entries:     make(map[string]entry),
		syncTimeout: syncTimeout,
		hasSeeds:    len(opts.PubsubOptions.Seeds) > 0,
	}, nil
}

// Node returns the underlying pubsub node for advanced use (e.g. adding a
// gateway or inspecting stats).
func (m *Map) Node() *pubsub.Node { return m.node }

// Start joins the pubsub mesh, subscribes to replication topics, and runs
// anti-entropy sync against existing peers.
func (m *Map) Start(ctx context.Context) error {
	if err := m.node.Start(ctx); err != nil {
		return err
	}

	// Subscribe to replication topics
	if err := m.node.Subscribe(topicSet, m.id+".set", m.handleSet); err != nil {
		return err
	}
	if err := m.node.Subscribe(topicDelete, m.id+".del", m.handleDelete); err != nil {
		return err
	}
	if err := m.node.Subscribe(topicSync, m.id+".sync", m.handleSyncRequest); err != nil {
		return err
	}

	// Anti-entropy: request full state from any peer (skip if no seeds)
	if m.hasSeeds {
		m.requestSync(ctx)
	}

	return nil
}

// Stop gracefully shuts down the hashmap and its underlying node.
func (m *Map) Stop() error {
	return m.node.Stop()
}

// Get retrieves a value by key. Returns nil, false if not found or deleted.
func (m *Map) Get(key string) (json.RawMessage, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	e, ok := m.entries[key]
	if !ok || e.Deleted {
		return nil, false
	}
	return e.Value, true
}

// Set stores a key-value pair and replicates it across the mesh.
func (m *Map) Set(ctx context.Context, key string, value json.RawMessage) error {
	ts := time.Now().UnixMicro()

	m.mu.Lock()
	m.entries[key] = entry{Value: value, Timestamp: ts}
	m.mu.Unlock()

	payload, _ := json.Marshal(setPayload{Key: key, Value: value, Timestamp: ts})
	_, err := m.node.Publish(ctx, m.id, topicSet, payload)
	return err
}

// Delete removes a key and replicates the deletion across the mesh.
// Uses a tombstone so that late-arriving sets with older timestamps are ignored.
func (m *Map) Delete(ctx context.Context, key string) error {
	ts := time.Now().UnixMicro()

	m.mu.Lock()
	m.entries[key] = entry{Deleted: true, Timestamp: ts}
	m.mu.Unlock()

	payload, _ := json.Marshal(deletePayload{Key: key, Timestamp: ts})
	_, err := m.node.Publish(ctx, m.id, topicDelete, payload)
	return err
}

// Keys returns all non-deleted keys.
func (m *Map) Keys() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	keys := make([]string, 0, len(m.entries))
	for k, e := range m.entries {
		if !e.Deleted {
			keys = append(keys, k)
		}
	}
	return keys
}

// Len returns the count of non-deleted entries.
func (m *Map) Len() int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	n := 0
	for _, e := range m.entries {
		if !e.Deleted {
			n++
		}
	}
	return n
}

// Snapshot returns a copy of all non-deleted key-value pairs.
func (m *Map) Snapshot() map[string]json.RawMessage {
	m.mu.RLock()
	defer m.mu.RUnlock()
	snap := make(map[string]json.RawMessage, len(m.entries))
	for k, e := range m.entries {
		if !e.Deleted {
			snap[k] = e.Value
		}
	}
	return snap
}

// handleSet processes a replicated set operation from another node.
func (m *Map) handleSet(_ context.Context, msg *pubsub.Message) error {
	// Ignore our own publishes (already applied locally)
	if msg.OriginNode == m.id {
		return nil
	}

	var p setPayload
	if err := json.Unmarshal(msg.Payload, &p); err != nil {
		return nil // bad payload, don't retry
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.entries[p.Key]
	if ok && existing.Timestamp >= p.Timestamp {
		return nil // stale write
	}
	m.entries[p.Key] = entry{Value: p.Value, Timestamp: p.Timestamp}
	return nil
}

// handleDelete processes a replicated delete operation from another node.
func (m *Map) handleDelete(_ context.Context, msg *pubsub.Message) error {
	if msg.OriginNode == m.id {
		return nil
	}

	var p deletePayload
	if err := json.Unmarshal(msg.Payload, &p); err != nil {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	existing, ok := m.entries[p.Key]
	if ok && existing.Timestamp >= p.Timestamp {
		return nil
	}
	m.entries[p.Key] = entry{Deleted: true, Timestamp: p.Timestamp}
	return nil
}

// handleSyncRequest responds to anti-entropy sync requests with our full state.
func (m *Map) handleSyncRequest(_ context.Context, msg *pubsub.Message) error {
	if msg.ReplyTo == "" || msg.OriginNode == m.id {
		return nil
	}

	m.mu.RLock()
	state := make(map[string]entry, len(m.entries))
	for k, v := range m.entries {
		state[k] = v
	}
	m.mu.RUnlock()

	payload, _ := json.Marshal(syncPayload{Entries: state})
	_, err := m.node.Reply(context.Background(), msg, m.id, payload)
	return err
}

// requestSync asks an existing peer for its full state and merges it.
// Retries a few times since the mesh may not have exchanged topic info yet.
func (m *Map) requestSync(ctx context.Context) {
	deadline := time.Now().Add(m.syncTimeout)

	for time.Now().Before(deadline) {
		attemptCtx, cancel := context.WithTimeout(ctx, time.Second)
		reply, err := m.node.Request(attemptCtx, m.id, topicSync, json.RawMessage(`{}`))
		cancel()

		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}

		var sp syncPayload
		if err := json.Unmarshal(reply.Payload, &sp); err != nil {
			log.Printf("hashmap: bad sync response: %v", err)
			return
		}

		m.mu.Lock()
		merged := 0
		for k, remote := range sp.Entries {
			local, ok := m.entries[k]
			if !ok || remote.Timestamp > local.Timestamp {
				m.entries[k] = remote
				merged++
			}
		}
		m.mu.Unlock()
		log.Printf("hashmap: synced %d entries from peer", merged)
		return
	}

	log.Printf("hashmap: anti-entropy sync skipped (no peers responded)")
}

// ForEach iterates over all non-deleted entries. The callback must not modify
// the map. Iteration order is non-deterministic.
func (m *Map) ForEach(fn func(key string, value json.RawMessage) bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for k, e := range m.entries {
		if e.Deleted {
			continue
		}
		if !fn(k, e.Value) {
			return
		}
	}
}

// String returns a human-readable summary.
func (m *Map) String() string {
	return fmt.Sprintf("DistributedMap{node=%s, keys=%d}", m.id, m.Len())
}
