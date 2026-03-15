package pubsub

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"sync"
	"time"

	"distributed-pub-sub/pubsub/discovery"
	"distributed-pub-sub/pubsub/pb"
	"distributed-pub-sub/pubsub/storage"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// PeerInfo holds information about a connected peer node.
type PeerInfo struct {
	NodeID  string
	Address string
	Topics  []string
}

// outboundEntry is a queued message destined for a specific peer.
type outboundEntry struct {
	msg     *Message
	peerID  string
	retries int
}

// Node is the core pub-sub node that manages subscribers, peers, and message routing.
type Node struct {
	pb.UnimplementedPubSubServiceServer

	opts        Options
	stats       Stats
	rateLimiter *RateLimiter

	// Subscribers: map[topic]map[subscriberID]*Subscriber
	subscribers map[string]map[string]*Subscriber
	subMu       sync.RWMutex

	// Peers
	peers        map[string]*Peer   // nodeID -> Peer
	removedPeers map[string]string  // nodeID -> address (for rejoin)
	peerMu       sync.RWMutex

	// TLS config for gRPC connections (nil = insecure)
	tlsConfig *tls.Config

	// Storage
	queueFactory storage.QueueFactory
	dlqStore     storage.DLQStore
	dedupStore   storage.DeduplicationStore
	sqliteStore  *storage.SQLiteStorage // non-nil when using SQLite backend

	// Discovery
	discovery discovery.Discovery

	// gRPC
	grpcServer *grpc.Server

	// Dedup fallback (when no external dedup store)
	memDedup sync.Map

	// Global outbound queue for peer forwarding.
	outbound chan *outboundEntry

	// Service registry: tracks which services are registered on this node
	// and the cluster-wide view from peer broadcasts.
	// localServices: service_name -> set of server_names
	localServices map[string]map[string]bool
	// peerServices: node_id -> service_name -> set of server_names
	peerServices map[string]map[string][]string
	serviceMu    sync.RWMutex

	// Per-topic message history (ring buffer).
	history   map[string][]*Message
	historyMu sync.RWMutex

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

const maxHistoryPerTopic = 100

// NewNode creates a new Node with the given options, initialising storage
// backends (SQLite if DBPath is set, otherwise in-memory) and the rate limiter.
func NewNode(opts Options) *Node {
	if opts.NodeID == "" {
		opts.NodeID = uuid.New().String()
	}
	if opts.GRPCAddress == "" {
		opts.GRPCAddress = ":9000"
	}
	if opts.MaxRetries == 0 {
		opts.MaxRetries = 5
	}
	if opts.RetryBaseDelay == 0 {
		opts.RetryBaseDelay = time.Second
	}
	if opts.RetryMaxDelay == 0 {
		opts.RetryMaxDelay = 30 * time.Second
	}
	if opts.ChannelSize == 0 {
		opts.ChannelSize = 256
	}
	if opts.RateBurst == 0 {
		opts.RateBurst = 10
	}
	if opts.DedupTTL == 0 {
		opts.DedupTTL = time.Hour
	}
	if opts.HealthCheckInterval == 0 {
		opts.HealthCheckInterval = 10 * time.Second
	}
	if opts.MaxHealthFailures == 0 {
		opts.MaxHealthFailures = 3
	}
	if opts.RejoinInterval == 0 {
		opts.RejoinInterval = 30 * time.Second
	}

	ctx, cancel := context.WithCancel(context.Background())

	n := &Node{
		opts:          opts,
		rateLimiter:   NewRateLimiter(opts.RateLimit, opts.RateBurst),
		subscribers:   make(map[string]map[string]*Subscriber),
		peers:         make(map[string]*Peer),
		removedPeers:  make(map[string]string),
		outbound:      make(chan *outboundEntry, opts.ChannelSize),
		localServices: make(map[string]map[string]bool),
		peerServices:  make(map[string]map[string][]string),
		history:       make(map[string][]*Message),
		ctx:           ctx,
		cancel:        cancel,
	}

	// Set up TLS config if cert/key provided.
	if opts.TLSCert != "" {
		tlsCfg, err := loadTLSConfig(opts.TLSCert, opts.TLSKey, opts.TLSCACert)
		if err != nil {
			log.Fatalf("[node %s] failed to load TLS config: %v", opts.NodeID, err)
		}
		n.tlsConfig = tlsCfg
	}

	// Initialise storage backends.
	if opts.DBPath != "" {
		sqlStore, err := storage.OpenSQLite(opts.DBPath)
		if err != nil {
			log.Fatalf("[node %s] failed to open SQLite at %s: %v", opts.NodeID, opts.DBPath, err)
		}
		n.sqliteStore = sqlStore
		n.queueFactory = sqlStore.NewQueueFactory()
		n.dlqStore = sqlStore
		n.dedupStore = sqlStore
	} else {
		n.queueFactory = storage.NewMemoryQueueFactory(opts.ChannelSize)
		n.dlqStore = storage.NewMemoryDLQ()
		n.dedupStore = storage.NewMemoryDedup()
	}

	return n
}

// SetDiscovery sets the discovery implementation to use for peer discovery.
// Must be called before Start.
func (n *Node) SetDiscovery(d discovery.Discovery) {
	n.discovery = d
}

// NodeID returns the node's unique identifier.
func (n *Node) NodeID() string {
	return n.opts.NodeID
}

// Start begins listening on gRPC, starts discovery (if enabled), and connects
// to any configured seed peers.
func (n *Node) Start() error {
	lis, err := net.Listen("tcp", n.opts.GRPCAddress)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", n.opts.GRPCAddress, err)
	}

	var serverOpts []grpc.ServerOption
	if n.tlsConfig != nil {
		serverOpts = append(serverOpts, grpc.Creds(credentials.NewTLS(n.tlsConfig)))
	}
	n.grpcServer = grpc.NewServer(serverOpts...)
	pb.RegisterPubSubServiceServer(n.grpcServer, n)

	// Serve gRPC in a goroutine.
	n.wg.Add(1)
	go func() {
		defer n.wg.Done()
		if err := n.grpcServer.Serve(lis); err != nil {
			log.Printf("[node %s] gRPC server error: %v", n.opts.NodeID, err)
		}
	}()

	log.Printf("[node %s] gRPC listening on %s", n.opts.NodeID, n.opts.GRPCAddress)

	// Start discovery if configured.
	if n.discovery != nil {
		n.startDiscovery()
	}

	// Start the outbound queue worker.
	n.wg.Add(1)
	go n.forwardLoop()

	// Start dedup cleanup worker.
	n.wg.Add(1)
	go n.dedupCleanupLoop()

	// Start peer health check worker.
	n.wg.Add(1)
	go n.healthCheckLoop()

	// Start dead peer rejoin worker.
	n.wg.Add(1)
	go n.rejoinLoop()

	// Subscribe to internal sync topics to receive updates from peers.
	n.Subscribe(topicSync, func(msg *Message) error {
		return n.handleTopicSync(msg)
	})
	n.Subscribe(topicServiceSync, func(msg *Message) error {
		return n.handleServiceSync(msg)
	})

	// Connect to seed peers.
	for _, addr := range n.opts.Seeds {
		if err := n.joinPeer(addr); err != nil {
			log.Printf("[node %s] failed to join seed %s: %v", n.opts.NodeID, addr, err)
		}
	}

	return nil
}

