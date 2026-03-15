package pubsub

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"distributed-pub-sub/pubsub/storage"
)

func testOpts() Options {
	return Options{
		MaxRetries:     3,
		RetryBaseDelay: 10 * time.Millisecond,
		RetryMaxDelay:  50 * time.Millisecond,
		ChannelSize:    8,
	}
}

func TestSubscriber_Delivery(t *testing.T) {
	var received atomic.Int32
	handler := func(msg *Message) error {
		received.Add(1)
		return nil
	}

	opts := testOpts()
	stats := &Stats{}
	queue := storage.NewMemoryQueue(16)
	sub := NewSubscriber("sub1", "topic1", handler, queue, nil, opts, stats)
	sub.Start()
	defer sub.Stop()

	sub.Deliver(&Message{ID: "m1", Destination: "topic1"})

	time.Sleep(50 * time.Millisecond)
	if received.Load() != 1 {
		t.Fatalf("expected 1 delivery, got %d", received.Load())
	}
}

func TestSubscriber_RetryThenSucceed(t *testing.T) {
	var attempts atomic.Int32
	handler := func(msg *Message) error {
		n := attempts.Add(1)
		if n < 3 {
			return fmt.Errorf("fail attempt %d", n)
		}
		return nil
	}

	opts := testOpts()
	stats := &Stats{}
	queue := storage.NewMemoryQueue(16)
	sub := NewSubscriber("sub1", "topic1", handler, queue, nil, opts, stats)
	sub.Start()
	defer sub.Stop()

	sub.Deliver(&Message{ID: "m1", Destination: "topic1"})

	time.Sleep(500 * time.Millisecond)
	if attempts.Load() < 3 {
		t.Fatalf("expected at least 3 attempts, got %d", attempts.Load())
	}
	if stats.MessagesDelivered.Load() != 1 {
		t.Fatalf("expected 1 delivered, got %d", stats.MessagesDelivered.Load())
	}
}

func TestSubscriber_DLQAfterMaxRetries(t *testing.T) {
	handler := func(msg *Message) error {
		return fmt.Errorf("always fail")
	}

	opts := testOpts()
	opts.MaxRetries = 2
	stats := &Stats{}
	queue := storage.NewMemoryQueue(16)
	dlq := storage.NewMemoryDLQ()
	sub := NewSubscriber("sub1", "topic1", handler, queue, dlq, opts, stats)
	sub.Start()
	defer sub.Stop()

	sub.Deliver(&Message{ID: "m1", Destination: "topic1", Source: "test"})

	time.Sleep(500 * time.Millisecond)
	if stats.MessagesDLQ.Load() != 1 {
		t.Fatalf("expected 1 DLQ, got %d", stats.MessagesDLQ.Load())
	}
	count, _ := dlq.Count("topic1")
	if count != 1 {
		t.Fatalf("expected 1 in DLQ store, got %d", count)
	}
}

func TestSubscriber_Overflow(t *testing.T) {
	// Block the handler so the channel fills up.
	block := make(chan struct{})
	var delivered atomic.Int32
	handler := func(msg *Message) error {
		<-block
		delivered.Add(1)
		return nil
	}

	opts := testOpts()
	opts.ChannelSize = 2
	stats := &Stats{}
	queue := storage.NewMemoryQueue(16)
	sub := NewSubscriber("sub1", "topic1", handler, queue, nil, opts, stats)
	sub.Start()
	defer sub.Stop()

	// Deliver more than channel capacity.
	for i := range 5 {
		sub.Deliver(&Message{ID: fmt.Sprintf("m%d", i), Destination: "topic1"})
	}

	time.Sleep(50 * time.Millisecond)
	qLen, _ := queue.Len()
	if qLen == 0 {
		t.Fatal("expected some messages in overflow queue")
	}

	// Unblock and let everything deliver.
	close(block)
	time.Sleep(500 * time.Millisecond)
	if delivered.Load() != 5 {
		t.Fatalf("expected 5 delivered, got %d", delivered.Load())
	}
}
