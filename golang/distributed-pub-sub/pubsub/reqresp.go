package pubsub

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Request performs a request-response exchange over the pub-sub system.
// It publishes a message to the given topic with a unique reply topic set,
// then waits for a single response (or until the timeout/context expires).
func (n *Node) Request(ctx context.Context, topic string, payload []byte, timeout time.Duration) (*Message, error) {
	replyTopic := fmt.Sprintf("_reply.%s", uuid.New().String())

	respCh := make(chan *Message, 1)
	errCh := make(chan error, 1)

	subID, err := n.Subscribe(replyTopic, func(msg *Message) error {
		select {
		case respCh <- msg:
		default:
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("subscribe to reply topic: %w", err)
	}
	defer n.Unsubscribe(subID)

	msg := &Message{
		ID:          uuid.New().String(),
		Source:      n.opts.NodeID,
		Destination: topic,
		Payload:     payload,
		Timestamp:   time.Now().UnixNano(),
		ReplyTo:     replyTopic,
	}

	if err := n.Publish(msg); err != nil {
		return nil, fmt.Errorf("publish request: %w", err)
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	select {
	case resp := <-respCh:
		return resp, nil
	case err := <-errCh:
		return nil, err
	case <-timeoutCtx.Done():
		return nil, errors.New("request timed out")
	}
}

// Reply sends a response to a request message by publishing to the
// original message's ReplyTo topic.
func (n *Node) Reply(original *Message, payload []byte) error {
	if original.ReplyTo == "" {
		return errors.New("message has no ReplyTo topic")
	}

	resp := &Message{
		ID:          uuid.New().String(),
		Source:      n.opts.NodeID,
		Destination: original.ReplyTo,
		Payload:     payload,
		Timestamp:   time.Now().UnixNano(),
	}

	return n.Publish(resp)
}