// Stop performs a graceful shutdown: stops discovery, closes peers, stops
// subscribers, stops the gRPC server, and closes storage backends.
func (n *Node) Stop() error {
	n.cancel()

	// Stop discovery.
	if n.discovery != nil {
		if err := n.discovery.Stop(); err != nil {
			log.Printf("[node %s] discovery stop error: %v", n.opts.NodeID, err)
		}
	}

	// Close all peers and clear rejoin list.
	n.peerMu.Lock()
	for id, p := range n.peers {
		p.Close()
		delete(n.peers, id)
	}
	for id := range n.removedPeers {
		delete(n.removedPeers, id)
	}
	n.peerMu.Unlock()

	// Stop all subscribers.
	n.subMu.Lock()
	for topic, subs := range n.subscribers {
		for id, sub := range subs {
			sub.Stop()
			delete(subs, id)
		}
		delete(n.subscribers, topic)
	}
	n.subMu.Unlock()

	// Stop gRPC server.
	if n.grpcServer != nil {
		n.grpcServer.GracefulStop()
	}

	n.wg.Wait()

	// Close storage.
	if n.sqliteStore != nil {
		n.sqliteStore.Close()
	} else {
		if n.dedupStore != nil {
			n.dedupStore.Close()
		}
		if n.dlqStore != nil {
			n.dlqStore.Close()
		}
	}

	return nil
}

