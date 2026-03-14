package service

import (
	"context"
	"encoding/json"

	"distributed-pub-sub/pubsub"
)

// Message is the service-layer message envelope, decoupled from pubsub internals.
type Message struct {
	ID        string          `json:"id"`
	Source    string          `json:"source"`
	Topic     string          `json:"topic"`
	Payload   json.RawMessage `json:"payload"`
	Timestamp int64           `json:"timestamp"`
	ReplyTo   string          `json:"reply_to,omitempty"`
}

// MessageHandler processes a message delivered via a Transport.
type MessageHandler func(ctx context.Context, msg *Message) error

// Transport abstracts the connection to the pubsub mesh. Services use this
// interface instead of embedding a pubsub.Node directly.
type Transport interface {
	// Publish sends a message to all subscribers of the topic.
	Publish(ctx context.Context, source, topic string, payload json.RawMessage) (string, error)

	// Subscribe registers a handler for a topic.
	Subscribe(topic, id string, handler MessageHandler) error

	// Unsubscribe removes a subscription.
	Unsubscribe(topic, id string) error

	// Request sends a message and blocks until a reply is received.
	Request(ctx context.Context, source, topic string, payload json.RawMessage) (*Message, error)

	// Reply publishes a response to a message's ReplyTo topic.
	Reply(ctx context.Context, replyTo, source string, payload json.RawMessage) (string, error)
}

// EmbeddedTransport wraps a *pubsub.Node for in-process use. Good for tests
// and single-binary deployments.
type EmbeddedTransport struct {
	Node *pubsub.Node
}

func (t *EmbeddedTransport) Publish(ctx context.Context, source, topic string, payload json.RawMessage) (string, error) {
	return t.Node.Publish(ctx, source, topic, payload)
}

func (t *EmbeddedTransport) Subscribe(topic, id string, handler MessageHandler) error {
	return t.Node.Subscribe(topic, id, func(ctx context.Context, m *pubsub.Message) error {
		return handler(ctx, &Message{
			ID:        m.ID,
			Source:    m.Source,
			Topic:     m.Destination,
			Payload:   m.Payload,
			Timestamp: m.Timestamp,
			ReplyTo:   m.ReplyTo,
		})
	})
}

func (t *EmbeddedTransport) Unsubscribe(topic, id string) error {
	return t.Node.Unsubscribe(topic, id)
}

func (t *EmbeddedTransport) Request(ctx context.Context, source, topic string, payload json.RawMessage) (*Message, error) {
	reply, err := t.Node.Request(ctx, source, topic, payload)
	if err != nil {
		return nil, err
	}
	return &Message{
		ID:        reply.ID,
		Source:    reply.Source,
		Topic:     reply.Destination,
		Payload:   reply.Payload,
		Timestamp: reply.Timestamp,
	}, nil
}

func (t *EmbeddedTransport) Reply(ctx context.Context, replyTo, source string, payload json.RawMessage) (string, error) {
	return t.Node.Publish(ctx, source, replyTo, payload)
}
