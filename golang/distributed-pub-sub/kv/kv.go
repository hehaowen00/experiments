package kv

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"distributed-pub-sub/pubsub"
	"distributed-pub-sub/service"
)

const (
	replicationTopic = "kv.writes"
	serviceName      = "kv"
)

// writeOp is the replication message format.
type writeOp struct {
	Op     string `json:"op"`               // "set" or "delete"
	Key    string `json:"key"`
	Value  []byte `json:"value,omitempty"`
	TTL    int64  `json:"ttl,omitempty"`     // nanoseconds, 0 = no TTL
	Origin string `json:"origin"`           // node ID to skip echo
}

// kvRequest is the JSON payload for service RPC calls.
type kvRequest struct {
	Key   string `json:"key"`
	Value []byte `json:"value,omitempty"`
	TTL   int64  `json:"ttl,omitempty"`
}

type entry struct {
	Value     []byte
	ExpiresAt time.Time
}

func (e *entry) expired() bool {
	return !e.ExpiresAt.IsZero() && time.Now().After(e.ExpiresAt)
}

// Store is a distributed key-value cache backed by pub-sub replication.
type Store struct {
	mu   sync.RWMutex
	data map[string]*entry

	node   *pubsub.Node
	svc    *service.Service
	subID  string
	nodeID string

	watches map[string][]func(key string, value []byte, deleted bool)
	watchMu sync.RWMutex

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// NewStore creates a new distributed KV store on top of the given node.
func NewStore(node *pubsub.Node) *Store {
	transport := service.NewEmbeddedTransport(node)
	svc := service.NewService(serviceName, transport)
	ctx, cancel := context.WithCancel(context.Background())

	s := &Store{
		data:    make(map[string]*entry),
		node:    node,
		svc:     svc,
		nodeID:  node.NodeID(),
		watches: make(map[string][]func(string, []byte, bool)),
		ctx:     ctx,
		cancel:  cancel,
	}

	svc.Handle("get", s.handleGet)
	svc.Handle("set", s.handleSet)
	svc.Handle("delete", s.handleDelete)
	svc.Handle("list", s.handleList)

	return s
}

// Start subscribes to the replication topic and starts the service.
func (s *Store) Start() error {
	subID, err := s.node.Subscribe(replicationTopic, func(msg *pubsub.Message) error {
		var op writeOp
		if err := json.Unmarshal(msg.Payload, &op); err != nil {
			log.Printf("[kv] invalid replication message: %v", err)
			return nil
		}
		if op.Origin == s.nodeID {
			return nil
		}
		s.applyWrite(op)
		return nil
	})
	if err != nil {
		return fmt.Errorf("subscribe to replication topic: %w", err)
	}
	s.subID = subID

	// Start TTL cleanup.
	s.wg.Add(1)
	go s.ttlLoop()

	return s.svc.Start()
}

// Stop shuts down the KV store.
func (s *Store) Stop() error {
	s.cancel()
	s.wg.Wait()
	if s.subID != "" {
		s.node.Unsubscribe(s.subID)
	}
	return s.svc.Stop()
}

// Get returns the value for the key, or nil and false if not found/expired.
func (s *Store) Get(key string) ([]byte, bool) {
	s.mu.RLock()
	e, ok := s.data[key]
	s.mu.RUnlock()

	if !ok || e.expired() {
		return nil, false
	}
	return e.Value, true
}

// Set stores a key-value pair and replicates it to peers.
func (s *Store) Set(key string, value []byte, ttl time.Duration) {
	e := &entry{Value: value}
	if ttl > 0 {
		e.ExpiresAt = time.Now().Add(ttl)
	}

	s.mu.Lock()
	s.data[key] = e
	s.mu.Unlock()

	s.fireWatch(key, value, false)
	s.replicate(writeOp{
		Op:     "set",
		Key:    key,
		Value:  value,
		TTL:    int64(ttl),
		Origin: s.nodeID,
	})
}

// Delete removes a key and replicates the deletion to peers.
func (s *Store) Delete(key string) {
	s.mu.Lock()
	delete(s.data, key)
	s.mu.Unlock()

	s.fireWatch(key, nil, true)
	s.replicate(writeOp{
		Op:     "delete",
		Key:    key,
		Origin: s.nodeID,
	})
}

// Keys returns all non-expired keys.
func (s *Store) Keys() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	keys := make([]string, 0, len(s.data))
	for k, e := range s.data {
		if !e.expired() {
			keys = append(keys, k)
		}
	}
	return keys
}