// Publish publishes a message: checks dedup, rate limit, delivers locally,
// and forwards to peers with matching topics.
func (n *Node) Publish(msg *Message) error {
	if msg.ID == "" {
		msg.ID = uuid.New().String()
	}
	if msg.Source == "" {
		msg.Source = n.opts.NodeID
	}
	if msg.Timestamp == 0 {
		msg.Timestamp = time.Now().UnixNano()
	}

	// Dedup check.
	if n.isDuplicate(msg.ID) {
		return nil // silently drop duplicates
	}

	// Rate limit check.
	if !n.rateLimiter.Allow(msg.Destination) {
		n.stats.MessagesFailed.Add(1)
		return fmt.Errorf("rate limit exceeded for topic %q", msg.Destination)
	}

	n.stats.MessagesPublished.Add(1)

	// Deliver to local subscribers.
	n.deliverLocal(msg)

	// Forward to peers.
	n.forwardToPeers(n.ctx, msg)

	return nil
}

// Subscribe creates a subscriber for the given topic and starts message
// delivery. Returns the subscriber ID.
func (n *Node) Subscribe(topic string, handler Handler) (string, error) {
	subID := uuid.New().String()

	queue := n.queueFactory(topic, subID)
	sub := NewSubscriber(subID, topic, handler, queue, n.dlqStore, n.opts, &n.stats)

	n.subMu.Lock()
	if n.subscribers[topic] == nil {
		n.subscribers[topic] = make(map[string]*Subscriber)
	}
	n.subscribers[topic][subID] = sub
	n.subMu.Unlock()

	sub.Start()
	n.stats.ActiveSubscribers.Add(1)

	// Broadcast topic change to peers (skip internal topics to avoid loops).
	if len(topic) == 0 || topic[0] != '_' {
		n.broadcastTopics()
	}

	return subID, nil
}

// Unsubscribe stops and removes the subscriber with the given ID.
func (n *Node) Unsubscribe(subscriberID string) error {
	var broadcast bool

	n.subMu.Lock()
	for topic, subs := range n.subscribers {
		if sub, ok := subs[subscriberID]; ok {
			sub.Stop()
			delete(subs, subscriberID)
			if len(subs) == 0 {
				delete(n.subscribers, topic)
				broadcast = true
			}
			n.stats.ActiveSubscribers.Add(-1)
			n.subMu.Unlock()

			if broadcast {
				n.broadcastTopics()
			}
			return nil
		}
	}
	n.subMu.Unlock()

	return fmt.Errorf("subscriber %q not found", subscriberID)
}

// GetStats returns a snapshot of all node statistics.
func (n *Node) GetStats() map[string]int64 {
	return n.stats.Snapshot()
}

// GetPeers returns information about all connected peers.
func (n *Node) GetPeers() []PeerInfo {
	n.peerMu.RLock()
	defer n.peerMu.RUnlock()

	result := make([]PeerInfo, 0, len(n.peers))
	for _, p := range n.peers {
		result = append(result, PeerInfo{
			NodeID:  p.NodeID,
			Address: p.Address,
			Topics:  p.TopicList(),
		})
	}
	return result
}

// DLQStore exposes the dead-letter queue store.
func (n *Node) GetDLQStore() storage.DLQStore {
	return n.dlqStore
}

// ---------------------------------------------------------------------------
// gRPC service implementation (pb.PubSubServiceServer)
// ---------------------------------------------------------------------------

// Forward handles an incoming forwarded message from a peer.
func (n *Node) Forward(ctx context.Context, req *pb.ForwardRequest) (*pb.ForwardResponse, error) {
	msg := &Message{
		ID:          req.GetId(),
		Source:      req.GetSource(),
		Destination: req.GetDestination(),
		Payload:     req.GetPayload(),
		Timestamp:   req.GetTimestamp(),
		Sequence:    req.GetSequence(),
		ReplyTo:     req.GetReplyTo(),
		StreamID:    req.GetStreamId(),
		Attempt:     req.GetAttempt(),
	}

	err := n.Publish(msg)
	if err != nil {
		return &pb.ForwardResponse{Accepted: false}, nil
	}
	return &pb.ForwardResponse{Accepted: true}, nil
}

// Join handles a peer join request. Adds the peer and returns this node's
// information plus known peers.
func (n *Node) Join(ctx context.Context, req *pb.JoinRequest) (*pb.JoinResponse, error) {
	nodeID := req.GetNodeId()
	address := req.GetAddress()

	// Don't add ourselves.
	if nodeID != n.opts.NodeID {
		if err := n.addPeer(nodeID, address); err != nil {
			log.Printf("[node %s] failed to add peer %s: %v", n.opts.NodeID, nodeID, err)
		}
	}

	// Build known peers list.
	n.peerMu.RLock()
	var knownPeers []*pb.PeerInfo
	for _, p := range n.peers {
		if p.NodeID == nodeID {
			continue
		}
		knownPeers = append(knownPeers, &pb.PeerInfo{
			NodeId:  p.NodeID,
			Address: p.Address,
			Topics:  p.TopicList(),
		})
	}
	n.peerMu.RUnlock()

	return &pb.JoinResponse{
		NodeId:  n.opts.NodeID,
		Address: n.opts.GRPCAddress,
		Topics:  n.topics(),
		Peers:   knownPeers,
	}, nil
}

