package pubsub

import (
	"sync/atomic"
	"testing"
	"time"
)

func newTestNode(t *testing.T, grpcAddr string) *Node {
	t.Helper()
	opts := DefaultOptions()
	opts.GRPCAddress = grpcAddr
	opts.EnableMDNS = false
	opts.HealthCheckInterval = 1 * time.Second
	opts.MaxHealthFailures = 2
	opts.DedupTTL = 5 * time.Second
	n := NewNode(opts)
	if err := n.Start(); err != nil {
		t.Fatalf("start node %s: %v", grpcAddr, err)
	}
	t.Cleanup(func() { n.Stop() })
	return n
}

func TestNode_PublishSubscribe(t *testing.T) {
	n := newTestNode(t, "localhost:19001")

	var received atomic.Int32
	_, err := n.Subscribe("test", func(msg *Message) error {
		received.Add(1)
		return nil
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}

	n.Publish(&Message{Destination: "test", Payload: []byte("hello")})

	time.Sleep(100 * time.Millisecond)
	if received.Load() != 1 {
		t.Fatalf("expected 1 message, got %d", received.Load())
	}
}

func TestNode_Dedup(t *testing.T) {
	n := newTestNode(t, "localhost:19002")

	var received atomic.Int32
	n.Subscribe("test", func(msg *Message) error {
		received.Add(1)
		return nil
	})

	n.Publish(&Message{ID: "dup1", Destination: "test", Payload: []byte("a")})
	n.Publish(&Message{ID: "dup1", Destination: "test", Payload: []byte("a")})

	time.Sleep(100 * time.Millisecond)
	if received.Load() != 1 {
		t.Fatalf("expected 1 (dedup), got %d", received.Load())
	}
}

func TestNode_PeerForwarding(t *testing.T) {
	n1 := newTestNode(t, "localhost:19003")
	n2 := newTestNode(t, "localhost:19004")

	var received atomic.Int32
	n2.Subscribe("chat", func(msg *Message) error {
		received.Add(1)
		return nil
	})

	// Give subscription time to register, then connect peers.
	time.Sleep(100 * time.Millisecond)
	if err := n1.joinPeer("localhost:19004"); err != nil {
		t.Fatalf("join: %v", err)
	}

	// Wait for topic sync to propagate.
	time.Sleep(500 * time.Millisecond)

	n1.Publish(&Message{Destination: "chat", Payload: []byte("hello from n1")})

	time.Sleep(500 * time.Millisecond)
	if received.Load() != 1 {
		t.Fatalf("expected 1 forwarded message, got %d", received.Load())
	}
}

func TestNode_ServiceRegistry(t *testing.T) {
	n := newTestNode(t, "localhost:19005")

	n.registerService("chat", "server1")
	svcs := n.GetServices()
	local, ok := svcs[n.opts.NodeID]
	if !ok {
		t.Fatal("expected local services")
	}
	if len(local["chat"]) != 1 || local["chat"][0] != "server1" {
		t.Fatalf("unexpected services: %v", local)
	}

	n.unregisterService("chat", "server1")
	svcs = n.GetServices()
	local = svcs[n.opts.NodeID]
	if len(local["chat"]) != 0 {
		t.Fatalf("expected empty after unregister: %v", local)
	}
}

func TestNode_HealthCheckRemovesPeer(t *testing.T) {
	n1 := newTestNode(t, "localhost:19006")
	n2 := newTestNode(t, "localhost:19007")

	if err := n1.joinPeer("localhost:19007"); err != nil {
		t.Fatalf("join: %v", err)
	}

	peers := n1.GetPeers()
	if len(peers) != 1 {
		t.Fatalf("expected 1 peer, got %d", len(peers))
	}

	// Stop n2 — health checks should remove it.
	n2.Stop()

	// Wait for health checks to detect and remove (interval=1s, failures=2).
	time.Sleep(4 * time.Second)

	peers = n1.GetPeers()
	if len(peers) != 0 {
		t.Fatalf("expected 0 peers after health check, got %d", len(peers))
	}
}

func TestNode_History(t *testing.T) {
	n := newTestNode(t, "localhost:19008")

	n.Subscribe("chat", func(msg *Message) error { return nil })

	for i := range 5 {
		n.Publish(&Message{Destination: "chat", Payload: []byte{byte(i)}})
	}

	time.Sleep(100 * time.Millisecond)
	h := n.History("chat", 10)
	if len(h) != 5 {
		t.Fatalf("expected 5 history entries, got %d", len(h))
	}
}
