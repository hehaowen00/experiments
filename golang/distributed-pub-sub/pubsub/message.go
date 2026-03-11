package pubsub

import (
	"context"
	"encoding/json"
)

// Message is the envelope wrapping all payloads in the pub/sub system.
// Every message carries a source (publisher identity) and destination (topic).
type Message struct {
	ID          string          `json:"id"`
	Source      string          `json:"source"`
	Destination string          `json:"destination"`
	Payload     json.RawMessage `json:"payload"`
	Timestamp   int64           `json:"timestamp"`
	Sequence    uint64          `json:"seq"`
	OriginNode  string          `json:"origin_node"`
	ReplyTo     string          `json:"reply_to,omitempty"`

	// Stream fields — used internally for chunked transfer. Subscribers
	// never see these; the payload is always the fully reassembled data.
	StreamID    string `json:"-"`
	ChunkIndex  uint32 `json:"-"`
	TotalChunks uint32 `json:"-"`
}

// Handler processes a delivered message. Return nil to acknowledge successful
// delivery to the end-user client. Return an error to trigger a retry.
type Handler func(ctx context.Context, msg *Message) error