// Exchange handles a topic exchange request. Updates the peer's topics and
// returns this node's topics.
func (n *Node) Exchange(ctx context.Context, req *pb.ExchangeRequest) (*pb.ExchangeResponse, error) {
	nodeID := req.GetNodeId()

	n.peerMu.RLock()
	p, ok := n.peers[nodeID]
	n.peerMu.RUnlock()

	if ok {
		p.UpdateTopics(req.GetTopics())
	}

	return &pb.ExchangeResponse{
		Topics: n.topics(),
	}, nil
}

// HealthCheck returns the node status and ID.
func (n *Node) HealthCheck(ctx context.Context, req *pb.HealthCheckRequest) (*pb.HealthCheckResponse, error) {
	return &pb.HealthCheckResponse{
		Status: "ok",
		NodeId: n.opts.NodeID,
	}, nil
}

// PublishMessage handles an external client publish request via gRPC.
func (n *Node) PublishMessage(ctx context.Context, req *pb.PublishRequest) (*pb.PublishResponse, error) {
	msg := &Message{
		Source:      n.opts.NodeID,
		Destination: req.GetTopic(),
		Payload:     req.GetPayload(),
		ReplyTo:     req.GetReplyTo(),
	}
	if err := n.Publish(msg); err != nil {
		return nil, err
	}
	return &pb.PublishResponse{Id: msg.ID}, nil
}

// SubscribeTopic handles a server-streaming subscription from an external gRPC client.
func (n *Node) SubscribeTopic(req *pb.SubscribeRequest, stream grpc.ServerStreamingServer[pb.SubscribeMessage]) error {
	topic := req.GetTopic()

	subID, err := n.Subscribe(topic, func(msg *Message) error {
		return stream.Send(&pb.SubscribeMessage{
			Id:        msg.ID,
			Source:    msg.Source,
			Topic:     msg.Destination,
			Payload:   msg.Payload,
			Timestamp: msg.Timestamp,
			ReplyTo:   msg.ReplyTo,
			StreamId:  msg.StreamID,
		})
	})
	if err != nil {
		return err
	}
	defer n.Unsubscribe(subID)

	// Block until the client disconnects.
	<-stream.Context().Done()
	return nil
}

// Register handles a server registration request. The server announces its
// service name and server name. The node checks if any peer lacks this service
// and, if so, responds with a redirect to the underserved node.
func (n *Node) Register(ctx context.Context, req *pb.RegisterRequest) (*pb.RegisterResponse, error) {
	serviceName := req.GetServiceName()
	serverName := req.GetServerName()

	// Check if any peer node lacks this service.
	if addr, nodeID := n.findUnservedPeer(serviceName); addr != "" {
		log.Printf("[node %s] redirecting %s/%s to underserved node %s (%s)",
			n.opts.NodeID, serviceName, serverName, nodeID, addr)
		return &pb.RegisterResponse{
			Accepted:        false,
			RedirectAddress: addr,
			RedirectNodeId:  nodeID,
		}, nil
	}

	// Accept registration on this node.
	n.registerService(serviceName, serverName)

	log.Printf("[node %s] registered service %s/%s", n.opts.NodeID, serviceName, serverName)
	return &pb.RegisterResponse{Accepted: true}, nil
}

// Unregister handles a server deregistration request.
func (n *Node) Unregister(ctx context.Context, req *pb.UnregisterRequest) (*pb.UnregisterResponse, error) {
	n.unregisterService(req.GetServiceName(), req.GetServerName())
	log.Printf("[node %s] unregistered service %s/%s", n.opts.NodeID, req.GetServiceName(), req.GetServerName())
	return &pb.UnregisterResponse{Success: true}, nil
}

// registerService adds a server to the local service registry and broadcasts
// the change to peers.
func (n *Node) registerService(serviceName, serverName string) {
	n.serviceMu.Lock()
	if n.localServices[serviceName] == nil {
		n.localServices[serviceName] = make(map[string]bool)
	}
	n.localServices[serviceName][serverName] = true
	n.serviceMu.Unlock()

	n.broadcastServices()
}

