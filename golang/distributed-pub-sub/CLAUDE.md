# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
# Build everything
go build ./...

# Run all tests (verbose, no caching)
go test -v -count=1 ./pubsub/

# Run a single test
go test -v -run TestMultiNodeForwarding ./pubsub/

# Regenerate protobuf code (requires protoc + protoc-gen-go + protoc-gen-go-grpc)
# protoc-gen-go lives in ~/go/bin, which may not be in PATH
cd pubsub/internal/pb && PATH="$PATH:$HOME/go/bin" protoc --go_out=. --go_opt=paths=source_relative --go-grpc_out=. --go-grpc_opt=paths=source_relative pubsub.proto
```

## Architecture

Two layers: the **`pubsub` package** (embeddable library) and **`cmd/`** (demo applications that wire the library into working systems).

### pubsub package — P2P message routing library

Nodes form a peer-to-peer mesh via gRPC. No central broker. The library handles routing, delivery, queuing, and mesh management.

**Core API:**
- `New(Options)` / `Start(ctx)` / `Stop()` — lifecycle
- `Publish(ctx, source, topic, payload)` — send a message into the mesh
- `Subscribe(topic, id, Handler)` / `Unsubscribe(topic, id)` — `Handler` is `func(ctx, *Message) error`; return nil to ack, error to retry
- `Request(ctx, source, topic, payload)` / `Reply(ctx, request, source, payload)` — request-response over temporary `_reply.{uuid}` topics
- `NewGateway(node, ...GatewayOption)` — HTTP gateway exposing the node via REST + WebSocket (`POST /publish`, `POST /request`, `GET /subscribe`, `GET /stats`)

**Message flow:**
1. `Publish()` assigns a per-source sequence number, dedup-marks the message, delivers locally, then async-floods to peers via gRPC `Forward`.
2. Peers dedup by message ID, deliver to local subscribers.
3. Each subscriber runs a goroutine with a buffered channel, maintaining per-source FIFO via sequence tracking and a reorder buffer.
4. Payloads exceeding `MaxMessageSize` are transparently chunked for forwarding and reassembled on receive — subscribers always see the full message.

**Message queue features:**
- **Overflow buffering**: When a subscriber's in-memory channel is full, messages spill to a `QueueStore` instead of being dropped. Set `QueueFactory` in Options.
- **Dead letter queue**: When `EnableDLQ` is true, messages that exhaust delivery retries are republished to `_dlq.<original_topic>` instead of being silently dropped.
- **Pluggable storage**: `QueueStore` interface with `MemoryQueue` (in-memory) and `FileQueue` (disk-backed, survives restarts) implementations. `MemoryQueueFactory()` and `FileQueueFactory(baseDir)` create factories.

**Mesh formation:**
- Nodes bootstrap via `Join` RPC on seed addresses, which returns the full peer list.
- Periodic `Exchange` loop syncs peer lists and topic subscriptions across all peers (self-healing).
- Topic-aware forwarding: peers report their subscribed topics during exchange; messages skip peers with no matching subscribers (conservative — forwards when unknown).
- Optional Kubernetes DNS discovery via headless service hostname (`DNSDiscovery` option).
- Unreachable peers evicted after repeated exchange failures.

**Key design points:**
- Internal gRPC transport (`pubsub/internal/pb/`) is not importable by consumers.
- At-least-once delivery with configurable retries + backoff. Dedup via `sync.Map` with 1-minute TTL.
- Per-source token bucket rate limiting (`PublishRate`/`PublishBurst` options).
- 5-phase graceful drain on `Stop()`: reject publishes → wait for in-flight forwards → cancel context → drain subscriber buffers → stop gRPC.
- Atomic activity counters via `Stats()`: Published, Forwarded, Received, Delivered, Dropped, DeadLettered, Overflowed, Deduplicated, RateLimited.

### cmd/chat/ — Chat demo

- `server/` — HTTP server with gorilla/websocket, SQLite persistence, shared DB, file attachments, UDP multicast announcing for LB discovery, inter-server history sync
- `client/` — Interactive CLI with auto-reconnect, read receipts with timestamps, history replay
- `lb/` — Load balancer with UDP multicast discovery, health checks, WebSocket proxying

### cmd/queue/ — Message queue demo

- `producer/` — Publishes job messages at a configurable rate
- `consumer/` — Processes jobs with configurable failure rate, DLQ subscriber, disk-backed overflow, periodic stats

### cmd/mesh/ — Mesh services demo (order processing pipeline)

Services connect to dedicated mesh nodes via HTTP (publish) and WebSocket (subscribe) — they do **not** embed the pubsub library. The mesh handles routing, delivery, and DLQ transparently.

- `node/` — Standalone mesh node wrapping `pubsub.New()` + `pubsub.NewGateway()` with HTTP + gRPC listeners
- `orders/` — Publishes order events via HTTP POST at a configurable rate
- `validator/` — Subscribes to `orders.new` via WebSocket, validates orders, publishes to `orders.validated` or `orders.rejected`
- `processor/` — Subscribes to `orders.validated` via WebSocket, simulates fulfillment, publishes to `orders.completed`
- `monitor/` — Subscribes to all order topics via WebSocket multi-subscribe, logs pipeline activity with periodic summaries

### File layout within pubsub/

- `node.go` — Node struct, Publish, Subscribe, Forward RPC, mesh management
- `gateway.go` — HTTP/WebSocket gateway, HistoryProvider interface
- `reqresp.go` — Request/Reply over temporary topics
- `subscriber.go` — Per-subscriber goroutine with FIFO ordering, retry, overflow, DLQ
- `queue.go` — QueueStore interface, MemoryQueue, FileQueue implementations
- `peer.go` — Peer connection wrapper with topic tracking
- `stream.go` — Chunked message splitting and reassembly
- `discovery.go` — Kubernetes DNS-based peer discovery
- `ratelimit.go` — Per-key token bucket rate limiter
- `stats.go` — Atomic activity counters
- `message.go` — Message struct and Handler type
- `options.go` — Options struct, Resolver interface, DefaultOptions
- `node_test.go` — 24 tests covering all features
