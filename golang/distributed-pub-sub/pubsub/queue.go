package pubsub

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
)

// QueueStore is a FIFO buffer for subscriber overflow. When the in-memory
// channel is full, messages spill here instead of being dropped.
type QueueStore interface {
	Enqueue(msg *Message) error
	Dequeue() (*Message, bool)
	Len() int
	Close() error
}

// QueueFactory creates a QueueStore for each subscriber. The topic and
// subscriberID identify which subscriber needs the store.
type QueueFactory func(topic, subscriberID string) QueueStore

// MemoryQueue is an unbounded in-memory overflow buffer.
type MemoryQueue struct {
	mu    sync.Mutex
	items []*Message
}

func NewMemoryQueue() *MemoryQueue {
	return &MemoryQueue{}
}

func (q *MemoryQueue) Enqueue(msg *Message) error {
	q.mu.Lock()
	q.items = append(q.items, msg)
	q.mu.Unlock()
	return nil
}

func (q *MemoryQueue) Dequeue() (*Message, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if len(q.items) == 0 {
		return nil, false
	}
	msg := q.items[0]
	q.items = q.items[1:]
	return msg, true
}

func (q *MemoryQueue) Len() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.items)
}

func (q *MemoryQueue) Close() error { return nil }

// MemoryQueueFactory creates in-memory overflow queues.
func MemoryQueueFactory() QueueFactory {
	return func(topic, subscriberID string) QueueStore {
		return NewMemoryQueue()
	}
}

// FileQueue persists overflow messages to a directory on disk. Each message
// is stored as a numbered JSON file for simplicity and crash safety.
type FileQueue struct {
	dir     string
	counter atomic.Uint64
	mu      sync.Mutex
}

// NewFileQueue creates a file-backed queue in the given directory.
func NewFileQueue(dir string) (*FileQueue, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create queue dir: %w", err)
	}
	q := &FileQueue{dir: dir}

	// Find the highest existing sequence number to resume from
	entries, _ := os.ReadDir(dir)
	var maxSeq uint64
	for _, e := range entries {
		var seq uint64
		if _, err := fmt.Sscanf(e.Name(), "%d.json", &seq); err == nil {
			if seq > maxSeq {
				maxSeq = seq
			}
		}
	}
	q.counter.Store(maxSeq)

	return q, nil
}

func (q *FileQueue) Enqueue(msg *Message) error {
	seq := q.counter.Add(1)
	path := filepath.Join(q.dir, fmt.Sprintf("%012d.json", seq))

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o644)
}

func (q *FileQueue) Dequeue() (*Message, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()

	entries, err := os.ReadDir(q.dir)
	if err != nil || len(entries) == 0 {
		return nil, false
	}

	// Sort to get lowest-numbered file first
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	path := filepath.Join(q.dir, entries[0].Name())
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}

	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		os.Remove(path)
		return nil, false
	}

	os.Remove(path)
	return &msg, true
}

func (q *FileQueue) Len() int {
	entries, err := os.ReadDir(q.dir)
	if err != nil {
		return 0
	}
	return len(entries)
}

func (q *FileQueue) Close() error { return nil }

// FileQueueFactory creates file-backed overflow queues under baseDir.
// Each subscriber gets its own subdirectory.
func FileQueueFactory(baseDir string) QueueFactory {
	return func(topic, subscriberID string) QueueStore {
		dir := filepath.Join(baseDir, topic, subscriberID)
		q, err := NewFileQueue(dir)
		if err != nil {
			// Fall back to memory if disk fails
			return NewMemoryQueue()
		}
		return q
	}
}
