package service

import (
	"context"
	"fmt"
	"time"

	"distributed-pub-sub/pubsub"

	"github.com/google/uuid"
)

// Transport abstracts the communication layer.
type Transport interface {
	// Publish sends a message to a topic.
	Publish(topic string, data []byte) error
	// Subscribe registers a handler for a topic.
	// The handler receives data and returns a response (for request-response patterns).
	Subscribe(topic string, handler func(data []byte) []byte) error
	// Request sends a request and waits for a response.
	Request(ctx context.Context, topic string, data []byte, timeout time.Duration) ([]byte, error)
	// Close shuts down the transport.
	Close() error
}

// EmbeddedTransport wraps a pubsub.Node directly for in-process use.
type EmbeddedTransport struct {
	node *pubsub.Node
}

// NewEmbeddedTransport creates a new EmbeddedTransport wrapping the given node.
func NewEmbeddedTransport(node *pubsub.Node) *EmbeddedTransport {
	return &EmbeddedTransport{node: node}
}

// Publish sends a message to the specified topic.
func (t *EmbeddedTransport) Publish(topic string, data []byte) error {
	msg := &pubsub.Message{
		ID:          uuid.New().String(),
		Destination: topic,
		Payload:     data,
		Timestamp:   time.Now().UnixNano(),
	}
	return t.node.Publish(msg)
}

// Subscribe registers a handler for messages on the specified topic.
// When a message with ReplyTo set is received, the handler's response is
// published to the ReplyTo topic.
func (t *EmbeddedTransport) Subscribe(topic string, handler func(data []byte) []byte) error {
	_, err := t.node.Subscribe(topic, func(msg *pubsub.Message) error {
		result := handler(msg.Payload)
		if msg.ReplyTo != "" && result != nil {
			reply := &pubsub.Message{
				ID:          uuid.New().String(),
				Destination: msg.ReplyTo,
				Payload:     result,
				Timestamp:   time.Now().UnixNano(),
			}
			return t.node.Publish(reply)
		}
		return nil
	})
	return err
}

// Request sends a request to the specified topic and waits for a response.
// It delegates to the underlying node's Request method, which handles
// reply topic creation, subscription, and timeout internally.
func (t *EmbeddedTransport) Request(ctx context.Context, topic string, data []byte, timeout time.Duration) ([]byte, error) {
	resp, err := t.node.Request(ctx, topic, data, timeout)
	if err != nil {
		return nil, fmt.Errorf("request to %s failed: %w", topic, err)
	}
	return resp.Payload, nil
}

// Close is a no-op for EmbeddedTransport because the node's lifecycle
// is managed externally.
func (t *EmbeddedTransport) Close() error {
	return nil
}
