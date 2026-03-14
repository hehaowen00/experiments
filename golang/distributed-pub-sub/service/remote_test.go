package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"distributed-pub-sub/pubsub"
)

// startGatewayNode creates a pubsub node and starts an HTTP gateway on a random port.
// Returns the gateway URL and a cleanup function.
func startGatewayNode(t *testing.T, seeds []string) (string, *pubsub.Node) {
	t.Helper()
	grpcPort := nextPort()
	httpPort := nextPort()

	grpcAddr := fmt.Sprintf("127.0.0.1:%d", grpcPort)
	node, err := pubsub.New(pubsub.Options{
		ListenAddr:       fmt.Sprintf(":%d", grpcPort),
		AdvertiseAddr:    grpcAddr,
		Seeds:            seeds,
		ExchangeInterval: 500 * time.Millisecond,
		BufferSize:       64,
		MaxRetries:       3,
		RetryInterval:    50 * time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	if err := node.Start(ctx); err != nil {
		cancel()
		t.Fatal(err)
	}

	gw := pubsub.NewGateway(node)
	httpAddr := fmt.Sprintf(":%d", httpPort)
	server := &http.Server{Addr: httpAddr, Handler: gw}
	go server.ListenAndServe()

	t.Cleanup(func() {
		server.Close()
		cancel()
		node.Stop()
	})

	return fmt.Sprintf("http://127.0.0.1:%d", httpPort), node
}

func TestRemoteEmitAndOn(t *testing.T) {
	gwURL, _ := startGatewayNode(t, nil)

	// Give HTTP server time to start
	time.Sleep(100 * time.Millisecond)

	transport := NewRemoteTransport(gwURL)
	if err := transport.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer transport.Close()

	svc := New("events", transport, "remote-1")

	var received string
	var mu sync.Mutex
	done := make(chan struct{})

	svc.On("ping", func(ctx *Context) error {
		mu.Lock()
		received = string(ctx.Payload())
		mu.Unlock()
		close(done)
		return nil
	})

	if err := svc.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc.Stop()

	// Small delay for WS subscription to register
	time.Sleep(200 * time.Millisecond)

	svc.Emit(context.Background(), "ping", map[string]string{"msg": "hello"})

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout")
	}

	mu.Lock()
	defer mu.Unlock()
	if received == "" {
		t.Fatal("no event received via remote transport")
	}
}

func TestRemoteRPC(t *testing.T) {
	gwURL, node := startGatewayNode(t, nil)

	time.Sleep(100 * time.Millisecond)

	// Register the RPC handler directly on the node (simulating a co-located service)
	embedded := newSvc("math", node)
	embedded.Handle("add", func(ctx *Context) error {
		var req struct{ A, B int }
		ctx.Bind(&req)
		return ctx.Reply(map[string]int{"result": req.A + req.B})
	})
	if err := embedded.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer embedded.Stop()

	// Remote client calls the RPC via HTTP
	transport := NewRemoteTransport(gwURL)
	if err := transport.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer transport.Close()

	remote := New("caller", transport, "remote-caller")
	if err := remote.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer remote.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := remote.Call(ctx, "math.add", map[string]int{"A": 10, "B": 20})
	if err != nil {
		t.Fatal(err)
	}

	var result struct{ Result int }
	json.Unmarshal(resp, &result)
	if result.Result != 30 {
		t.Fatalf("expected 30, got %d", result.Result)
	}
}

func TestRemoteDirectMessage(t *testing.T) {
	gwURL, _ := startGatewayNode(t, nil)

	time.Sleep(100 * time.Millisecond)

	transport := NewRemoteTransport(gwURL)
	if err := transport.Connect(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer transport.Close()

	svc := New("chat", transport, "remote-chat")

	if err := svc.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc.Stop()

	bob := svc.Client("bob")
	defer bob.Close()

	var received string
	var mu sync.Mutex
	done := make(chan struct{})

	bob.OnMessage(func(ctx *Context) error {
		mu.Lock()
		received = string(ctx.Payload())
		mu.Unlock()
		close(done)
		return nil
	})

	time.Sleep(200 * time.Millisecond)

	svc.Send(context.Background(), "bob", map[string]string{"text": "hello bob"})

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout")
	}

	mu.Lock()
	defer mu.Unlock()
	if received == "" {
		t.Fatal("no direct message received via remote transport")
	}
}