// Watch registers a callback that fires when the given key is modified.
func (s *Store) Watch(key string, cb func(key string, value []byte, deleted bool)) {
	s.watchMu.Lock()
	s.watches[key] = append(s.watches[key], cb)
	s.watchMu.Unlock()
}

// RemoteGet fetches a key from a peer node via request-response.
func (s *Store) RemoteGet(ctx context.Context, key string, timeout time.Duration) ([]byte, error) {
	payload, _ := json.Marshal(kvRequest{Key: key})
	resp, err := s.svc.Call(ctx, serviceName, "get", payload, timeout)
	if err != nil {
		return nil, err
	}
	if resp.Error != "" {
		return nil, fmt.Errorf("%s", resp.Error)
	}
	return resp.Payload, nil
}

// --- internal ---

func (s *Store) replicate(op writeOp) {
	payload, err := json.Marshal(op)
	if err != nil {
		log.Printf("[kv] failed to marshal write op: %v", err)
		return
	}
	s.node.Publish(&pubsub.Message{
		Source:      s.nodeID,
		Destination: replicationTopic,
		Payload:     payload,
	})
}

func (s *Store) applyWrite(op writeOp) {
	switch op.Op {
	case "set":
		e := &entry{Value: op.Value}
		if op.TTL > 0 {
			e.ExpiresAt = time.Now().Add(time.Duration(op.TTL))
		}
		s.mu.Lock()
		s.data[op.Key] = e
		s.mu.Unlock()
		s.fireWatch(op.Key, op.Value, false)

	case "delete":
		s.mu.Lock()
		delete(s.data, op.Key)
		s.mu.Unlock()
		s.fireWatch(op.Key, nil, true)
	}
}

func (s *Store) fireWatch(key string, value []byte, deleted bool) {
	s.watchMu.RLock()
	cbs := s.watches[key]
	s.watchMu.RUnlock()

	for _, cb := range cbs {
		cb(key, value, deleted)
	}
}

func (s *Store) ttlLoop() {
	defer s.wg.Done()
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()
			for k, e := range s.data {
				if e.expired() {
					delete(s.data, k)
				}
			}
			s.mu.Unlock()
		}
	}
}

// --- service handlers ---

func (s *Store) handleGet(req *service.Request) *service.Response {
	var r kvRequest
	if err := json.Unmarshal(req.Payload, &r); err != nil {
		return &service.Response{Error: "invalid request"}
	}
	val, ok := s.Get(r.Key)
	if !ok {
		return &service.Response{Error: "key not found"}
	}
	return &service.Response{Payload: val}
}

func (s *Store) handleSet(req *service.Request) *service.Response {
	var r kvRequest
	if err := json.Unmarshal(req.Payload, &r); err != nil {
		return &service.Response{Error: "invalid request"}
	}
	s.Set(r.Key, r.Value, time.Duration(r.TTL))
	return &service.Response{}
}

func (s *Store) handleDelete(req *service.Request) *service.Response {
	var r kvRequest
	if err := json.Unmarshal(req.Payload, &r); err != nil {
		return &service.Response{Error: "invalid request"}
	}
	s.Delete(r.Key)
	return &service.Response{}
}

func (s *Store) handleList(req *service.Request) *service.Response {
	keys := s.Keys()
	payload, _ := json.Marshal(keys)
	return &service.Response{Payload: payload}
}
