# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
make build          # Build all binaries into bin/
make test           # Run all tests
make vet            # Run go vet + build
make clean          # Remove bin/
```

Proto generation (requires protoc + Go gRPC plugins):
```bash
go generate ./pubsub/internal/pb/
```

### Running a local cluster

```bash
make node1          # gRPC :9001, HTTP :8081
make node2          # gRPC :9002, HTTP :8082 (seeds node1)
make node3          # gRPC :9003, HTTP :8083 (seeds node1)
make lb             # HTTP load balancer on :8080
make chat-client    # WebSocket chat client via LB
```

Or use `make demo-nodes` to start 3 nodes + LB in background, `make stop` to kill them.

## Architecture

This is a distributed pub-sub messaging system with a mesh topology. Nodes communicate via gRPC and expose an HTTP/WebSocket API.

### Core packages

- **pubsub/** — Core messaging engine
  - `Node` is the central orchestrator: manages subscriptions, peers, message routing, dedup, rate limiting
  - `Peer` wraps a gRPC client to a remote node; forwards messages and exchanges topic lists
  - `Subscriber` handles per-subscriber delivery with retry (exponential backoff) and overflow queuing → DLQ on exhaustion
  - `Gateway` provides HTTP REST + WebSocket API on top of a Node
  - `Stream` enables bidirectional communication via internal `_stream.<id>` topics
  - `reqresp.go` implements request-response via ephemeral `_reply.<uuid>` topics

- **pubsub/storage/** — Pluggable storage backends (memory ring buffer or SQLite) for overflow queues, DLQ, and deduplication. Interface-driven via `QueueStore`, `DLQStore`, `DeduplicationStore`.

- **pubsub/discovery/** — Peer discovery interface with mDNS and DNS implementations.

- **pubsub/internal/pb/** — Protobuf definitions. gRPC service: `Forward`, `Join`, `Exchange`, `HealthCheck`.

- **service/** — Higher-level microservice abstraction. `Transport` interface wraps a Node (`EmbeddedTransport`). `Service` provides method-based RPC dispatching over pub-sub topics (`svc.<name>`).

- **cmd/node/** — Standalone node binary. Flags: `-id`, `-grpc`, `-http`, `-mdns`, `-seeds`, `-db`.
- **cmd/lb/** — Round-robin HTTP reverse proxy with WebSocket tunneling and health checks.
- **cmd/examples/chat/** — Chat demo (server + WebSocket client).

### Message flow

Publishing: `Node.Publish()` → dedup check → rate limit → deliver to local subscribers (non-blocking channel) → forward to peers with matching topics.

Subscribing: messages land in a buffered channel; overflow spills to persistent queue. Failed deliveries retry with exponential backoff; after max retries, messages go to DLQ.

Peer join: initiator sends `Join` RPC with its topics → responder returns its peer list → both sides exchange topic lists via `Exchange` RPC.

### WebSocket protocol (`/ws`)

JSON commands: `subscribe`, `publish`, `request`, `stream_open`, `stream_data`, `stream_close`. Messages arrive as JSON with `type`, `topic`, `payload` (base64).