// unregisterService removes a server from the local service registry and
// broadcasts the change.
func (n *Node) unregisterService(serviceName, serverName string) {
	n.serviceMu.Lock()
	if servers, ok := n.localServices[serviceName]; ok {
		delete(servers, serverName)
		if len(servers) == 0 {
			delete(n.localServices, serviceName)
		}
	}
	n.serviceMu.Unlock()

	n.broadcastServices()
}

// serviceRegistryPayload is the JSON format for service sync messages.
type serviceRegistryPayload struct {
	NodeID   string              `json:"node_id"`
	Services map[string][]string `json:"services"` // service_name -> [server_names]
}

// broadcastServices publishes this node's service registry to all peers.
func (n *Node) broadcastServices() {
	n.serviceMu.RLock()
	services := make(map[string][]string, len(n.localServices))
	for svc, servers := range n.localServices {
		names := make([]string, 0, len(servers))
		for name := range servers {
			names = append(names, name)
		}
		services[svc] = names
	}
	n.serviceMu.RUnlock()

	payload, err := json.Marshal(serviceRegistryPayload{
		NodeID:   n.opts.NodeID,
		Services: services,
	})
	if err != nil {
		log.Printf("[node %s] failed to marshal service registry: %v", n.opts.NodeID, err)
		return
	}

	n.Publish(&Message{
		Source:      n.opts.NodeID,
		Destination: topicServiceSync,
		Payload:     payload,
	})
}

// handleServiceSync processes an incoming service registry broadcast from a peer.
func (n *Node) handleServiceSync(msg *Message) error {
	if msg.Source == n.opts.NodeID {
		return nil
	}

	var reg serviceRegistryPayload
	if err := json.Unmarshal(msg.Payload, &reg); err != nil {
		log.Printf("[node %s] invalid service sync payload from %s: %v", n.opts.NodeID, msg.Source, err)
		return nil
	}

	n.serviceMu.Lock()
	n.peerServices[reg.NodeID] = reg.Services
	n.serviceMu.Unlock()

	log.Printf("[node %s] updated service registry for peer %s: %v", n.opts.NodeID, reg.NodeID, reg.Services)
	return nil
}

// findUnservedPeer returns the gRPC address and node ID of a peer that has no
// server for the given service. Returns empty strings if all peers are served.
func (n *Node) findUnservedPeer(serviceName string) (address string, nodeID string) {
	n.serviceMu.RLock()
	defer n.serviceMu.RUnlock()

	n.peerMu.RLock()
	defer n.peerMu.RUnlock()

	for id, p := range n.peers {
		peerSvcs, ok := n.peerServices[id]
		if !ok || len(peerSvcs[serviceName]) == 0 {
			return p.Address, id
		}
	}
	return "", ""
}

// GetServices returns the cluster-wide service registry snapshot.
func (n *Node) GetServices() map[string]map[string][]string {
	n.serviceMu.RLock()
	defer n.serviceMu.RUnlock()

	result := make(map[string]map[string][]string)

	// Local services.
	local := make(map[string][]string, len(n.localServices))
	for svc, servers := range n.localServices {
		names := make([]string, 0, len(servers))
		for name := range servers {
			names = append(names, name)
		}
		local[svc] = names
	}
	result[n.opts.NodeID] = local

	// Peer services.
	for nodeID, svcs := range n.peerServices {
		result[nodeID] = svcs
	}

	return result
}

// ---------------------------------------------------------------------------
// Helper methods
// ---------------------------------------------------------------------------

// addPeer creates a new peer connection and exchanges topics.
func (n *Node) addPeer(nodeID, address string) error {
	n.peerMu.Lock()
	if _, exists := n.peers[nodeID]; exists {
		n.peerMu.Unlock()
		return nil // already connected
	}

	p := NewPeer(nodeID, address)
	p.tlsConfig = n.tlsConfig
	n.peers[nodeID] = p
	n.peerMu.Unlock()

	if err := p.Connect(n.ctx); err != nil {
		n.peerMu.Lock()
		delete(n.peers, nodeID)
		n.peerMu.Unlock()
		return fmt.Errorf("failed to connect to peer %s at %s: %w", nodeID, address, err)
	}

	n.stats.ConnectedPeers.Add(1)

	// Ensure the peer receives sync broadcasts. The initial topic exchange
	// seeds the peer with its current topics; future changes arrive via the
	// sync topic.
	remoteTopics, err := p.Exchange(n.ctx, n.opts.NodeID, n.topics())
	if err != nil {
		log.Printf("[node %s] topic exchange with %s failed: %v", n.opts.NodeID, nodeID, err)
	} else {
		remoteTopics = append(remoteTopics, topicSync)
		p.UpdateTopics(remoteTopics)
	}

	return nil
}

