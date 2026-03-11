package pubsub

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"
)

func newTestNode(t *testing.T, listenAddr, advertiseAddr string, seeds []string) *Node {
	t.Helper()
	node, err := New(Options{
		ListenAddr:       listenAddr,
		AdvertiseAddr:    advertiseAddr,
		Seeds:            seeds,
		ExchangeInterval: 1 * time.Second,
		BufferSize:       64,
		MaxRetries:       3,
		RetryInterval:    50 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		node.Stop()
	})
	if err := node.Start(ctx); err != nil {
		t.Fatal(err)
	}
	return node
}

func TestPublishSubscribe(t *testing.T) {
	node := newTestNode(t, ":19000", "127.0.0.1:19000", nil)

	var received []*Message
	var mu sync.Mutex
	done := make(chan struct{})

	node.Subscribe("test.topic", "sub1", func(ctx context.Context, msg *Message) error {
		mu.Lock()
		received = append(received, msg)
		mu.Unlock()
		close(done)
		return nil
	})

	node.Publish(context.Background(), "user1", "test.topic", json.RawMessage(`{"hello":"world"}`))

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for message")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(received) != 1 {
		t.Fatalf("expected 1 message, got %d", len(received))
	}
	if received[0].Source != "user1" {
		t.Fatalf("expected source user1, got %s", received[0].Source)
	}
	if received[0].Destination != "test.topic" {
		t.Fatalf("expected destination test.topic, got %s", received[0].Destination)
	}
}

func TestFIFOOrdering(t *testing.T) {
	node := newTestNode(t, ":19001", "127.0.0.1:19001", nil)

	const count = 50
	var received []*Message
	var mu sync.Mutex
	done := make(chan struct{})

	node.Subscribe("order.test", "sub1", func(ctx context.Context, msg *Message) error {
		mu.Lock()
		received = append(received, msg)
		if len(received) == count {
			close(done)
		}
		mu.Unlock()
		return nil
	})

	for i := range count {
		payload := json.RawMessage(fmt.Sprintf(`{"n":%d}`, i))
		node.Publish(context.Background(), "user1", "order.test", payload)
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for messages")
	}

	mu.Lock()
	defer mu.Unlock()
	for i, msg := range received {
		expected := uint64(i + 1)
		if msg.Sequence != expected {
			t.Fatalf("message %d has seq %d, expected %d", i, msg.Sequence, expected)
		}
	}
}

func TestMultipleSourcesFIFO(t *testing.T) {
	node := newTestNode(t, ":19002", "127.0.0.1:19002", nil)

	const perSource = 20
	sources := []string{"alice", "bob", "carol"}

	var received []*Message
	var mu sync.Mutex
	done := make(chan struct{})

	node.Subscribe("multi.source", "sub1", func(ctx context.Context, msg *Message) error {
		mu.Lock()
		received = append(received, msg)
		if len(received) == perSource*len(sources) {
			close(done)
		}
		mu.Unlock()
		return nil
	})

	for i := range perSource {
		for _, src := range sources {
			payload := json.RawMessage(fmt.Sprintf(`{"from":"%s","n":%d}`, src, i))
			node.Publish(context.Background(), src, "multi.source", payload)
		}
	}

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for messages")
	}

	mu.Lock()
	defer mu.Unlock()

	// Verify per-source ordering
	lastSeq := make(map[string]uint64)
	for _, msg := range received {
		prev := lastSeq[msg.Source]
		if prev != 0 && msg.Sequence <= prev {
			t.Fatalf("source %s: seq %d came after %d", msg.Source, msg.Sequence, prev)
		}
		lastSeq[msg.Source] = msg.Sequence
	}
}

