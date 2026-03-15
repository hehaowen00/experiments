package storage

import (
	"fmt"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// MemoryQueue - thread-safe ring buffer backed by a slice
// ---------------------------------------------------------------------------

// MemoryQueue implements QueueStore using an in-memory ring buffer.
type MemoryQueue struct {
	mu   sync.Mutex
	buf  []*Message
	head int
	tail int
	len  int
	cap  int
}

// NewMemoryQueue creates a ring buffer queue with the given capacity.
func NewMemoryQueue(capacity int) *MemoryQueue {
	if capacity <= 0 {
		capacity = 1024
	}
	return &MemoryQueue{
		buf: make([]*Message, capacity),
		cap: capacity,
	}
}

func (q *MemoryQueue) Enqueue(msg *Message) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.len == q.cap {
		// grow by doubling
		q.grow()
	}

	q.buf[q.tail] = msg
	q.tail = (q.tail + 1) % q.cap
	q.len++
	return nil
}

func (q *MemoryQueue) grow() {
	newCap := q.cap * 2
	newBuf := make([]*Message, newCap)
	for i := 0; i < q.len; i++ {
		newBuf[i] = q.buf[(q.head+i)%q.cap]
	}
	q.buf = newBuf
	q.head = 0
	q.tail = q.len
	q.cap = newCap
}

func (q *MemoryQueue) Dequeue() (*Message, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	if q.len == 0 {
		return nil, nil
	}

	msg := q.buf[q.head]
	q.buf[q.head] = nil // allow GC
	q.head = (q.head + 1) % q.cap
	q.len--
	return msg, nil
}

func (q *MemoryQueue) Len() (int, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.len, nil
}

func (q *MemoryQueue) Close() error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.buf = nil
	q.len = 0
	q.head = 0
	q.tail = 0
	return nil
}

// NewMemoryQueueFactory returns a QueueFactory that creates MemoryQueue
// instances with the given initial capacity.
func NewMemoryQueueFactory(capacity int) QueueFactory {
	return func(topic, subscriberID string) QueueStore {
		return NewMemoryQueue(capacity)
	}
}

// ---------------------------------------------------------------------------
// MemoryDLQ - map-based dead-letter queue
// ---------------------------------------------------------------------------

// MemoryDLQ implements DLQStore using in-memory maps.
type MemoryDLQ struct {
	mu      sync.Mutex
	byTopic map[string][]*DeadLetter
	byID    map[string]*DeadLetter
	nextID  int64
}

// NewMemoryDLQ creates a new in-memory dead-letter queue store.
func NewMemoryDLQ() *MemoryDLQ {
	return &MemoryDLQ{
		byTopic: make(map[string][]*DeadLetter),
		byID:    make(map[string]*DeadLetter),
	}
}

func (d *MemoryDLQ) Add(msg *DeadLetter) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if msg.ID == "" {
		d.nextID++
		msg.ID = fmt.Sprintf("dlq-%d", d.nextID)
	}

	d.byTopic[msg.OriginalTopic] = append(d.byTopic[msg.OriginalTopic], msg)
	d.byID[msg.ID] = msg
	return nil
}

func (d *MemoryDLQ) List(topic string, limit, offset int) ([]*DeadLetter, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	msgs := d.byTopic[topic]
	if offset >= len(msgs) {
		return nil, nil
	}

	end := offset + limit
	if end > len(msgs) {
		end = len(msgs)
	}

	result := make([]*DeadLetter, end-offset)
	copy(result, msgs[offset:end])
	return result, nil
}

func (d *MemoryDLQ) Retry(id string) (*Message, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	dl, ok := d.byID[id]
	if !ok {
		return nil, fmt.Errorf("dead letter %q not found", id)
	}

	// remove from byTopic slice
	topic := dl.OriginalTopic
	msgs := d.byTopic[topic]
	for i, m := range msgs {
		if m.ID == id {
			d.byTopic[topic] = append(msgs[:i], msgs[i+1:]...)
			break
		}
	}
	delete(d.byID, id)

	return &Message{
		ID:          dl.MessageID,
		Source:      dl.Source,
		Destination: dl.OriginalTopic,
		Payload:     dl.Payload,
		Timestamp:   dl.DeadAt,
		Attempt:     dl.Attempts,
	}, nil
}

func (d *MemoryDLQ) Purge(topic string) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	msgs := d.byTopic[topic]
	count := len(msgs)
	for _, m := range msgs {
		delete(d.byID, m.ID)
	}
	delete(d.byTopic, topic)
	return count, nil
}

func (d *MemoryDLQ) Count(topic string) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	return len(d.byTopic[topic]), nil
}

func (d *MemoryDLQ) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.byTopic = nil
	d.byID = nil
	return nil
}

// ---------------------------------------------------------------------------
// MemoryDedup - sync.Map based deduplication store
// ---------------------------------------------------------------------------

type dedupEntry struct {
	seenAt time.Time
}

// MemoryDedup implements DeduplicationStore using sync.Map.
type MemoryDedup struct {
	seen sync.Map
}

// NewMemoryDedup creates a new in-memory deduplication store.
func NewMemoryDedup() *MemoryDedup {
	return &MemoryDedup{}
}

func (d *MemoryDedup) MarkSeen(messageID string) (bool, error) {
	_, loaded := d.seen.LoadOrStore(messageID, dedupEntry{seenAt: time.Now()})
	return loaded, nil
}

func (d *MemoryDedup) Cleanup(olderThan time.Duration) error {
	cutoff := time.Now().Add(-olderThan)
	d.seen.Range(func(key, value any) bool {
		entry := value.(dedupEntry)
		if entry.seenAt.Before(cutoff) {
			d.seen.Delete(key)
		}
		return true
	})
	return nil
}

func (d *MemoryDedup) Close() error {
	// Clear all entries.
	d.seen.Range(func(key, _ any) bool {
		d.seen.Delete(key)
		return true
	})
	return nil
}
