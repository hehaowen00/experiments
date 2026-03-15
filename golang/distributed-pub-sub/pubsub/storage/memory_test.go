package storage

import (
	"testing"
	"time"
)

// --- MemoryQueue ---

func TestMemoryQueue_EnqueueDequeue(t *testing.T) {
	q := NewMemoryQueue(4)

	for i := 0; i < 5; i++ {
		if err := q.Enqueue(&Message{ID: string(rune('a' + i))}); err != nil {
			t.Fatalf("enqueue %d: %v", i, err)
		}
	}

	n, _ := q.Len()
	if n != 5 {
		t.Fatalf("expected len 5, got %d", n)
	}

	for i := 0; i < 5; i++ {
		msg, err := q.Dequeue()
		if err != nil {
			t.Fatalf("dequeue %d: %v", i, err)
		}
		if msg == nil {
			t.Fatalf("dequeue %d: nil", i)
		}
		want := string(rune('a' + i))
		if msg.ID != want {
			t.Fatalf("dequeue %d: got %q, want %q", i, msg.ID, want)
		}
	}

	msg, err := q.Dequeue()
	if err != nil {
		t.Fatalf("dequeue empty: %v", err)
	}
	if msg != nil {
		t.Fatalf("expected nil from empty queue, got %v", msg)
	}
}

func TestMemoryQueue_Grow(t *testing.T) {
	q := NewMemoryQueue(2)
	for i := 0; i < 10; i++ {
		q.Enqueue(&Message{ID: string(rune('0' + i))})
	}
	n, _ := q.Len()
	if n != 10 {
		t.Fatalf("expected len 10, got %d", n)
	}
}

// --- MemoryDLQ ---

func TestMemoryDLQ_AddListRetryPurge(t *testing.T) {
	dlq := NewMemoryDLQ()

	dl := &DeadLetter{
		OriginalTopic: "test",
		MessageID:     "msg1",
		Payload:       []byte("hello"),
		Reason:        "failed",
	}
	if err := dlq.Add(dl); err != nil {
		t.Fatalf("add: %v", err)
	}

	items, err := dlq.List("test", 10, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}

	count, _ := dlq.Count("test")
	if count != 1 {
		t.Fatalf("expected count 1, got %d", count)
	}

	msg, err := dlq.Retry(items[0].ID)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if msg.ID != "msg1" {
		t.Fatalf("retry returned wrong message ID: %s", msg.ID)
	}

	count, _ = dlq.Count("test")
	if count != 0 {
		t.Fatalf("expected count 0 after retry, got %d", count)
	}

	// Test purge.
	dlq.Add(&DeadLetter{OriginalTopic: "t2", MessageID: "m1"})
	dlq.Add(&DeadLetter{OriginalTopic: "t2", MessageID: "m2"})
	purged, err := dlq.Purge("t2")
	if err != nil {
		t.Fatalf("purge: %v", err)
	}
	if purged != 2 {
		t.Fatalf("expected 2 purged, got %d", purged)
	}
}

// --- MemoryDedup ---

func TestMemoryDedup_MarkSeenAndCleanup(t *testing.T) {
	d := NewMemoryDedup()

	seen, _ := d.MarkSeen("msg1")
	if seen {
		t.Fatal("first MarkSeen should return false")
	}

	seen, _ = d.MarkSeen("msg1")
	if !seen {
		t.Fatal("second MarkSeen should return true")
	}

	// Cleanup with 0 TTL should remove everything.
	time.Sleep(10 * time.Millisecond)
	if err := d.Cleanup(5 * time.Millisecond); err != nil {
		t.Fatalf("cleanup: %v", err)
	}

	seen, _ = d.MarkSeen("msg1")
	if seen {
		t.Fatal("MarkSeen after cleanup should return false")
	}
}
