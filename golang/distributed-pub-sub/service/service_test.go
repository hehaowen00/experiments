package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"distributed-pub-sub/pubsub"
)

var portCounter = 22000

func nextPort() int {
	portCounter++
	return portCounter
}

func newTestNode(t *testing.T, seeds []string) (*pubsub.Node, string) {
	t.Helper()
	port := nextPort()
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	node, err := pubsub.New(pubsub.Options{
		ListenAddr:       fmt.Sprintf(":%d", port),
		AdvertiseAddr:    addr,
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
	t.Cleanup(func() {
		cancel()
		node.Stop()
	})
	if err := node.Start(ctx); err != nil {
		t.Fatal(err)
	}
	return node, addr
}

// newSvc is a helper that wraps a node with EmbeddedTransport.
func newSvc(namespace string, node *pubsub.Node) *Service {
	return New(namespace, &EmbeddedTransport{Node: node}, node.ID())
}

func TestHandleAndCall(t *testing.T) {
	node, _ := newTestNode(t, nil)

	svc := newSvc("math", node)
	svc.Handle("add", func(ctx *Context) error {
		var req struct{ A, B int }
		ctx.Bind(&req)
		return ctx.Reply(map[string]int{"result": req.A + req.B})
	})
	if err := svc.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	resp, err := svc.Call(ctx, "math.add", map[string]int{"A": 3, "B": 4})
	if err != nil {
		t.Fatal(err)
	}

	var result struct{ Result int }
	json.Unmarshal(resp, &result)
	if result.Result != 7 {
		t.Fatalf("expected 7, got %d", result.Result)
	}
}

func TestClientCall(t *testing.T) {
	node, _ := newTestNode(t, nil)

	svc := newSvc("echo", node)
	svc.Handle("ping", func(ctx *Context) error {
		return ctx.Reply(map[string]string{"pong": string(ctx.Payload())})
	})
	if err := svc.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc.Stop()

	client := svc.Client("alice")
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	resp, err := client.Call(ctx, "ping", "hello")
	if err != nil {
		t.Fatal(err)
	}

	var result map[string]string
	json.Unmarshal(resp, &result)
	if result["pong"] != `"hello"` {
		t.Fatalf("expected \"hello\", got %s", result["pong"])
	}
}

func TestEmitAndOn(t *testing.T) {
	node, _ := newTestNode(t, nil)

	svc := newSvc("events", node)
	var received string
	var mu sync.Mutex
	done := make(chan struct{})

	svc.On("user.joined", func(ctx *Context) error {
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

	svc.Emit(context.Background(), "user.joined", map[string]string{"name": "bob"})

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}

	mu.Lock()
	defer mu.Unlock()
	if received == "" {
		t.Fatal("no event received")
	}
}

func TestClientOnEvent(t *testing.T) {
	node, _ := newTestNode(t, nil)

	svc := newSvc("chat", node)
	if err := svc.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc.Stop()

	client := svc.Client("bob")
	defer client.Close()

	var received string
	var mu sync.Mutex
	done := make(chan struct{})

	client.On("room.general", func(ctx *Context) error {
		mu.Lock()
		received = string(ctx.Payload())
		mu.Unlock()
		close(done)
		return nil
	})

	svc.Emit(context.Background(), "room.general", map[string]string{"text": "hello room"})

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}

	mu.Lock()
	defer mu.Unlock()
	if received == "" {
		t.Fatal("no message received")
	}
}

func TestDirectMessage(t *testing.T) {
	node, _ := newTestNode(t, nil)

	svc := newSvc("chat", node)
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

	svc.Send(context.Background(), "bob", map[string]string{"text": "hello bob"})

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}

	mu.Lock()
	defer mu.Unlock()
	if received == "" {
		t.Fatal("no direct message received")
	}
}

func TestCrossNodeDirectMessage(t *testing.T) {
	node1, addr1 := newTestNode(t, nil)
	node2, _ := newTestNode(t, []string{addr1})

	time.Sleep(500 * time.Millisecond)

	svc1 := newSvc("chat", node1)
	svc2 := newSvc("chat", node2)
	if err := svc1.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc1.Stop()
	if err := svc2.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc2.Stop()

	bob := svc2.Client("bob")
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

	time.Sleep(time.Second)

	svc1.Send(context.Background(), "bob", map[string]string{"from": "alice", "text": "hi across nodes"})

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout: direct message didn't reach bob on node 2")
	}

	mu.Lock()
	defer mu.Unlock()
	if received == "" {
		t.Fatal("no cross-node direct message received")
	}
}

