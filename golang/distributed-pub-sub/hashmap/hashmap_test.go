package hashmap

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"distributed-pub-sub/pubsub"
)

func newTestMap(t *testing.T, listenAddr, advertiseAddr string, seeds []string) *Map {
	t.Helper()
	m, err := New(Options{
		PubsubOptions: pubsub.Options{
			ListenAddr:       listenAddr,
			AdvertiseAddr:    advertiseAddr,
			Seeds:            seeds,
			ExchangeInterval: 500 * time.Millisecond,
			BufferSize:       64,
			MaxRetries:       3,
			RetryInterval:    50 * time.Millisecond,
		},
		SyncTimeout: 2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		m.Stop()
	})
	if err := m.Start(ctx); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestSetAndGet(t *testing.T) {
	m := newTestMap(t, ":21000", "127.0.0.1:21000", nil)

	ctx := context.Background()
	if err := m.Set(ctx, "foo", json.RawMessage(`"bar"`)); err != nil {
		t.Fatal(err)
	}

	val, ok := m.Get("foo")
	if !ok {
		t.Fatal("expected key foo to exist")
	}
	if string(val) != `"bar"` {
		t.Fatalf("expected \"bar\", got %s", val)
	}
}

func TestGetMissing(t *testing.T) {
	m := newTestMap(t, ":21001", "127.0.0.1:21001", nil)

	_, ok := m.Get("nonexistent")
	if ok {
		t.Fatal("expected key not found")
	}
}

func TestDelete(t *testing.T) {
	m := newTestMap(t, ":21002", "127.0.0.1:21002", nil)

	ctx := context.Background()
	m.Set(ctx, "key1", json.RawMessage(`1`))
	m.Delete(ctx, "key1")

	_, ok := m.Get("key1")
	if ok {
		t.Fatal("expected key1 to be deleted")
	}
}

func TestKeysAndLen(t *testing.T) {
	m := newTestMap(t, ":21003", "127.0.0.1:21003", nil)

	ctx := context.Background()
	m.Set(ctx, "a", json.RawMessage(`1`))
	m.Set(ctx, "b", json.RawMessage(`2`))
	m.Set(ctx, "c", json.RawMessage(`3`))
	m.Delete(ctx, "b")

	if m.Len() != 2 {
		t.Fatalf("expected len 2, got %d", m.Len())
	}

	keys := m.Keys()
	if len(keys) != 2 {
		t.Fatalf("expected 2 keys, got %d", len(keys))
	}
}

func TestReplication(t *testing.T) {
	m1 := newTestMap(t, ":21010", "127.0.0.1:21010", nil)
	m2 := newTestMap(t, ":21011", "127.0.0.1:21011", []string{"127.0.0.1:21010"})

	// Wait for mesh to form
	time.Sleep(500 * time.Millisecond)

	ctx := context.Background()
	m1.Set(ctx, "replicated", json.RawMessage(`"hello"`))

	// Wait for replication
	var val json.RawMessage
	var ok bool
	for i := 0; i < 20; i++ {
		val, ok = m2.Get("replicated")
		if ok {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if !ok {
		t.Fatal("key not replicated to node 2")
	}
	if string(val) != `"hello"` {
		t.Fatalf("expected \"hello\", got %s", val)
	}
}

func TestReplicationDelete(t *testing.T) {
	m1 := newTestMap(t, ":21020", "127.0.0.1:21020", nil)
	m2 := newTestMap(t, ":21021", "127.0.0.1:21021", []string{"127.0.0.1:21020"})

	time.Sleep(500 * time.Millisecond)

	ctx := context.Background()
	m1.Set(ctx, "temp", json.RawMessage(`"value"`))

	// Wait for set to replicate
	for i := 0; i < 20; i++ {
		if _, ok := m2.Get("temp"); ok {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	m1.Delete(ctx, "temp")

	// Wait for delete to replicate
	deleted := false
	for i := 0; i < 20; i++ {
		if _, ok := m2.Get("temp"); !ok {
			deleted = true
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if !deleted {
		t.Fatal("delete not replicated to node 2")
	}
}

func TestBidirectionalReplication(t *testing.T) {
	m1 := newTestMap(t, ":21030", "127.0.0.1:21030", nil)
	m2 := newTestMap(t, ":21031", "127.0.0.1:21031", []string{"127.0.0.1:21030"})

	time.Sleep(500 * time.Millisecond)

	ctx := context.Background()
	m1.Set(ctx, "from1", json.RawMessage(`"node1"`))
	m2.Set(ctx, "from2", json.RawMessage(`"node2"`))

	// Wait for both to converge
	for i := 0; i < 20; i++ {
		_, ok1 := m2.Get("from1")
		_, ok2 := m1.Get("from2")
		if ok1 && ok2 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if _, ok := m2.Get("from1"); !ok {
		t.Fatal("from1 not replicated to node 2")
	}
	if _, ok := m1.Get("from2"); !ok {
		t.Fatal("from2 not replicated to node 1")
	}
}

func TestAntiEntropy(t *testing.T) {
	m1 := newTestMap(t, ":21040", "127.0.0.1:21040", nil)

	ctx := context.Background()
	m1.Set(ctx, "pre-existing", json.RawMessage(`"data"`))

	// Start a second node — it should sync existing data on startup
	m2 := newTestMap(t, ":21041", "127.0.0.1:21041", []string{"127.0.0.1:21040"})

	// Give sync time to complete
	time.Sleep(time.Second)

	val, ok := m2.Get("pre-existing")
	if !ok {
		t.Fatal("anti-entropy sync failed: key not found on node 2")
	}
	if string(val) != `"data"` {
		t.Fatalf("expected \"data\", got %s", val)
	}
}

func TestLastWriteWins(t *testing.T) {
	m := newTestMap(t, ":21050", "127.0.0.1:21050", nil)

	ctx := context.Background()
	m.Set(ctx, "conflict", json.RawMessage(`"first"`))
	time.Sleep(time.Millisecond) // ensure different timestamp
	m.Set(ctx, "conflict", json.RawMessage(`"second"`))

	val, ok := m.Get("conflict")
	if !ok {
		t.Fatal("key not found")
	}
	if string(val) != `"second"` {
		t.Fatalf("expected \"second\", got %s", val)
	}
}

func TestSnapshot(t *testing.T) {
	m := newTestMap(t, ":21060", "127.0.0.1:21060", nil)

	ctx := context.Background()
	m.Set(ctx, "x", json.RawMessage(`1`))
	m.Set(ctx, "y", json.RawMessage(`2`))
	m.Delete(ctx, "y")

	snap := m.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("expected 1 entry in snapshot, got %d", len(snap))
	}
	if string(snap["x"]) != "1" {
		t.Fatalf("expected 1, got %s", snap["x"])
	}
}

func TestForEach(t *testing.T) {
	m := newTestMap(t, ":21070", "127.0.0.1:21070", nil)

	ctx := context.Background()
	m.Set(ctx, "a", json.RawMessage(`1`))
	m.Set(ctx, "b", json.RawMessage(`2`))

	count := 0
	m.ForEach(func(key string, value json.RawMessage) bool {
		count++
		return true
	})
	if count != 2 {
		t.Fatalf("expected 2, got %d", count)
	}
}

func TestConcurrentWrites(t *testing.T) {
	m := newTestMap(t, ":21080", "127.0.0.1:21080", nil)

	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			key := fmt.Sprintf("key-%d", i)
			m.Set(ctx, key, json.RawMessage(fmt.Sprintf(`%d`, i)))
		}(i)
	}
	wg.Wait()

	if m.Len() != 50 {
		t.Fatalf("expected 50 keys, got %d", m.Len())
	}
}

func TestThreeNodeReplication(t *testing.T) {
	m1 := newTestMap(t, ":21090", "127.0.0.1:21090", nil)
	m2 := newTestMap(t, ":21091", "127.0.0.1:21091", []string{"127.0.0.1:21090"})
	m3 := newTestMap(t, ":21092", "127.0.0.1:21092", []string{"127.0.0.1:21090"})

	time.Sleep(time.Second)

	ctx := context.Background()
	m1.Set(ctx, "three-node", json.RawMessage(`"works"`))

	// Wait for replication to all nodes
	for i := 0; i < 30; i++ {
		_, ok2 := m2.Get("three-node")
		_, ok3 := m3.Get("three-node")
		if ok2 && ok3 {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	if _, ok := m2.Get("three-node"); !ok {
		t.Fatal("not replicated to node 2")
	}
	if _, ok := m3.Get("three-node"); !ok {
		t.Fatal("not replicated to node 3")
	}
}
