# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Test Commands

```bash
# Build everything
go build ./...

# Run all tests (verbose, no caching)
go test -v -count=1 ./pubsub/
go test -v -count=1 ./service/

# Run a single test
go test -v -run TestMultiNodeForwarding ./pubsub/
go test -v -run TestStreamingCrossNode ./service/

# Regenerate protobuf code (requires protoc + protoc-gen-go + protoc-gen-go-grpc)
# protoc-gen-go lives in ~/go/bin, which may not be in PATH
cd pubsub/internal/pb && PATH="$PATH:$HOME/go/bin" protoc --go_out=. --go_opt=paths=source_relative --go-grpc_out=. --go-grpc_opt=paths=source_relative pubsub.proto
```

## Architecture

Three layers: the **`pubsub` package** (embeddable library), the **`service` package** (microservice DX layer), and **`cmd/`** (demo applications).

### pubsub package — P2P message routing library

Nodes form a peer-to-peer mesh via gRPC. No central broker. The library handles routing, delivery, queuing, and mesh management.

**Core API:**
- `New(Options)` / `Start(ctx)` / `Stop()` — lifecycle
- `Publish(ctx, source, topic, payload)` — send a message into the mesh
- `Subscribe(topic, id, Handler)` / `Unsubscribe(topic, id)` — `Handler` is `func(ctx, *Message) error`; return nil to ack, error to retry
- `Request(ctx, source, topic, payload)` / `Reply(ctx, request, source, payload)` — request-response over temporary `_reply.{uuid}` topics
- `NewGateway(node, ...GatewayOption)` — HTTP gateway exposing the node via REST + WebSocket (`POST /publish`, `POST /request`, `GET /subscribe`, `GET /stats`, `GET /topics`, `GET /peers`, `GET /sessions`)
- `TopicSubscriberCounts()` — returns map of topic → subscriber count
- `PeerInfo()` — returns peer addresses and their known topics

**Message flow:**
1. `Publish()` assigns a per-(source, topic) sequence number, dedup-marks the message, delivers locally, then async-floods to peers via gRPC `Forward`.
2. Peers dedup by message ID, deliver to local subscribers.
3. Each subscriber runs a goroutine with a buffered channel, maintaining per-source FIFO via sequence tracking and a reorder buffer. Messages with `Sequence == 0` bypass reorder logic (used for unsequenced/stream messages).
4. Payloads exceeding `MaxMessageSize` are transparently chunked for forwarding and reassembled on receive — subscribers always see the full message.

**Ephemeral topic forwarding:** Topics prefixed with `_reply.`, `_stream.`, or `_dlq.` are always forwarded to all peers regardless of topic-aware filtering. These are dynamically created topics that may not yet be known via exchange.

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
- `Subscribe()` uses upsert semantics — re-subscribing with the same ID replaces the handler (drains old buffer).
- WebSocket ping/pong keepalive on gateway connections (30s interval, 40s timeout).

### service package — Microservice DX layer

Higher-level API for building microservices on the pubsub mesh. Services are **decoupled from the pubsub node** via the `Transport` interface — they connect to standalone mesh nodes over HTTP/WebSocket rather than embedding them.

**Transport implementations:**
- `EmbeddedTransport` — wraps `*pubsub.Node` directly (tests, single-binary deployments)
- `RemoteTransport` — connects to one or more mesh node HTTP/WebSocket gateways (production architecture). Accepts multiple URLs via `NewRemoteTransport(urls...)` and cycles through them on reconnect. Features auto-reconnect with exponential backoff, re-subscribes to all topics on reconnect, and fires an `OnReconnect` callback for application recovery. WebSocket ping/pong keepalive prevents idle connection drops.

