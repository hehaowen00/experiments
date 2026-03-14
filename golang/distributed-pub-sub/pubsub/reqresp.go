package pubsub

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Request publishes a message and blocks until a reply is received or the context
// is cancelled. The responder should call Reply() with the original message.
func (n *Node) Request(ctx context.Context, source, topic string, payload json.RawMessage) (*Message, error) {
	replyTopic := "_reply." + uuid.New().String()
	replyCh := make(chan *Message, 1)

	subID := replyTopic
	if err := n.Subscribe(replyTopic, subID, func(_ context.Context, msg *Message) error {
		select {
		case replyCh <- msg:
		default:
		}
		return nil
	}); err != nil {
		return nil, fmt.Errorf("subscribe reply topic: %w", err)
	}

	defer n.Unsubscribe(replyTopic, subID)

	// Publish the request with ReplyTo set
	if n.draining.Load() {
		return nil, fmt.Errorf("node is draining")
	}
	if n.limiter != nil && !n.limiter.allow(source) {
		n.stats.RateLimited.Add(1)
		return nil, fmt.Errorf("rate limit exceeded for source %s", source)
	}

	seq := n.nextSequence(source, topic)
	msg := &Message{
		ID:          uuid.New().String(),
		Source:      source,
		Destination: topic,
		Payload:     payload,
		Timestamp:   time.Now().UnixMilli(),
		Sequence:    seq,
		OriginNode:  n.opts.ID,
		ReplyTo:     replyTopic,
	}

	n.seen.Store(msg.ID, time.Now())
	n.stats.Published.Add(1)
	n.deliverLocal(msg)

	n.inflight.Go(func() {
		n.forwardToPeers(msg)
	})

	select {
	case reply := <-replyCh:
		return reply, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Reply publishes a response to a request message. The reply is sent to the
// original message's ReplyTo topic.
func (n *Node) Reply(ctx context.Context, request *Message, source string, payload json.RawMessage) (string, error) {
	if request.ReplyTo == "" {
		return "", fmt.Errorf("message has no ReplyTo field")
	}
	return n.Publish(ctx, source, request.ReplyTo, payload)
}