func TestCrossNodeRPC(t *testing.T) {
	node1, addr1 := newTestNode(t, nil)
	node2, _ := newTestNode(t, []string{addr1})

	time.Sleep(500 * time.Millisecond)

	auth := newSvc("auth", node2)
	auth.Handle("verify", func(ctx *Context) error {
		var token string
		ctx.Bind(&token)
		if token == "valid-token" {
			return ctx.Reply(map[string]any{"ok": true, "user": "alice"})
		}
		return ctx.Reply(map[string]any{"ok": false})
	})
	if err := auth.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer auth.Stop()

	chat := newSvc("chat", node1)
	if err := chat.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer chat.Stop()

	time.Sleep(time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := chat.Call(ctx, "auth.verify", "valid-token")
	if err != nil {
		t.Fatal(err)
	}

	var result map[string]any
	json.Unmarshal(resp, &result)
	if result["ok"] != true {
		t.Fatalf("expected ok=true, got %v", result)
	}
	if result["user"] != "alice" {
		t.Fatalf("expected user=alice, got %v", result["user"])
	}
}

func TestChatScenario(t *testing.T) {
	node1, addr1 := newTestNode(t, nil)
	node2, _ := newTestNode(t, []string{addr1})

	time.Sleep(500 * time.Millisecond)

	chat1 := newSvc("chat", node1)
	chat2 := newSvc("chat", node2)

	sendHandler := func(svc *Service) HandlerFunc {
		return func(ctx *Context) error {
			var msg struct {
				To   string `json:"to"`
				Text string `json:"text"`
			}
			ctx.Bind(&msg)
			svc.Send(ctx, msg.To, map[string]string{
				"from": ctx.Source(),
				"text": msg.Text,
			})
			return ctx.Reply(map[string]string{"status": "delivered"})
		}
	}
	chat1.Handle("send", sendHandler(chat1))
	chat2.Handle("send", sendHandler(chat2))

	if err := chat1.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer chat1.Stop()
	if err := chat2.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer chat2.Stop()

	alice := chat1.Client("alice")
	defer alice.Close()

	bob := chat2.Client("bob")
	defer bob.Close()

	var bobReceived string
	var mu sync.Mutex
	done := make(chan struct{})
	var doneOnce sync.Once

	bob.OnMessage(func(ctx *Context) error {
		mu.Lock()
		bobReceived = string(ctx.Payload())
		mu.Unlock()
		doneOnce.Do(func() { close(done) })
		return nil
	})

	time.Sleep(time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := alice.Call(ctx, "send", map[string]string{"to": "bob", "text": "hey bob!"})
	if err != nil {
		t.Fatal(err)
	}

	var status map[string]string
	json.Unmarshal(resp, &status)
	if status["status"] != "delivered" {
		t.Fatalf("expected delivered, got %s", status["status"])
	}

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout: bob didn't receive the message")
	}

	mu.Lock()
	defer mu.Unlock()
	if bobReceived == "" {
		t.Fatal("bob received nothing")
	}
}

func TestClientEmitCrossNode(t *testing.T) {
	node1, addr1 := newTestNode(t, nil)
	node2, _ := newTestNode(t, []string{addr1})

	time.Sleep(500 * time.Millisecond)

	chat1 := newSvc("chat", node1)
	chat2 := newSvc("chat", node2)
	if err := chat1.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer chat1.Stop()
	if err := chat2.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer chat2.Stop()

	alice := chat1.Client("alice")
	defer alice.Close()
	bob := chat2.Client("bob")
	defer bob.Close()

	var received string
	var mu sync.Mutex
	done := make(chan struct{})

	bob.On("room.general", func(ctx *Context) error {
		mu.Lock()
		received = string(ctx.Payload())
		mu.Unlock()
		close(done)
		return nil
	})

	time.Sleep(time.Second)

	alice.Emit(context.Background(), "room.general", map[string]string{"text": "hello room"})

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("timeout: room message didn't reach bob")
	}

	mu.Lock()
	defer mu.Unlock()
	if received == "" {
		t.Fatal("bob received nothing in room")
	}
}