// deliverLocal delivers a message to all local subscribers matching the topic.
func (n *Node) deliverLocal(msg *Message) {
	// Record in history (skip internal topics).
	topic := msg.Destination
	if len(topic) == 0 || topic[0] != '_' {
		n.historyMu.Lock()
		h := n.history[topic]
		h = append(h, msg)
		if len(h) > maxHistoryPerTopic {
			h = h[len(h)-maxHistoryPerTopic:]
		}
		n.history[topic] = h
		n.historyMu.Unlock()
	}

	n.subMu.RLock()
	subs, ok := n.subscribers[msg.Destination]
	if !ok {
		n.subMu.RUnlock()
		return
	}

	// Copy subscriber references under lock, deliver outside.
	targets := make([]*Subscriber, 0, len(subs))
	for _, sub := range subs {
		targets = append(targets, sub)
	}
	n.subMu.RUnlock()

	for _, sub := range targets {
		sub.Deliver(msg)
	}
}

// History returns the last N messages for the given topic.
func (n *Node) History(topic string, limit int) []*Message {
	n.historyMu.RLock()
	defer n.historyMu.RUnlock()

	h := n.history[topic]
	if limit <= 0 || limit > len(h) {
		limit = len(h)
	}
	out := make([]*Message, limit)
	copy(out, h[len(h)-limit:])
	return out
}

// forwardToPeers enqueues a message for delivery to all matching peers.
// Messages on the internal sync topic are enqueued for all peers.
func (n *Node) forwardToPeers(_ context.Context, msg *Message) {
	broadcastAll := msg.Destination == topicSync || msg.Destination == topicServiceSync

	n.peerMu.RLock()
	for _, p := range n.peers {
		if broadcastAll || p.HasTopic(msg.Destination) {
			select {
			case n.outbound <- &outboundEntry{msg: msg, peerID: p.NodeID}:
			default:
				log.Printf("[node %s] outbound queue full, dropping message %s for peer %s",
					n.opts.NodeID, msg.ID, p.NodeID)
				n.stats.MessagesFailed.Add(1)
			}
		}
	}
	n.peerMu.RUnlock()
}

// forwardLoop is the background worker that drains the global outbound queue
// and forwards messages to peers. Failed deliveries are re-enqueued with
// exponential backoff up to MaxRetries.
func (n *Node) forwardLoop() {
	defer n.wg.Done()

	for {
		select {
		case <-n.ctx.Done():
			return
		case entry := <-n.outbound:
			n.peerMu.RLock()
			p, ok := n.peers[entry.peerID]
			n.peerMu.RUnlock()

			if !ok {
				// Peer gone, drop the message.
				continue
			}

			if err := p.Forward(n.ctx, entry.msg); err != nil {
				entry.retries++
				if entry.retries <= n.opts.MaxRetries {
					// Re-enqueue with backoff in a goroutine to avoid blocking the worker.
					delay := n.opts.RetryBaseDelay * time.Duration(1<<(entry.retries-1))
					if delay > n.opts.RetryMaxDelay {
						delay = n.opts.RetryMaxDelay
					}
					go func(e *outboundEntry, d time.Duration) {
						select {
						case <-n.ctx.Done():
						case <-time.After(d):
							select {
							case n.outbound <- e:
							default:
								log.Printf("[node %s] outbound queue full on retry, dropping message %s for peer %s",
									n.opts.NodeID, e.msg.ID, e.peerID)
							}
						}
					}(entry, delay)
				} else {
					log.Printf("[node %s] dropping message %s for peer %s after %d retries: %v",
						n.opts.NodeID, entry.msg.ID, entry.peerID, entry.retries, err)
					n.stats.MessagesFailed.Add(1)
				}
			} else {
				n.stats.MessagesForwarded.Add(1)
			}
		}
	}
}

// dedupCleanupLoop periodically removes expired entries from the dedup store
// and the in-memory fallback map.
func (n *Node) dedupCleanupLoop() {
	defer n.wg.Done()
	interval := n.opts.DedupTTL / 2
	if interval < time.Minute {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-n.ctx.Done():
			return
		case <-ticker.C:
			if err := n.dedupStore.Cleanup(n.opts.DedupTTL); err != nil {
				log.Printf("[node %s] dedup cleanup error: %v", n.opts.NodeID, err)
			}
			// Also prune the in-memory fallback map.
			cutoff := time.Now().Add(-n.opts.DedupTTL)
			n.memDedup.Range(func(key, value any) bool {
				if t, ok := value.(time.Time); ok && t.Before(cutoff) {
					n.memDedup.Delete(key)
				}
				return true
			})
		}
	}
}

