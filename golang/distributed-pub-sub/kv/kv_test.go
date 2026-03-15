package kv

import (
	"sync/atomic"
	"testing"
	"time"

	"distributed-pub-sub/pubsub"
)

func newTestNode(t *testing.T, addr string) *pubsub.Node {
	t.Helper()
	opts := pubsub.DefaultOptions()
	opts.GRPCAddress = addr
	opts.EnableMDNS = false
	opts.HealthCheckInterval = 30 * time.Second
	n := pubsub.NewNode(opts)
	if err := n.Start(); err != nil {
		t.Fatalf("start node: %v", err)
	}
	t.Cleanup(func() { n.Stop() })
	return n
}

func TestStore_SetGet(t *testing.T) {
	n := newTestNode(t, "localhost:19101")
	s := NewStore(n)
	if err := s.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer s.Stop()

	s.Set("foo", []byte("bar"), 0)
	val, ok := s.Get("foo")
	if !ok || string(val) != "bar" {
		t.Fatalf("expected bar, got %s (ok=%v)", val, ok)
	}

	s.Delete("foo")
	_, ok = s.Get("foo")
	if ok {
		t.Fatal("expected key to be deleted")
	}
}

func TestStore_TTL(t *testing.T) {
	n := newTestNode(t, "localhost:19102")
	s := NewStore(n)
	if err := s.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer s.Stop()

	s.Set("temp", []byte("val"), 50*time.Millisecond)
	val, ok := s.Get("temp")
	if !ok {
		t.Fatal("expected key to exist")
	}
	if string(val) != "val" {
		t.Fatalf("expected val, got %s", val)
	}

	time.Sleep(100 * time.Millisecond)
	_, ok = s.Get("temp")
	if ok {
		t.Fatal("expected key to be expired")
	}
}

func TestStore_Keys(t *testing.T) {
	n := newTestNode(t, "localhost:19103")
	s := NewStore(n)
	if err := s.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer s.Stop()

	s.Set("a", []byte("1"), 0)
	s.Set("b", []byte("2"), 0)
	s.Set("c", []byte("3"), 0)

	keys := s.Keys()
	if len(keys) != 3 {
		t.Fatalf("expected 3 keys, got %d", len(keys))
	}
}

func TestStore_Watch(t *testing.T) {
	n := newTestNode(t, "localhost:19104")
	s := NewStore(n)
	if err := s.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer s.Stop()

	var called atomic.Int32
	s.Watch("mykey", func(key string, value []byte, deleted bool) {
		called.Add(1)
	})

	s.Set("mykey", []byte("v1"), 0)
	s.Set("mykey", []byte("v2"), 0)
	s.Delete("mykey")

	if called.Load() != 3 {
		t.Fatalf("expected 3 watch calls, got %d", called.Load())
	}
}

func TestStore_Replication(t *testing.T) {
	n1 := newTestNode(t, "localhost:19105")
	n2 := newTestNode(t, "localhost:19106")

	s1 := NewStore(n1)
	s2 := NewStore(n2)

	if err := s1.Start(); err != nil {
		t.Fatalf("start s1: %v", err)
	}
	defer s1.Stop()
	if err := s2.Start(); err != nil {
		t.Fatalf("start s2: %v", err)
	}
	defer s2.Stop()

	// Connect the nodes.
	time.Sleep(100 * time.Millisecond)

	// Use node's exported method indirectly — connect via seed.
	// We need to join peers. Since joinPeer is unexported, we'll create
	// n2 with seeds pointing to n1. But nodes are already started.
	// Instead, publish on a shared topic to trigger connection.
	// Actually, let's restart n2 with seeds.
	s2.Stop()
	n2.Stop()

	opts2 := pubsub.DefaultOptions()
	opts2.GRPCAddress = "localhost:19106"
	opts2.EnableMDNS = false
	opts2.Seeds = []string{"localhost:19105"}
	opts2.HealthCheckInterval = 30 * time.Second
	n2 = pubsub.NewNode(opts2)
	if err := n2.Start(); err != nil {
		t.Fatalf("restart n2: %v", err)
	}
	defer n2.Stop()

	s2 = NewStore(n2)
	if err := s2.Start(); err != nil {
		t.Fatalf("restart s2: %v", err)
	}
	defer s2.Stop()

	// Wait for topic sync.
	time.Sleep(1 * time.Second)

	s1.Set("hello", []byte("world"), 0)

	// Wait for replication.
	time.Sleep(1 * time.Second)

	val, ok := s2.Get("hello")
	if !ok {
		t.Fatal("expected key to be replicated to s2")
	}
	if string(val) != "world" {
		t.Fatalf("expected world, got %s", val)
	}
}
