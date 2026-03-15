package storage

import (
	"path/filepath"
	"testing"
	"time"
)

func openTestSQLite(t *testing.T) *SQLiteStorage {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	s, err := OpenSQLite(path)
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestSQLiteQueue_EnqueueDequeue(t *testing.T) {
	s := openTestSQLite(t)
	factory := s.NewQueueFactory()
	q := factory("topic1", "sub1")

	for i := 0; i < 5; i++ {
		if err := q.Enqueue(&Message{ID: string(rune('a' + i)), Destination: "topic1"}); err != nil {
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
		t.Fatalf("expected nil from empty queue")
	}
}

func TestSQLiteDLQ_AddListRetryPurge(t *testing.T) {
	s := openTestSQLite(t)

	dl := &DeadLetter{
		OriginalTopic: "test",
		MessageID:     "msg1",
		Payload:       []byte("hello"),
		Reason:        "failed",
	}
	if err := s.Add(dl); err != nil {
		t.Fatalf("add: %v", err)
	}

	items, err := s.List("test", 10, 0)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}

	count, _ := s.Count("test")
	if count != 1 {
		t.Fatalf("expected count 1, got %d", count)
	}

	// Retry using the ID returned by List (auto-increment integer as string).
	msg, err := s.Retry(items[0].ID)
	if err != nil {
		t.Fatalf("retry: %v", err)
	}
	if msg.ID != "msg1" {
		t.Fatalf("retry returned wrong message ID: %s", msg.ID)
	}

	count, _ = s.Count("test")
	if count != 0 {
		t.Fatalf("expected 0 after retry, got %d", count)
	}

	// Test purge.
	s.Add(&DeadLetter{OriginalTopic: "t2", MessageID: "m1"})
	s.Add(&DeadLetter{OriginalTopic: "t2", MessageID: "m2"})
	purged, _ := s.Purge("t2")
	if purged != 2 {
		t.Fatalf("expected 2 purged, got %d", purged)
	}
}

func TestSQLiteDedup_MarkSeenAndCleanup(t *testing.T) {
	s := openTestSQLite(t)

	seen, _ := s.MarkSeen("msg1")
	if seen {
		t.Fatal("first MarkSeen should return false")
	}

	seen, _ = s.MarkSeen("msg1")
	if !seen {
		t.Fatal("second MarkSeen should return true")
	}

	// SQLite seen_at uses Unix seconds, so wait >1s then cleanup with 1s TTL.
	time.Sleep(2 * time.Second)
	if err := s.Cleanup(1 * time.Second); err != nil {
		t.Fatalf("cleanup: %v", err)
	}

	seen, _ = s.MarkSeen("msg1")
	if seen {
		t.Fatal("MarkSeen after cleanup should return false")
	}
}
