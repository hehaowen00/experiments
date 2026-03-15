package pubsub

// Message represents a message in the pub-sub system
type Message struct {
	ID          string
	Source      string
	Destination string // topic
	Payload     []byte
	Timestamp   int64
	Sequence    int64
	ReplyTo     string // for request-response pattern
	StreamID    string // for streaming
	Attempt     int32  // delivery attempt count
}

// Handler processes a received message. Return error to trigger retry.
type Handler func(msg *Message) error