// isDuplicate checks whether a message ID has already been seen.
func (n *Node) isDuplicate(messageID string) bool {
	if n.dedupStore != nil {
		seen, err := n.dedupStore.MarkSeen(messageID)
		if err != nil {
			log.Printf("[node %s] dedup store error: %v", n.opts.NodeID, err)
			// Fall through to memDedup.
		} else {
			return seen
		}
	}

	// Fallback: use sync.Map based dedup.
	_, loaded := n.memDedup.LoadOrStore(messageID, time.Now())
	return loaded
}

// Topics returns a list of all non-internal topics this node has subscribers for.
func (n *Node) Topics() []string {
	n.subMu.RLock()
	defer n.subMu.RUnlock()

	result := make([]string, 0, len(n.subscribers))
	for topic := range n.subscribers {
		if len(topic) > 0 && topic[0] != '_' {
			result = append(result, topic)
		}
	}
	return result
}

// topics returns a list of all topics this node is subscribed to.
func (n *Node) topics() []string {
	n.subMu.RLock()
	defer n.subMu.RUnlock()

	result := make([]string, 0, len(n.subscribers))
	for topic := range n.subscribers {
		result = append(result, topic)
	}
	return result
}

// startDiscovery starts the discovery service and connects to discovered peers.
func (n *Node) startDiscovery() {
	ch, err := n.discovery.Start(n.ctx, n.opts.GRPCAddress)
	if err != nil {
		log.Printf("[node %s] failed to start discovery: %v", n.opts.NodeID, err)
		return
	}

	n.wg.Add(1)
	go func() {
		defer n.wg.Done()
		for {
			select {
			case <-n.ctx.Done():
				return
			case addr, ok := <-ch:
				if !ok {
					return
				}
				if err := n.joinPeer(addr); err != nil {
					log.Printf("[node %s] failed to join discovered peer %s: %v", n.opts.NodeID, addr, err)
				}
			}
		}
	}()
}

// broadcastTopics publishes this node's current topic list to the internal
// sync topic so that all peers learn about subscription changes.
func (n *Node) broadcastTopics() {
	topics := n.topics()

	// Filter out internal topics (those starting with '_').
	filtered := make([]string, 0, len(topics))
	for _, t := range topics {
		if len(t) > 0 && t[0] != '_' {
			filtered = append(filtered, t)
		}
	}

	payload, err := json.Marshal(filtered)
	if err != nil {
		log.Printf("[node %s] failed to marshal topics for sync: %v", n.opts.NodeID, err)
		return
	}

	n.Publish(&Message{
		Source:      n.opts.NodeID,
		Destination: topicSync,
		Payload:     payload,
	})
}

// handleTopicSync processes an incoming topic sync message from a peer and
// updates that peer's topic set.
func (n *Node) handleTopicSync(msg *Message) error {
	// Ignore our own broadcasts.
	if msg.Source == n.opts.NodeID {
		return nil
	}

	var topics []string
	if err := json.Unmarshal(msg.Payload, &topics); err != nil {
		log.Printf("[node %s] invalid topic sync payload from %s: %v", n.opts.NodeID, msg.Source, err)
		return nil
	}

	// Always include the sync topic itself so future broadcasts reach the peer.
	topics = append(topics, topicSync)

	n.peerMu.RLock()
	p, ok := n.peers[msg.Source]
	n.peerMu.RUnlock()

	if ok {
		p.UpdateTopics(topics)
		log.Printf("[node %s] updated topics for peer %s: %v", n.opts.NodeID, msg.Source, topics)
	}

	return nil
}

// removePeer disconnects and removes a peer, storing its address for rejoin
// attempts, and cleaning up its service registry.
func (n *Node) removePeer(nodeID string) {
	n.peerMu.Lock()
	p, ok := n.peers[nodeID]
	if ok {
		n.removedPeers[nodeID] = p.Address
		delete(n.peers, nodeID)
	}
	n.peerMu.Unlock()

	if ok {
		p.Close()
		n.stats.ConnectedPeers.Add(-1)
		log.Printf("[node %s] removed dead peer %s (will attempt rejoin)", n.opts.NodeID, nodeID)
	}

	n.serviceMu.Lock()
	delete(n.peerServices, nodeID)
	n.serviceMu.Unlock()
}