**Topic conventions:**
- `{ns}.{method}` — RPC handlers (Request/Reply)
- `{ns}.{event}` — fan-out events (Publish/Subscribe)
- `{ns}._inbox.{clientID}` — direct messages to a specific client
- `_stream.{uuid}` — ephemeral streaming topics (auto-forwarded across nodes)
- `_reply.{uuid}` — ephemeral reply topics (auto-forwarded across nodes)

**Service API:**
- `New(namespace, transport, id)` / `Start(ctx)` / `Stop()` — lifecycle
- `Handle(method, fn)` — register RPC handler, fn receives `*Context` with `Bind()`, `Reply()`, `Stream()`
- `On(event, fn)` — subscribe to fan-out events
- `Emit(ctx, event, data)` — publish event within namespace
- `Send(ctx, clientID, data)` — push to a specific client's inbox (cross-node)
- `Call(ctx, "svc.method", data)` — RPC to any service (fully-qualified topic)
- `CallStream(ctx, "svc.method", data)` — streaming RPC (fully-qualified topic)
- `Use(middleware...)` — add cross-cutting middleware (persistence, logging, metrics)
- `Client(id)` — create a client scoped to this service

**Client API:**
- `On(event, fn)` — subscribe to events within service namespace
- `OnMessage(fn)` — receive direct messages
- `Emit(ctx, event, data)` — publish to service namespace
- `Call(ctx, method, data)` — RPC (namespace-scoped)
- `CallStream(ctx, method, data)` — streaming RPC (namespace-scoped)
- `Close()` — unsubscribe all

**Streaming:** `CallStream` subscribes to a temporary `_stream.{uuid}` topic, sends a `Request` with `_stream_to` injected into the payload. The server handler calls `ctx.Stream()` which auto-replies to unblock the caller, then returns a `StreamWriter`. Items are buffered via `Send()` and flushed as a single batch on `Close()`. The client receives items via `stream.Ch` channel.

**Context helpers:** `Bind(v)`, `Reply(data)`, `Stream()`, `Payload()`, `Source()`, `Topic()`, `MessageID()`, `Timestamp()`

### hashmap package — Distributed key-value store

Full-replica distributed hashmap built on the pubsub mesh. Every node holds all data. Last-write-wins conflict resolution using microsecond timestamps. Tombstone deletes prevent stale resurrections.

**Core API:**
- `New(Options)` / `Start(ctx)` / `Stop()` — lifecycle (wraps a pubsub.Node)
- `Set(ctx, key, value)` / `Get(key)` / `Delete(ctx, key)` — CRUD
- `Keys()` / `Len()` / `Snapshot()` / `ForEach(fn)` — iteration
- `Node()` — access underlying pubsub node

**Replication:** Writes broadcast via `_hashmap.set` and `_hashmap.delete` topics. Anti-entropy sync on startup pulls full state from a peer via Request/Reply on `_hashmap.sync`.

### cmd/chat/ — Chat demo (original, embedded pubsub)

- `server/` — HTTP server with gorilla/websocket, SQLite persistence, shared DB, file attachments, UDP multicast announcing for LB discovery, inter-server history sync
- `client/` — Interactive CLI with auto-reconnect, read receipts with timestamps, history replay
- `lb/` — Load balancer with UDP multicast discovery, health checks, WebSocket proxying

### cmd/chat2/ — Chat demo (service package, remote transport)

Server + client + load balancer architecture using the service package with RemoteTransport. Neither server nor client embeds pubsub — both connect to standalone mesh nodes.

- `server/` — Chat service: handles "send" RPC (DM routing), "history" RPC (SQLite-backed, supports streaming and `since` parameter for incremental fetch), persists room messages via middleware. Multiple servers can share the same SQLite DB.
- `client/` — Interactive CLI: rooms, DMs, `/history` (streamed), `/catchup` (fetch missed messages since last seen), auto-reconnect with missed message recovery.
- `lb/` — Load balancer: round-robin HTTP proxying, WebSocket proxying with session tracking, automatic failover on node failure (re-subscribes all topics on new upstream), health checks via `/stats`.

