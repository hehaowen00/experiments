package pubsub

import (
	"context"
	"log"
	"sync"
	"time"

	"distributed-pub-sub/pubsub/storage"

	"github.com/google/uuid"
)

// Subscriber manages per-subscriber message delivery with retry and DLQ support.
type Subscriber struct {
	ID      string
	Topic   string
	handler Handler
	ch      chan *Message
	queue   storage.QueueStore // overflow queue
	dlq     storage.DLQStore   // dead letter queue (may be nil)
	opts    Options
	stats   *Stats
	ctx     context.Context
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

// NewSubscriber creates a new Subscriber. The dlq parameter may be nil to disable
// dead-letter storage.
func NewSubscriber(id, topic string, handler Handler, queue storage.QueueStore, dlq storage.DLQStore, opts Options, stats *Stats) *Subscriber {
	ctx, cancel := context.WithCancel(context.Background())
	return &Subscriber{
		ID:      id,
		Topic:   topic,
		handler: handler,
		ch:      make(chan *Message, opts.ChannelSize),
		queue:   queue,
		dlq:     dlq,
		opts:    opts,
		stats:   stats,
		ctx:     ctx,
		cancel:  cancel,
	}
}

// Start launches the delivery goroutine.
func (s *Subscriber) Start() {
	s.wg.Add(1)
	go s.deliverLoop()
}

// Stop cancels the delivery goroutine and waits for it to finish.
func (s *Subscriber) Stop() {
	s.cancel()
	s.wg.Wait()
}

// Deliver attempts to send a message to the subscriber's channel.
// If the channel is full, the message overflows to the persistent queue.
func (s *Subscriber) Deliver(msg *Message) {
	select {
	case s.ch <- msg:
	default:
		// Channel full, overflow to persistent queue.
		smsg := toStorageMessage(msg)
		if err := s.queue.Enqueue(smsg); err != nil {
			log.Printf("[subscriber:%s] overflow enqueue failed: %v", s.ID, err)
		}
	}
}

func (s *Subscriber) deliverLoop() {
	defer s.wg.Done()

	drainTicker := time.NewTicker(100 * time.Millisecond)
	defer drainTicker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			return
		case msg := <-s.ch:
			s.processMessage(msg)
		case <-drainTicker.C:
			s.drainOverflow()
		}
	}
}

// drainOverflow pulls messages from the persistent queue when the channel is empty.
func (s *Subscriber) drainOverflow() {
	// Only drain if the channel has capacity.
	if len(s.ch) > 0 {
		return
	}

	for {
		smsg, err := s.queue.Dequeue()
		if err != nil {
			log.Printf("[subscriber:%s] overflow dequeue failed: %v", s.ID, err)
			return
		}
		if smsg == nil {
			return // queue empty
		}

		msg := fromStorageMessage(smsg)
		s.processMessage(msg)

		// Check context between messages.
		select {
		case <-s.ctx.Done():
			return
		default:
		}

		// Stop draining if channel has new direct messages.
		if len(s.ch) > 0 {
			return
		}
	}
}

// processMessage attempts to deliver a message to the handler with retry logic.
func (s *Subscriber) processMessage(msg *Message) {
	var lastErr error

	for attempt := int(msg.Attempt); attempt <= s.opts.MaxRetries; attempt++ {
		msg.Attempt = int32(attempt)
		lastErr = s.handler(msg)
		if lastErr == nil {
			s.stats.MessagesDelivered.Add(1)
			return
		}

		s.stats.MessagesFailed.Add(1)

		// If we have exhausted retries, don't sleep.
		if attempt >= s.opts.MaxRetries {
			break
		}

		// Exponential backoff: base * 2^attempt, capped at max.
		delay := s.opts.RetryBaseDelay * (1 << uint(attempt))
		if delay > s.opts.RetryMaxDelay {
			delay = s.opts.RetryMaxDelay
		}

		select {
		case <-s.ctx.Done():
			return
		case <-time.After(delay):
		}
	}

	// All retries exhausted, send to DLQ.
	s.sendToDLQ(msg, lastErr)
}

// sendToDLQ stores a failed message in the dead-letter queue.
func (s *Subscriber) sendToDLQ(msg *Message, reason error) {
	s.stats.MessagesDLQ.Add(1)

	if s.dlq == nil {
		log.Printf("[subscriber:%s] message %s exhausted %d retries (no DLQ configured): %v",
			s.ID, msg.ID, s.opts.MaxRetries, reason)
		return
	}

	dl := &storage.DeadLetter{
		ID:            uuid.New().String(),
		OriginalTopic: msg.Destination,
		Source:        msg.Source,
		Payload:       msg.Payload,
		Reason:        reason.Error(),
		Attempts:      int32(s.opts.MaxRetries),
		DeadAt:        time.Now().UnixNano(),
		MessageID:     msg.ID,
	}

	if err := s.dlq.Add(dl); err != nil {
		log.Printf("[subscriber:%s] DLQ add failed for message %s: %v", s.ID, msg.ID, err)
	}
}

// toStorageMessage converts a pubsub.Message to a storage.Message.
func toStorageMessage(msg *Message) *storage.Message {
	return &storage.Message{
		ID:          msg.ID,
		Source:      msg.Source,
		Destination: msg.Destination,
		Payload:     msg.Payload,
		Timestamp:   msg.Timestamp,
		Sequence:    msg.Sequence,
		ReplyTo:     msg.ReplyTo,
		StreamID:    msg.StreamID,
		Attempt:     msg.Attempt,
	}
}

// fromStorageMessage converts a storage.Message to a pubsub.Message.
func fromStorageMessage(msg *storage.Message) *Message {
	return &Message{
		ID:          msg.ID,
		Source:      msg.Source,
		Destination: msg.Destination,
		Payload:     msg.Payload,
		Timestamp:   msg.Timestamp,
		Sequence:    msg.Sequence,
		ReplyTo:     msg.ReplyTo,
		StreamID:    msg.StreamID,
		Attempt:     msg.Attempt,
	}
}