// healthCheckLoop periodically pings all peers and removes those that fail
// MaxHealthFailures consecutive checks.
func (n *Node) healthCheckLoop() {
	defer n.wg.Done()
	ticker := time.NewTicker(n.opts.HealthCheckInterval)
	defer ticker.Stop()

	failures := make(map[string]int)

	for {
		select {
		case <-n.ctx.Done():
			return
		case <-ticker.C:
			n.peerMu.RLock()
			peers := make([]*Peer, 0, len(n.peers))
			for _, p := range n.peers {
				peers = append(peers, p)
			}
			n.peerMu.RUnlock()

			for _, p := range peers {
				ctx, cancel := context.WithTimeout(n.ctx, 5*time.Second)
				err := p.HealthCheck(ctx)
				cancel()

				if err != nil {
					failures[p.NodeID]++
					if failures[p.NodeID] >= n.opts.MaxHealthFailures {
						n.removePeer(p.NodeID)
						delete(failures, p.NodeID)
					}
				} else {
					delete(failures, p.NodeID)
				}
			}
		}
	}
}

// joinPeer sends a Join RPC to the given address and adds any returned peers.
func (n *Node) joinPeer(address string) error {
	var dialCreds grpc.DialOption
	if n.tlsConfig != nil {
		dialCreds = grpc.WithTransportCredentials(credentials.NewTLS(n.tlsConfig))
	} else {
		dialCreds = grpc.WithTransportCredentials(insecure.NewCredentials())
	}
	conn, err := grpc.NewClient(address, dialCreds)
	if err != nil {
		return fmt.Errorf("dial %s: %w", address, err)
	}
	defer conn.Close()

	client := pb.NewPubSubServiceClient(conn)

	ctx, cancel := context.WithTimeout(n.ctx, 5*time.Second)
	defer cancel()

	resp, err := client.Join(ctx, &pb.JoinRequest{
		NodeId:  n.opts.NodeID,
		Address: n.opts.GRPCAddress,
		Topics:  n.topics(),
	})
	if err != nil {
		return fmt.Errorf("join RPC to %s: %w", address, err)
	}

	// Add the responding node as a peer.
	if resp.GetNodeId() != n.opts.NodeID {
		if err := n.addPeer(resp.GetNodeId(), resp.GetAddress()); err != nil {
			log.Printf("[node %s] failed to add responding peer %s: %v", n.opts.NodeID, resp.GetNodeId(), err)
		}
	}

	// Add any additional peers returned.
	for _, pi := range resp.GetPeers() {
		if pi.GetNodeId() == n.opts.NodeID {
			continue
		}
		if err := n.addPeer(pi.GetNodeId(), pi.GetAddress()); err != nil {
			log.Printf("[node %s] failed to add peer %s from join response: %v", n.opts.NodeID, pi.GetNodeId(), err)
		}
	}

	return nil
}

// rejoinLoop periodically attempts to reconnect to dead peers that were
// previously removed by the health check loop.
func (n *Node) rejoinLoop() {
	defer n.wg.Done()
	ticker := time.NewTicker(n.opts.RejoinInterval)
	defer ticker.Stop()

	for {
		select {
		case <-n.ctx.Done():
			return
		case <-ticker.C:
			n.peerMu.RLock()
			candidates := make(map[string]string, len(n.removedPeers))
			for id, addr := range n.removedPeers {
				candidates[id] = addr
			}
			n.peerMu.RUnlock()

			for id, addr := range candidates {
				if err := n.joinPeer(addr); err != nil {
					log.Printf("[node %s] rejoin attempt to %s (%s) failed: %v", n.opts.NodeID, id, addr, err)
					continue
				}
				n.peerMu.Lock()
				delete(n.removedPeers, id)
				n.peerMu.Unlock()
				log.Printf("[node %s] successfully rejoined peer %s at %s", n.opts.NodeID, id, addr)
			}
		}
	}
}

// loadTLSConfig creates a tls.Config from certificate files.
func loadTLSConfig(certFile, keyFile, caFile string) (*tls.Config, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load key pair: %w", err)
	}

	tlsCfg := &tls.Config{
		Certificates: []tls.Certificate{cert},
	}

	if caFile != "" {
		caCert, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("read CA cert: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caCert) {
			return nil, fmt.Errorf("failed to parse CA cert")
		}
		tlsCfg.RootCAs = pool
		tlsCfg.ClientCAs = pool
		tlsCfg.ClientAuth = tls.VerifyClientCertIfGiven
	}

	return tlsCfg, nil
}
