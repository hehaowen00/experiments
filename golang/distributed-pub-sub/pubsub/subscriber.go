package pubsub

import (
	"context"
	"log"
	"time"
)

type subscriber struct {
	id      string
	topic   string
	handler Handler

	incoming chan *Message
	overflow QueueStore // nil = drop on buffer full (original behavior)

	// FIFO ordering per source
	expected map[string]uint64              // source -> next expected seq
	reorder  map[string]map[uint64]*Message // source -> seq -> msg

	maxRetries int
	retryDelay time.Duration

	stats  *Stats
	dlq    func(*Message) // called when delivery exhausts retries; nil = drop
	cancel context.CancelFunc
}

func newSubscriber(id, topic string, handler Handler, opts Options, stats *Stats, dlq func(*Message)) *subscriber {
	s := &subscriber{
		id:         id,
		topic:      topic,
		handler:    handler,
		incoming:   make(chan *Message, opts.BufferSize),
		expected:   make(map[string]uint64),
		reorder:    make(map[string]map[uint64]*Message),
		maxRetries: opts.MaxRetries,
		retryDelay: opts.RetryInterval,
		stats:      stats,
		dlq:        dlq,
	}
	if opts.QueueFactory != nil {
		s.overflow = opts.QueueFactory(topic, id)
	}
	return s
}

func (s *subscriber) enqueue(msg *Message) {
	select {
	case s.incoming <- msg:
	default:
		// Channel full — try overflow store
		if s.overflow != nil {
			if err := s.overflow.Enqueue(msg); err != nil {
				s.stats.Dropped.Add(1)
				log.Printf("subscriber %s overflow enqueue failed: %v", s.id, err)
				return
			}
			s.stats.Overflowed.Add(1)
			return
		}
		s.stats.Dropped.Add(1)
		log.Printf("subscriber %s buffer full, dropping message %s", s.id, msg.ID)
	}
}

func (s *subscriber) run(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	s.cancel = cancel
	defer cancel()

	for {
		select {
		case msg := <-s.incoming:
			s.handleMessage(ctx, msg)
			// After processing, drain any overflow into the handler
			s.drainOverflow(ctx)
		case <-ctx.Done():
			return
		}
	}
}

// drainOverflow pulls messages from the overflow store and processes them.
func (s *subscriber) drainOverflow(ctx context.Context) {
	if s.overflow == nil {
		return
	}
	for {
		if ctx.Err() != nil {
			return
		}
		msg, ok := s.overflow.Dequeue()
		if !ok {
			return
		}
		s.handleMessage(ctx, msg)
	}
}

func (s *subscriber) stop() {
	if s.cancel != nil {
		s.cancel()
	}
	if s.overflow != nil {
		s.overflow.Close()
	}
}

func (s *subscriber) handleMessage(ctx context.Context, msg *Message) {
	src := msg.Source
	exp := s.expected[src]

	if exp == 0 {
		// First message from this source — accept its sequence as the starting point
		exp = msg.Sequence
		s.expected[src] = exp
	}

	if msg.Sequence < exp {
		return // duplicate
	}

	if msg.Sequence > exp {
		// Out of order — buffer until earlier messages arrive
		if s.reorder[src] == nil {
			s.reorder[src] = make(map[uint64]*Message)
		}
		s.reorder[src][msg.Sequence] = msg
		return
	}

	// In sequence — deliver and flush any buffered follow-ups
	s.deliver(ctx, msg)
	s.expected[src] = exp + 1
	s.flushReorder(ctx, src)
}

func (s *subscriber) flushReorder(ctx context.Context, source string) {
	buf := s.reorder[source]
	if buf == nil {
		return
	}

	for {
		exp := s.expected[source]
		msg, ok := buf[exp]
		if !ok {
			break
		}
		delete(buf, exp)
		s.deliver(ctx, msg)
		s.expected[source] = exp + 1
	}

	if len(buf) == 0 {
		delete(s.reorder, source)
	}
}

func (s *subscriber) deliver(ctx context.Context, msg *Message) {
	for attempt := 0; attempt <= s.maxRetries; attempt++ {
		if ctx.Err() != nil {
			return
		}
		err := s.handler(ctx, msg)
		if err == nil {
			s.stats.Delivered.Add(1)
			return
		}
		s.stats.DeliveryRetries.Add(1)
		log.Printf("subscriber %s delivery attempt %d for msg %s failed: %v",
			s.id, attempt+1, msg.ID, err)
		if attempt < s.maxRetries {
			time.Sleep(s.retryDelay)
		}
	}

	// Delivery exhausted — send to DLQ or drop
	if s.dlq != nil {
		s.dlq(msg)
		s.stats.DeadLettered.Add(1)
		log.Printf("subscriber %s sent message %s to DLQ", s.id, msg.ID)
	} else {
		s.stats.Dropped.Add(1)
		log.Printf("subscriber %s dropping message %s after %d attempts",
			s.id, msg.ID, s.maxRetries+1)
	}
}

// drain processes any remaining messages in the buffer without blocking for new ones.
func (s *subscriber) drain() {
	for {
		select {
		case msg := <-s.incoming:
			s.handleMessage(context.Background(), msg)
		default:
			// Also drain overflow
			if s.overflow != nil {
				for {
					msg, ok := s.overflow.Dequeue()
					if !ok {
						break
					}
					s.handleMessage(context.Background(), msg)
				}
			}
			return
		}
	}
}