func TestStreaming(t *testing.T) {
	node, _ := newTestNode(t, nil)

	svc := newSvc("data", node)

	// Server handler: acknowledges via Stream() (which auto-replies),
	// then streams 5 items and closes.
	svc.Handle("list", func(ctx *Context) error {
		sw, err := ctx.Stream()
		if err != nil {
			return err
		}
		for i := 1; i <= 5; i++ {
			sw.Send(map[string]int{"n": i})
		}
		return sw.Close()
	})

	if err := svc.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc.Stop()

	client := svc.Client("alice")
	defer client.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	stream, err := client.CallStream(ctx, "list", map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()

	var items []int
	for item := range stream.Ch {
		var v struct{ N int }
		json.Unmarshal(item.Payload, &v)
		items = append(items, v.N)
	}

	if len(items) != 5 {
		t.Fatalf("expected 5 items, got %d: %v", len(items), items)
	}
	for i, v := range items {
		if v != i+1 {
			t.Fatalf("item %d: expected %d, got %d", i, i+1, v)
		}
	}
}

func TestStreamingCrossNode(t *testing.T) {
	node1, addr1 := newTestNode(t, nil)
	node2, _ := newTestNode(t, []string{addr1})

	time.Sleep(500 * time.Millisecond)

	// Server on node1
	svc1 := newSvc("data", node1)
	svc1.Handle("range", func(ctx *Context) error {
		var req struct {
			Start int `json:"start"`
			End   int `json:"end"`
		}
		ctx.Bind(&req)
		sw, err := ctx.Stream() // auto-replies to unblock caller
		if err != nil {
			return err
		}
		for i := req.Start; i <= req.End; i++ {
			sw.Send(map[string]int{"val": i})
		}
		return sw.Close()
	})
	if err := svc1.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc1.Stop()

	// Caller on node2
	svc2 := newSvc("caller", node2)
	if err := svc2.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc2.Stop()

	time.Sleep(time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	stream, err := svc2.CallStream(ctx, "data.range", map[string]int{"start": 10, "end": 13})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()

	var vals []int
	for item := range stream.Ch {
		var v struct{ Val int }
		json.Unmarshal(item.Payload, &v)
		vals = append(vals, v.Val)
	}

	expected := []int{10, 11, 12, 13}
	if len(vals) != len(expected) {
		t.Fatalf("expected %v, got %v", expected, vals)
	}
	for i := range vals {
		if vals[i] != expected[i] {
			t.Fatalf("item %d: expected %d, got %d", i, expected[i], vals[i])
		}
	}
}

func TestMiddleware(t *testing.T) {
	node, _ := newTestNode(t, nil)

	svc := newSvc("mw", node)

	var log []string
	var mu sync.Mutex

	svc.Use(func(next HandlerFunc) HandlerFunc {
		return func(ctx *Context) error {
			mu.Lock()
			log = append(log, "before:"+ctx.Topic())
			mu.Unlock()
			err := next(ctx)
			mu.Lock()
			log = append(log, "after:"+ctx.Topic())
			mu.Unlock()
			return err
		}
	})

	done := make(chan struct{})
	svc.On("test", func(ctx *Context) error {
		close(done)
		return nil
	})

	if err := svc.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	defer svc.Stop()

	svc.Emit(context.Background(), "test", "ping")

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout")
	}

	// Small delay for after middleware to complete
	time.Sleep(50 * time.Millisecond)

	mu.Lock()
	defer mu.Unlock()
	if len(log) != 2 || log[0] != "before:mw.test" || log[1] != "after:mw.test" {
		t.Fatalf("expected [before:mw.test, after:mw.test], got %v", log)
	}
}
