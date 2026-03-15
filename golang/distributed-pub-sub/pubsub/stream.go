package pubsub

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Stream provides bidirectional streaming over the pub-sub system.
// Each stream has a unique ID and is backed by a dedicated subscription
// on the internal topic _stream.<id>.
type Stream struct {
	ID     string
	Topic  string
	node   *Node
	subID  string
	ch     chan *Message
	ctx    context.Context
	cancel context.CancelFunc
}

// OpenStream creates a new bidirectional stream on the given topic.
// The stream subscribes to an internal reply topic (_stream.<id>) for
// receiving messages, and publishes outgoing messages to the specified topic
// with the StreamID field set.
func (n *Node) OpenStream(topic string) (*Stream, error) {
	streamID := uuid.New().String()
	ctx, cancel := context.WithCancel(context.Background())

	s := &Stream{
		ID:     streamID,
		Topic:  topic,
		node:   n,
		ch:     make(chan *Message, n.opts.ChannelSize),
		ctx:    ctx,
		cancel: cancel,
	}

	internalTopic := fmt.Sprintf("_stream.%s", streamID)
	subID, err := n.Subscribe(internalTopic, func(msg *Message) error {
		select {
		case s.ch <- msg:
		case <-s.ctx.Done():
		}
		return nil
	})
	if err != nil {
		cancel()
		return nil, fmt.Errorf("subscribe to stream topic: %w", err)
	}
	s.subID = subID

	return s, nil
}

// Send publishes a message on the stream's topic with the StreamID set.
func (s *Stream) Send(payload []byte) error {
	select {
	case <-s.ctx.Done():
		return errors.New("stream closed")
	default:
	}

	msg := &Message{
		ID:          uuid.New().String(),
		Source:      s.node.opts.NodeID,
		Destination: s.Topic,
		Payload:     payload,
		Timestamp:   time.Now().UnixNano(),
		StreamID:    s.ID,
	}

	return s.node.Publish(msg)
}

// Receive blocks until a message arrives on the stream or the stream is closed.
func (s *Stream) Receive() (*Message, error) {
	select {
	case msg, ok := <-s.ch:
		if !ok {
			return nil, errors.New("stream closed")
		}
		return msg, nil
	case <-s.ctx.Done():
		return nil, errors.New("stream closed")
	}
}

// Close tears down the stream by unsubscribing and closing the channel.
func (s *Stream) Close() error {
	s.cancel()
	if s.subID != "" {
		if err := s.node.Unsubscribe(s.subID); err != nil {
			return fmt.Errorf("unsubscribe stream: %w", err)
		}
	}
	close(s.ch)
	return nil
}