```bash
# 1. Start mesh nodes
go run ./cmd/mesh/node -grpc :9000 -advertise 127.0.0.1:9000 -http :8080
go run ./cmd/mesh/node -grpc :9001 -advertise 127.0.0.1:9001 -http :8081 -seeds 127.0.0.1:9000

# 2. Start load balancer
go run ./cmd/chat2/lb -listen :9090 -nodes http://localhost:8080,http://localhost:8081

# 3. Start chat servers (can share a DB)
go run ./cmd/chat2/server -node http://localhost:9090 -db chat.db -id server-1 -rooms general,random
go run ./cmd/chat2/server -node http://localhost:9090 -db chat.db -id server-2 -rooms general,random

# 4. Connect clients (through LB)
go run ./cmd/chat2/client -node http://localhost:9090 -user alice
go run ./cmd/chat2/client -node http://localhost:9090 -user bob

# Or connect directly to a node (no LB)
go run ./cmd/chat2/client -node http://localhost:8080 -user alice
```

**Client commands:** `hello` (broadcast), `/room <name>`, `/rooms`, `/dm <user> <msg>`, `/history [n]`, `/catchup`, `/quit`

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

### cmd/hashmap/ — Distributed hashmap demo

Interactive CLI for the distributed hashmap. Set/get/delete across nodes.

### File layout within pubsub/

- `node.go` — Node struct, Publish, Subscribe, Forward RPC, mesh management
- `gateway.go` — HTTP/WebSocket gateway with session layer, HistoryProvider interface, topology endpoints (/topics, /peers, /sessions)
- `reqresp.go` — Request/Reply over temporary topics
- `subscriber.go` — Per-subscriber goroutine with FIFO ordering, retry, overflow, DLQ
- `queue.go` — QueueStore interface, MemoryQueue, FileQueue implementations
- `peer.go` — Peer connection wrapper with topic tracking, ephemeral topic bypass
- `stream.go` — Chunked message splitting and reassembly
- `discovery.go` — Kubernetes DNS-based peer discovery
- `ratelimit.go` — Per-key token bucket rate limiter
- `stats.go` — Atomic activity counters
- `message.go` — Message struct and Handler type
- `options.go` — Options struct, Resolver interface, DefaultOptions
- `node_test.go` — 24 tests covering all features

### File layout within service/

- `service.go` — Service, Client, Context, StreamWriter, callStream, middleware
- `transport.go` — Transport interface, Message struct, EmbeddedTransport
- `remote.go` — RemoteTransport (HTTP + WebSocket, auto-reconnect)
- `service_test.go` — 13 tests (RPC, events, DM, cross-node, streaming, middleware)
- `remote_test.go` — 3 tests (remote emit, RPC, direct message)

### Gateway session layer

The gateway maintains client sessions that persist beyond WebSocket disconnects. Sessions are keyed by the `id` query parameter on the `/subscribe` endpoint. When a WebSocket disconnects, the node subscriptions stay alive for the session TTL (default 60s, configurable via `WithSessionTTL`). Reconnecting with the same `id` reattaches to the existing session — no re-subscribe needed. Messages arriving while disconnected are dropped (use catchup/history to recover).

New topology endpoints: `GET /topics` (subscriber counts per topic), `GET /peers` (peer addresses and known topics), `GET /sessions` (active sessions with connection state). The `GET /stats` response now includes `topics`, `peer_count`, and `active_sessions` alongside the existing counters.

### Known issues

- **chat2 WebSocket disconnect**: Clients may occasionally experience WebSocket disconnects. Ping/pong keepalive has been added to prevent idle drops. Auto-reconnect and session resumption handle recovery. Remaining cases need investigation.
- **SSE streaming not yet implemented**: Streaming RPCs still use the temp-topic-based approach. A future `POST /stream` SSE endpoint on the gateway would simplify this.
