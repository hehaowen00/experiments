package storage

import "time"

// QueueStore is a per-subscriber persistent message queue.
type QueueStore interface {
	Enqueue(msg *Message) error
	Dequeue() (*Message, error) // returns nil, nil if empty
	Len() (int, error)
	Close() error
}

// DLQStore stores dead-letter messages.
type DLQStore interface {
	Add(msg *DeadLetter) error
	List(topic string, limit, offset int) ([]*DeadLetter, error)
	Retry(id string) (*Message, error) // removes from DLQ and returns as Message
	Purge(topic string) (int, error)   // removes all for topic, returns count
	Count(topic string) (int, error)
	Close() error
}

// DeduplicationStore tracks seen message IDs for dedup.
type DeduplicationStore interface {
	MarkSeen(messageID string) (alreadySeen bool, err error)
	Cleanup(olderThan time.Duration) error
	Close() error
}

// QueueFactory creates QueueStore instances per topic+subscriber.
type QueueFactory func(topic, subscriberID string) QueueStore

// Message mirrors pubsub.Message for storage layer independence.
type Message struct {
	ID          string
	Source      string
	Destination string
	Payload     []byte
	Timestamp   int64
	Sequence    int64
	ReplyTo     string
	StreamID    string
	Attempt     int32
}

// DeadLetter represents a message that failed delivery.
type DeadLetter struct {
	ID            string
	OriginalTopic string
	Source        string
	Payload       []byte
	Reason        string
	Attempts      int32
	DeadAt        int64
	MessageID     string // original message ID
}
