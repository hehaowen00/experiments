.PHONY: build clean node1 node2 node3 lb \
       chat-server1 chat-server2 chat-server3 \
       chat-client1 chat-client2 chat-client3 \
       kv1 kv2 kv3 \
       demo-nodes demo-chat stop \
       kill-node1 kill-node2 kill-node3 kill-lb \
       kill-servers kill-clients kill

# Build all binaries
BIN := bin
GOFLAGS := -trimpath

build:
	go build $(GOFLAGS) -o $(BIN)/node       ./cmd/node
	go build $(GOFLAGS) -o $(BIN)/lb         ./cmd/lb
	go build $(GOFLAGS) -o $(BIN)/chat-server ./cmd/examples/chat/server
	go build $(GOFLAGS) -o $(BIN)/chat-client ./cmd/examples/chat/client
	go build $(GOFLAGS) -o $(BIN)/kv         ./cmd/examples/kv
	go build $(GOFLAGS) -o $(BIN)/auth       ./cmd/examples/auth

clean:
	rm -rf $(BIN)

# --- Nodes ---

node1: build
	$(BIN)/node -id node1 -grpc :9001 -http :8081 -mdns=false

node2: build
	$(BIN)/node -id node2 -grpc :9002 -http :8082 -mdns=false -seeds localhost:9001

node3: build
	$(BIN)/node -id node3 -grpc :9003 -http :8083 -mdns=false -seeds localhost:9001

lb: build
	$(BIN)/lb -addr :8080 -nodes localhost:8081,localhost:8082,localhost:8083

# --- Chat servers (one per node) ---

chat-server1: build
	$(BIN)/chat-server -nodes localhost:9001 -room chat -name server1

chat-server2: build
	$(BIN)/chat-server -nodes localhost:9002 -room chat -name server2

chat-server3: build
	$(BIN)/chat-server -nodes localhost:9003 -room chat -name server3

# --- Chat clients (each via a different node's HTTP port) ---

chat-client1: build
	$(BIN)/chat-client -node localhost:8081 -room chat

chat-client2: build
	$(BIN)/chat-client -node localhost:8082 -room chat

chat-client3: build
	$(BIN)/chat-client -node localhost:8083 -room chat

# Client via load balancer
chat-client: build
	$(BIN)/chat-client -lb localhost:8080 -room chat

# --- KV cache nodes ---

kv1: build
	$(BIN)/kv -id kv1 -grpc :9001 -http :8081 -mdns=false

kv2: build
	$(BIN)/kv -id kv2 -grpc :9002 -http :8082 -mdns=false -seeds localhost:9001

kv3: build
	$(BIN)/kv -id kv3 -grpc :9003 -http :8083 -mdns=false -seeds localhost:9001

# --- Demo: all-in-one (background processes) ---

demo-nodes: build
	@echo "Starting 3-node cluster + load balancer..."
	@$(BIN)/node -id node1 -grpc :9001 -http :8081 -mdns=false &
	@sleep 1
	@$(BIN)/node -id node2 -grpc :9002 -http :8082 -mdns=false -seeds localhost:9001 &
	@$(BIN)/node -id node3 -grpc :9003 -http :8083 -mdns=false -seeds localhost:9001 &
	@sleep 1
	@$(BIN)/lb -addr :8080 -nodes localhost:8081,localhost:8082,localhost:8083 &
	@sleep 1
	@echo ""
	@echo "Cluster is running:"
	@echo "  node1  gRPC=:9001  HTTP=:8081"
	@echo "  node2  gRPC=:9002  HTTP=:8082"
	@echo "  node3  gRPC=:9003  HTTP=:8083"
	@echo "  LB     HTTP=:8080"
	@echo ""
	@echo "Chat servers:  make chat-server1  (or chat-server2, chat-server3)"
	@echo "Chat clients:  make chat-client1  (or chat-client2, chat-client3, chat-client)"
	@echo "Stop all:      make stop"

demo-chat: build demo-nodes
	@echo ""
	@echo "Start chat servers and clients in separate terminals:"
	@echo "  make chat-server1    make chat-server2    make chat-server3"
	@echo "  make chat-client1    make chat-client2    make chat-client3"
	@echo ""
	@echo "Stop: make stop"

# --- Kill individual components ---

kill-node1:
	@echo "Killing node1..."
	@-pkill -f "$(BIN)/node -id node1" 2>/dev/null || echo "node1 not found"

kill-node2:
	@echo "Killing node2..."
	@-pkill -f "$(BIN)/node -id node2" 2>/dev/null || echo "node2 not found"

kill-node3:
	@echo "Killing node3..."
	@-pkill -f "$(BIN)/node -id node3" 2>/dev/null || echo "node3 not found"

kill-lb:
	@echo "Killing load balancer..."
	@-pkill -f "$(BIN)/lb" 2>/dev/null || echo "lb not found"

kill-servers:
	@echo "Killing all chat servers..."
	@-pkill -f "$(BIN)/chat-server" 2>/dev/null || echo "no chat servers found"

kill-clients:
	@echo "Killing all chat clients..."
	@-pkill -f "$(BIN)/chat-client" 2>/dev/null || echo "no chat clients found"

# Kill a specific node by name: make kill NODE=node1
kill:
	@if [ -z "$(NODE)" ]; then echo "Usage: make kill NODE=<node-id>"; exit 1; fi
	@echo "Killing $(NODE)..."
	@-pkill -f "$(BIN)/node -id $(NODE)" 2>/dev/null || echo "$(NODE) not found"

# Stop everything
stop:
	@echo "Stopping all demo processes..."
	@-pkill -f "$(BIN)/node" 2>/dev/null || true
	@-pkill -f "$(BIN)/lb" 2>/dev/null || true
	@-pkill -f "$(BIN)/chat-server" 2>/dev/null || true
	@-pkill -f "$(BIN)/chat-client" 2>/dev/null || true
	@echo "Done."

# --- Utilities ---

health:
	@curl -s localhost:8080/health | python3 -m json.tool

services:
	@echo "=== Node 1 ==="
	@curl -s localhost:8081/services | python3 -m json.tool
	@echo "=== Node 2 ==="
	@curl -s localhost:8082/services | python3 -m json.tool
	@echo "=== Node 3 ==="
	@curl -s localhost:8083/services | python3 -m json.tool

publish:
	@curl -s -X POST localhost:8080/publish \
		-H 'Content-Type: application/json' \
		-d '{"topic":"chat","payload":"'$$(echo -n "hello from curl" | base64)'"}' \
		| python3 -m json.tool

test:
	go test ./... -v -count=1

vet:
	go vet ./...
	go build ./...