func TestRetryOnError(t *testing.T) {
	node := newTestNode(t, ":19003", "127.0.0.1:19003", nil)

	var attempts int
	var mu sync.Mutex
	done := make(chan struct{})

	node.Subscribe("retry.test", "sub1", func(ctx context.Context, msg *Message) error {
		mu.Lock()
		attempts++
		a := attempts
		mu.Unlock()
		if a < 3 {
			return fmt.Errorf("transient error")
		}
		close(done)
		return nil
	})

	node.Publish(context.Background(), "user1", "retry.test", json.RawMessage(`{}`))

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for successful delivery")
	}

	mu.Lock()
	defer mu.Unlock()
	if attempts != 3 {
		t.Fatalf("expected 3 attempts, got %d", attempts)
	}
}

func TestMultiNodeForwarding(t *testing.T) {
	node1 := newTestNode(t, ":19004", "127.0.0.1:19004", nil)
	node2 := newTestNode(t, ":19005", "127.0.0.1:19005", []string{"127.0.0.1:19004"})

	// Let mesh form
	time.Sleep(200 * time.Millisecond)

	done := make(chan *Message, 1)

	node2.Subscribe("cross.topic", "sub1", func(ctx context.Context, msg *Message) error {
		done <- msg
		return nil
	})

	// Publish on node1, expect delivery on node2
	node1.Publish(context.Background(), "user1", "cross.topic", json.RawMessage(`{"cross":"node"}`))

	select {
	case msg := <-done:
		if msg.Source != "user1" {
			t.Fatalf("expected source user1, got %s", msg.Source)
		}
		if string(msg.Payload) != `{"cross":"node"}` {
			t.Fatalf("unexpected payload: %s", msg.Payload)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for cross-node message")
	}
}

func TestThreeNodeMesh(t *testing.T) {
	node1 := newTestNode(t, ":19006", "127.0.0.1:19006", nil)
	node2 := newTestNode(t, ":19007", "127.0.0.1:19007", []string{"127.0.0.1:19006"})
	node3 := newTestNode(t, ":19008", "127.0.0.1:19008", []string{"127.0.0.1:19006"})

	// Let mesh form — node2 and node3 discover each other via exchange
	time.Sleep(2 * time.Second)

	var wg sync.WaitGroup
	wg.Add(2)

	// Subscribe on node2 and node3
	node2.Subscribe("mesh.test", "sub-n2", func(ctx context.Context, msg *Message) error {
		wg.Done()
		return nil
	})
	node3.Subscribe("mesh.test", "sub-n3", func(ctx context.Context, msg *Message) error {
		wg.Done()
		return nil
	})

	// Publish on node1
	node1.Publish(context.Background(), "user1", "mesh.test", json.RawMessage(`{"mesh":"test"}`))

	ch := make(chan struct{})
	go func() {
		wg.Wait()
		close(ch)
	}()

	select {
	case <-ch:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for messages on all nodes")
	}
}

func TestUnsubscribe(t *testing.T) {
	node := newTestNode(t, ":19009", "127.0.0.1:19009", nil)

	var count int
	var mu sync.Mutex
	first := make(chan struct{})

	node.Subscribe("unsub.test", "sub1", func(ctx context.Context, msg *Message) error {
		mu.Lock()
		count++
		mu.Unlock()
		select {
		case <-first:
		default:
			close(first)
		}
		return nil
	})

	node.Publish(context.Background(), "user1", "unsub.test", json.RawMessage(`{}`))

	// Wait for first delivery
	select {
	case <-first:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for first message")
	}

	node.Unsubscribe("unsub.test", "sub1")
	time.Sleep(100 * time.Millisecond)

	// This should not be delivered
	node.Publish(context.Background(), "user1", "unsub.test", json.RawMessage(`{}`))
	time.Sleep(200 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if count != 1 {
		t.Fatalf("expected 1 message after unsubscribe, got %d", count)
	}
}

func TestMultipleSubscribersSameTopic(t *testing.T) {
	node := newTestNode(t, ":19010", "127.0.0.1:19010", nil)

	var wg sync.WaitGroup
	wg.Add(3)

	for i := range 3 {
		subID := fmt.Sprintf("sub%d", i)
		node.Subscribe("fan.out", subID, func(ctx context.Context, msg *Message) error {
			wg.Done()
			return nil
		})
	}

	node.Publish(context.Background(), "user1", "fan.out", json.RawMessage(`{"fan":"out"}`))

	ch := make(chan struct{})
	go func() {
		wg.Wait()
		close(ch)
	}()

	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout — not all subscribers received the message")
	}
}

func TestBidirectionalForwarding(t *testing.T) {
	node1 := newTestNode(t, ":19011", "127.0.0.1:19011", nil)
	node2 := newTestNode(t, ":19012", "127.0.0.1:19012", []string{"127.0.0.1:19011"})

	time.Sleep(200 * time.Millisecond)

	done1 := make(chan struct{})
	done2 := make(chan struct{})

	// Subscribe on node1, publish from node2
	node1.Subscribe("bidir", "sub-n1", func(ctx context.Context, msg *Message) error {
		close(done1)
		return nil
	})
	// Subscribe on node2, publish from node1
	node2.Subscribe("bidir", "sub-n2", func(ctx context.Context, msg *Message) error {
		close(done2)
		return nil
	})

	node1.Publish(context.Background(), "from-n1", "bidir", json.RawMessage(`{}`))
	node2.Publish(context.Background(), "from-n2", "bidir", json.RawMessage(`{}`))

	select {
	case <-done1:
	case <-time.After(3 * time.Second):
		t.Fatal("node1 didn't receive message from node2")
	}
	select {
	case <-done2:
	case <-time.After(3 * time.Second):
		t.Fatal("node2 didn't receive message from node1")
	}
}

// fakeResolver returns a fixed set of IPs for any hostname.
type fakeResolver struct {
	addrs []string
	err   error
}

func (f *fakeResolver) LookupHost(_ context.Context, _ string) ([]string, error) {
	return f.addrs, f.err
}

func TestDNSDiscoveryAddsPeers(t *testing.T) {
	// Start two nodes without seeds
	node1, err := New(Options{
		ListenAddr:    ":19020",
		AdvertiseAddr: "127.0.0.1:19020",
		BufferSize:    64,
		MaxRetries:    3,
		RetryInterval: 50 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx1, cancel1 := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel1(); node1.Stop() })
	if err := node1.Start(ctx1); err != nil {
		t.Fatal(err)
	}

	// Node2 discovers node1 via DNS
	node2, err := New(Options{
		ListenAddr:           ":19021",
		AdvertiseAddr:        "127.0.0.1:19021",
		BufferSize:           64,
		MaxRetries:           3,
		RetryInterval:        50 * time.Millisecond,
		DNSDiscovery:         "fake-headless.svc",
		DNSDiscoveryPort:     "19020",
		DNSDiscoveryInterval: 500 * time.Millisecond,
		Resolver:             &fakeResolver{addrs: []string{"127.0.0.1"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel2(); node2.Stop() })
	if err := node2.Start(ctx2); err != nil {
		t.Fatal(err)
	}

	// Subscribe on node1, publish on node2
	done := make(chan struct{})
	node1.Subscribe("dns.test", "sub1", func(_ context.Context, msg *Message) error {
		close(done)
		return nil
	})

	// Wait for DNS discovery to connect the nodes
	time.Sleep(1 * time.Second)

	node2.Publish(context.Background(), "user1", "dns.test", json.RawMessage(`{"dns":"test"}`))

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("message not received via DNS-discovered peer")
	}
}

func TestDNSDiscoverySkipsSelf(t *testing.T) {
	resolver := &fakeResolver{addrs: []string{"127.0.0.1"}}
	node, err := New(Options{
		ListenAddr:           ":19022",
		AdvertiseAddr:        "127.0.0.1:19022",
		BufferSize:           64,
		MaxRetries:           3,
		RetryInterval:        50 * time.Millisecond,
		DNSDiscovery:         "fake-headless.svc",
		DNSDiscoveryPort:     "19022", // same port as self
		DNSDiscoveryInterval: 500 * time.Millisecond,
		Resolver:             resolver,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); node.Stop() })
	if err := node.Start(ctx); err != nil {
		t.Fatal(err)
	}

	time.Sleep(1 * time.Second)

	node.mu.RLock()
	peerCount := len(node.peers)
	node.mu.RUnlock()

	if peerCount != 0 {
		t.Fatalf("expected 0 peers (self should be skipped), got %d", peerCount)
	}
}

func TestDNSDiscoveryLookupFailure(t *testing.T) {
	resolver := &fakeResolver{err: fmt.Errorf("no such host")}
	node, err := New(Options{
		ListenAddr:           ":19023",
		AdvertiseAddr:        "127.0.0.1:19023",
		BufferSize:           64,
		MaxRetries:           3,
		RetryInterval:        50 * time.Millisecond,
		DNSDiscovery:         "nonexistent.svc",
		DNSDiscoveryPort:     "9000",
		DNSDiscoveryInterval: 500 * time.Millisecond,
		Resolver:             resolver,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); node.Stop() })
	if err := node.Start(ctx); err != nil {
		t.Fatal(err)
	}

	// Should not panic or crash — just log and retry
	time.Sleep(1 * time.Second)
}

func TestRateLimiting(t *testing.T) {
	node, err := New(Options{
		ListenAddr:    ":19030",
		AdvertiseAddr: "127.0.0.1:19030",
		BufferSize:    64,
		MaxRetries:    3,
		RetryInterval: 50 * time.Millisecond,
		PublishRate:   5, // 5 msg/sec
		PublishBurst:  5,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); node.Stop() })
	if err := node.Start(ctx); err != nil {
		t.Fatal(err)
	}

	node.Subscribe("rate.test", "sub1", func(_ context.Context, _ *Message) error { return nil })

	// Burn through the burst
	for i := range 5 {
		if _, err := node.Publish(ctx, "user1", "rate.test", json.RawMessage(`{}`)); err != nil {
			t.Fatalf("publish %d should succeed: %v", i, err)
		}
	}

	// Next publish should be rate limited
	_, err = node.Publish(ctx, "user1", "rate.test", json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected rate limit error")
	}

	stats := node.Stats()
	if stats.RateLimited == 0 {
		t.Fatal("expected RateLimited counter > 0")
	}
	if stats.Published != 5 {
		t.Fatalf("expected Published=5, got %d", stats.Published)
	}
}

func TestGracefulDrain(t *testing.T) {
	node, err := New(Options{
		ListenAddr:    ":19031",
		AdvertiseAddr: "127.0.0.1:19031",
		BufferSize:    64,
		MaxRetries:    3,
		RetryInterval: 50 * time.Millisecond,
		DrainTimeout:  2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := node.Start(ctx); err != nil {
		t.Fatal(err)
	}

	var delivered sync.Mutex
	var count int

	node.Subscribe("drain.test", "sub1", func(_ context.Context, _ *Message) error {
		delivered.Lock()
		count++
		delivered.Unlock()
		return nil
	})

	// Publish some messages
	for range 10 {
		node.Publish(ctx, "user1", "drain.test", json.RawMessage(`{}`))
	}
	time.Sleep(100 * time.Millisecond) // let delivery goroutines run

	// Stop should drain remaining messages
	node.Stop()

	delivered.Lock()
	final := count
	delivered.Unlock()

	if final != 10 {
		t.Fatalf("expected 10 delivered after drain, got %d", final)
	}

	// Publish after drain should fail
	_, err = node.Publish(ctx, "user1", "drain.test", json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected error publishing after drain")
	}
}

func TestMessageCounters(t *testing.T) {
	node1 := newTestNode(t, ":19032", "127.0.0.1:19032", nil)
	node2 := newTestNode(t, ":19033", "127.0.0.1:19033", []string{"127.0.0.1:19032"})

	done := make(chan struct{})
	node2.Subscribe("stats.test", "sub1", func(_ context.Context, _ *Message) error {
		close(done)
		return nil
	})
	node1.Subscribe("stats.test", "sub-local", func(_ context.Context, _ *Message) error {
		return nil
	})

	time.Sleep(200 * time.Millisecond) // let mesh form

	node1.Publish(context.Background(), "user1", "stats.test", json.RawMessage(`{"hello":"stats"}`))

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout waiting for cross-node delivery")
	}

	time.Sleep(100 * time.Millisecond)

	s1 := node1.Stats()
	if s1.Published != 1 {
		t.Fatalf("node1 Published: expected 1, got %d", s1.Published)
	}
	if s1.Forwarded < 1 {
		t.Fatalf("node1 Forwarded: expected >= 1, got %d", s1.Forwarded)
	}
	if s1.Delivered < 1 {
		t.Fatalf("node1 Delivered: expected >= 1, got %d", s1.Delivered)
	}

	s2 := node2.Stats()
	if s2.Received < 1 {
		t.Fatalf("node2 Received: expected >= 1, got %d", s2.Received)
	}
	if s2.Delivered < 1 {
		t.Fatalf("node2 Delivered: expected >= 1, got %d", s2.Delivered)
	}
}

func TestRequestReply(t *testing.T) {
	node := newTestNode(t, ":19040", "127.0.0.1:19040", nil)

	// Responder: echoes back the payload with a prefix
	node.Subscribe("rpc.echo", "responder", func(ctx context.Context, msg *Message) error {
		if msg.ReplyTo == "" {
			return nil // not a request
		}
		var req map[string]string
		json.Unmarshal(msg.Payload, &req)
		resp, _ := json.Marshal(map[string]string{"echo": req["input"]})
		node.Reply(ctx, msg, "responder", json.RawMessage(resp))
		return nil
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	payload, _ := json.Marshal(map[string]string{"input": "hello"})
	reply, err := node.Request(ctx, "caller", "rpc.echo", json.RawMessage(payload))
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}

	var resp map[string]string
	json.Unmarshal(reply.Payload, &resp)
	if resp["echo"] != "hello" {
		t.Fatalf("expected echo=hello, got %q", resp["echo"])
	}
}

func TestRequestReplyTimeout(t *testing.T) {
	node := newTestNode(t, ":19041", "127.0.0.1:19041", nil)

	// No responder subscribed — request should time out
	node.Subscribe("rpc.void", "noop", func(_ context.Context, _ *Message) error {
		return nil // does not reply
	})

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	_, err := node.Request(ctx, "caller", "rpc.void", json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestRequestReplyCrossNode(t *testing.T) {
	node1 := newTestNode(t, ":19042", "127.0.0.1:19042", nil)
	node2 := newTestNode(t, ":19043", "127.0.0.1:19043", []string{"127.0.0.1:19042"})

	time.Sleep(200 * time.Millisecond)

	// Responder on node2
	node2.Subscribe("rpc.add", "adder", func(ctx context.Context, msg *Message) error {
		if msg.ReplyTo == "" {
			return nil
		}
		var req map[string]int
		json.Unmarshal(msg.Payload, &req)
		sum := req["a"] + req["b"]
		resp, _ := json.Marshal(map[string]int{"sum": sum})
		node2.Reply(ctx, msg, "adder", json.RawMessage(resp))
		return nil
	})

	time.Sleep(200 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	payload, _ := json.Marshal(map[string]int{"a": 3, "b": 7})
	reply, err := node1.Request(ctx, "caller", "rpc.add", json.RawMessage(payload))
	if err != nil {
		t.Fatalf("cross-node request failed: %v", err)
	}

	var resp map[string]int
	json.Unmarshal(reply.Payload, &resp)
	if resp["sum"] != 10 {
		t.Fatalf("expected sum=10, got %d", resp["sum"])
	}
}

func TestChunkedTransfer(t *testing.T) {
	// Node1 has a 1KB message size limit; node2 receives and reassembles
	node1, err := New(Options{
		ListenAddr:     ":19050",
		AdvertiseAddr:  "127.0.0.1:19050",
		BufferSize:     64,
		MaxRetries:     3,
		RetryInterval:  50 * time.Millisecond,
		MaxMessageSize: 1024, // 1KB chunks
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx1, cancel1 := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel1(); node1.Stop() })
	if err := node1.Start(ctx1); err != nil {
		t.Fatal(err)
	}

	node2, err := New(Options{
		ListenAddr:    ":19051",
		AdvertiseAddr: "127.0.0.1:19051",
		Seeds:         []string{"127.0.0.1:19050"},
		BufferSize:    64,
		MaxRetries:    3,
		RetryInterval: 50 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel2(); node2.Stop() })
	if err := node2.Start(ctx2); err != nil {
		t.Fatal(err)
	}

	time.Sleep(200 * time.Millisecond)

	// Build a payload larger than 1KB
	bigData := make([]byte, 5000)
	for i := range bigData {
		bigData[i] = byte('A' + (i % 26))
	}
	payload, _ := json.Marshal(map[string]string{"data": string(bigData)})

	done := make(chan json.RawMessage, 1)
	node2.Subscribe("chunk.test", "sub1", func(_ context.Context, msg *Message) error {
		done <- msg.Payload
		return nil
	})

	time.Sleep(100 * time.Millisecond)

	node1.Publish(context.Background(), "user1", "chunk.test", json.RawMessage(payload))

	select {
	case received := <-done:
		var orig, got map[string]string
		json.Unmarshal(payload, &orig)
		json.Unmarshal(received, &got)
		if orig["data"] != got["data"] {
			t.Fatalf("payload mismatch: sent %d bytes, received %d bytes", len(orig["data"]), len(got["data"]))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timeout waiting for chunked message")
	}
}

func TestChunkedTransferLocalDelivery(t *testing.T) {
	// Verify local subscribers get the full payload without chunking
	node, err := New(Options{
		ListenAddr:     ":19052",
		AdvertiseAddr:  "127.0.0.1:19052",
		BufferSize:     64,
		MaxRetries:     3,
		RetryInterval:  50 * time.Millisecond,
		MaxMessageSize: 512,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); node.Stop() })
	if err := node.Start(ctx); err != nil {
		t.Fatal(err)
	}

	bigData := make([]byte, 3000)
	for i := range bigData {
		bigData[i] = byte('0' + (i % 10))
	}
	payload, _ := json.Marshal(map[string]string{"big": string(bigData)})

	done := make(chan json.RawMessage, 1)
	node.Subscribe("local.chunk", "sub1", func(_ context.Context, msg *Message) error {
		done <- msg.Payload
		return nil
	})

	node.Publish(context.Background(), "user1", "local.chunk", json.RawMessage(payload))

	select {
	case received := <-done:
		var orig, got map[string]string
		json.Unmarshal(payload, &orig)
		json.Unmarshal(received, &got)
		if orig["big"] != got["big"] {
			t.Fatalf("local payload mismatch: sent %d bytes, received %d bytes", len(orig["big"]), len(got["big"]))
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout")
	}
}

func TestSplitPayload(t *testing.T) {
	data := []byte("abcdefghij") // 10 bytes

	chunks := splitPayload(data, 3)
	if len(chunks) != 4 { // 3+3+3+1
		t.Fatalf("expected 4 chunks, got %d", len(chunks))
	}
	if string(chunks[0]) != "abc" {
		t.Fatalf("chunk 0: expected 'abc', got %q", chunks[0])
	}
	if string(chunks[3]) != "j" {
		t.Fatalf("chunk 3: expected 'j', got %q", chunks[3])
	}

	// No chunking needed
	single := splitPayload(data, 100)
	if len(single) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(single))
	}

	// Disabled (0)
	disabled := splitPayload(data, 0)
	if len(disabled) != 1 {
		t.Fatalf("expected 1 chunk for disabled, got %d", len(disabled))
	}
}

func TestDeadLetterQueue(t *testing.T) {
	node, err := New(Options{
		ListenAddr:    ":19060",
		AdvertiseAddr: "127.0.0.1:19060",
		BufferSize:    64,
		MaxRetries:    1,
		RetryInterval: 10 * time.Millisecond,
		EnableDLQ:     true,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		node.Stop()
	})
	if err := node.Start(ctx); err != nil {
		t.Fatal(err)
	}

	// Subscriber that always fails
	node.Subscribe("orders", "bad-handler", func(_ context.Context, m *Message) error {
		return fmt.Errorf("processing failed")
	})

	// DLQ subscriber to catch dead-lettered messages
	var dlqMsg *Message
	var dlqMu sync.Mutex
	dlqDone := make(chan struct{}, 1)

	node.Subscribe("_dlq.orders", "dlq-reader", func(_ context.Context, m *Message) error {
		dlqMu.Lock()
		dlqMsg = m
		dlqMu.Unlock()
		select {
		case dlqDone <- struct{}{}:
		default:
		}
		return nil
	})

	// Publish a message that will fail delivery
	node.Publish(ctx, "test", "orders", json.RawMessage(`{"item":"widget"}`))

	select {
	case <-dlqDone:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for DLQ message")
	}

	dlqMu.Lock()
	defer dlqMu.Unlock()
	if dlqMsg == nil {
		t.Fatal("expected DLQ message")
	}
	if string(dlqMsg.Payload) != `{"item":"widget"}` {
		t.Fatalf("unexpected DLQ payload: %s", dlqMsg.Payload)
	}

	snap := node.Stats()
	if snap.DeadLettered == 0 {
		t.Fatal("expected DeadLettered counter > 0")
	}
}

func TestOverflowQueue(t *testing.T) {
	node, err := New(Options{
		ListenAddr:    ":19061",
		AdvertiseAddr: "127.0.0.1:19061",
		BufferSize:    2, // tiny buffer to force overflow
		MaxRetries:    0,
		RetryInterval: 10 * time.Millisecond,
		QueueFactory:  MemoryQueueFactory(),
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancel()
		node.Stop()
	})
	if err := node.Start(ctx); err != nil {
		t.Fatal(err)
	}

	var received []*Message
	var mu sync.Mutex
	done := make(chan struct{})

	// Slow subscriber — blocks so buffer fills up
	gate := make(chan struct{})
	node.Subscribe("work", "slow-worker", func(_ context.Context, m *Message) error {
		<-gate // block until we release
		mu.Lock()
		received = append(received, m)
		mu.Unlock()
		if len(received) >= 10 {
			select {
			case done <- struct{}{}:
			default:
			}
		}
		return nil
	})

	// Publish 10 messages — buffer is only 2, rest should overflow
	for i := range 10 {
		node.Publish(ctx, "producer", "work", json.RawMessage(fmt.Sprintf(`{"n":%d}`, i)))
	}

	// Release the gate so the subscriber can process
	close(gate)

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for all messages")
	}

	mu.Lock()
	defer mu.Unlock()
	if len(received) < 10 {
		t.Fatalf("expected 10 messages, got %d", len(received))
	}

	snap := node.Stats()
	if snap.Overflowed == 0 {
		t.Fatal("expected Overflowed counter > 0")
	}
}

func TestFileQueue(t *testing.T) {
	dir := t.TempDir()
	q, err := NewFileQueue(dir)
	if err != nil {
		t.Fatal(err)
	}

	// Enqueue 3 messages
	for i := range 3 {
		msg := &Message{
			ID:      fmt.Sprintf("msg-%d", i),
			Payload: json.RawMessage(fmt.Sprintf(`{"n":%d}`, i)),
		}
		if err := q.Enqueue(msg); err != nil {
			t.Fatal(err)
		}
	}

	if q.Len() != 3 {
		t.Fatalf("expected len 3, got %d", q.Len())
	}

	// Dequeue in order
	for i := range 3 {
		msg, ok := q.Dequeue()
		if !ok {
			t.Fatalf("expected message %d", i)
		}
		expected := fmt.Sprintf("msg-%d", i)
		if msg.ID != expected {
			t.Fatalf("expected %s, got %s", expected, msg.ID)
		}
	}

	// Should be empty
	_, ok := q.Dequeue()
	if ok {
		t.Fatal("expected empty queue")
	}
}
