package pubsub

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"sync"
	"sync/atomic"
	"time"

	pb "distributed-pub-sub/pubsub/internal/pb"

	"github.com/google/uuid"
	"google.golang.org/grpc"
)

type Node struct {
	opts Options

	mu          sync.RWMutex
	subscribers map[string]map[string]*subscriber // topic -> subID -> sub
	peers       map[string]*peer                  // addr -> peer

	sequences sync.Map // source (string) -> *atomic.Uint64
	seen      sync.Map // messageID (string) -> time.Time

	grpcServer *grpc.Server

	ctx    context.Context
	cancel context.CancelFunc

	stats     Stats
	limiter   *rateLimiter // nil when rate limiting is disabled
	assembler *streamAssembler
	inflight  sync.WaitGroup
	draining  atomic.Bool

	pb.UnimplementedInternalServer
}

func New(opts Options) (*Node, error) {
	if opts.ID == "" {
		opts.ID = uuid.New().String()
	}
	if opts.ListenAddr == "" {
		opts.ListenAddr = ":9000"
	}
	if opts.AdvertiseAddr == "" {
		return nil, fmt.Errorf("AdvertiseAddr is required")
	}
	if opts.BufferSize == 0 {
		opts.BufferSize = 64
	}
	if opts.MaxRetries == 0 {
		opts.MaxRetries = 3
	}
	if opts.RetryInterval == 0 {
		opts.RetryInterval = time.Second
	}
	if opts.ExchangeInterval == 0 {
		opts.ExchangeInterval = 5 * time.Second
	}
	if opts.DNSDiscovery != "" && opts.DNSDiscoveryPort == "" {
		return nil, fmt.Errorf("DNSDiscoveryPort is required when DNSDiscovery is set")
	}
	if opts.DNSDiscovery != "" && opts.DNSDiscoveryInterval == 0 {
		opts.DNSDiscoveryInterval = 10 * time.Second
	}
	if opts.DNSDiscovery != "" && opts.Resolver == nil {
		opts.Resolver = net.DefaultResolver
	}
	if opts.PublishRate > 0 && opts.PublishBurst == 0 {
		opts.PublishBurst = 10
	}
	if opts.DrainTimeout == 0 {
		opts.DrainTimeout = 5 * time.Second
	}

	var limiter *rateLimiter
	if opts.PublishRate > 0 {
		limiter = newRateLimiter(opts.PublishRate, opts.PublishBurst)
	}

	return &Node{
		opts:        opts,
		subscribers: make(map[string]map[string]*subscriber),
		peers:       make(map[string]*peer),
		limiter:     limiter,
		assembler:   newStreamAssembler(),
	}, nil
}

// ID returns this node's unique identifier.
func (n *Node) ID() string { return n.opts.ID }

// Stats returns the node's activity counters.
func (n *Node) Stats() StatsSnapshot { return n.stats.Snapshot() }

func (n *Node) Start(ctx context.Context) error {
	n.ctx, n.cancel = context.WithCancel(ctx)

	lis, err := net.Listen("tcp", n.opts.ListenAddr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}

	n.grpcServer = grpc.NewServer()
	pb.RegisterInternalServer(n.grpcServer, n)

	go func() {
		if err := n.grpcServer.Serve(lis); err != nil {
			log.Printf("grpc server error: %v", err)
		}
	}()

	// Bootstrap from seed nodes
	for _, addr := range n.opts.Seeds {
		if addr == n.opts.AdvertiseAddr {
			continue
		}
		if err := n.joinViaSeed(addr); err != nil {
			log.Printf("seed %s unreachable: %v", addr, err)
		}
	}

	go n.exchangeLoop()
	go n.cleanupSeen()
	if n.opts.DNSDiscovery != "" {
		go n.dnsDiscoveryLoop()
	}

	return nil
}

func (n *Node) Stop() error {
	// Phase 1: stop accepting new publishes
	n.draining.Store(true)

	// Phase 2: wait for in-flight forwards to complete (with timeout)
	done := make(chan struct{})
	go func() {
		n.inflight.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(n.opts.DrainTimeout):
		log.Printf("drain timeout after %v, proceeding with shutdown", n.opts.DrainTimeout)
	}

	// Phase 3: cancel context (stops exchange loop, cleanup loop, subscriber goroutines)
	n.cancel()

	// Phase 4: let subscribers drain their buffers
	n.mu.RLock()
	var allSubs []*subscriber
	for _, subs := range n.subscribers {
		for _, s := range subs {
			allSubs = append(allSubs, s)
		}
	}
	n.mu.RUnlock()
	for _, s := range allSubs {
		s.drain()
	}

	// Phase 5: stop gRPC and close peers
	if n.grpcServer != nil {
		n.grpcServer.GracefulStop()
	}

	n.mu.Lock()
	for _, p := range n.peers {
		p.close()
	}
	for _, subs := range n.subscribers {
		for _, s := range subs {
			s.stop()
		}
	}
	n.mu.Unlock()

	return nil
}

// Publish sends a message to all subscribers of the given topic across the mesh.
// Returns the message ID. Delivery to local subscribers and forwarding to peers
// happens asynchronously with retries.
func (n *Node) Publish(ctx context.Context, source, topic string, payload json.RawMessage) (string, error) {
	if n.draining.Load() {
		return "", fmt.Errorf("node is draining")
	}
	if n.limiter != nil && !n.limiter.allow(source) {
		n.stats.RateLimited.Add(1)
		return "", fmt.Errorf("rate limit exceeded for source %s", source)
	}

	seq := n.nextSequence(source)
	msg := &Message{
		ID:          uuid.New().String(),
		Source:      source,
		Destination: topic,
		Payload:     payload,
		Timestamp:   time.Now().UnixMilli(),
		Sequence:    seq,
		OriginNode:  n.opts.ID,
	}

	n.seen.Store(msg.ID, time.Now())
	n.stats.Published.Add(1)
	n.deliverLocal(msg)

	n.inflight.Add(1)
	go func() {
		defer n.inflight.Done()
		n.forwardToPeers(msg)
	}()

	return msg.ID, nil
}

// Subscribe registers a handler for a topic. The subscriberID should uniquely
// identify this subscriber (e.g. a user ID). The handler is called for each
// message — return nil to ack, return error to retry delivery.
func (n *Node) Subscribe(topic, subscriberID string, handler Handler) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.subscribers[topic] == nil {
		n.subscribers[topic] = make(map[string]*subscriber)
	}
	if _, exists := n.subscribers[topic][subscriberID]; exists {
		return fmt.Errorf("subscriber %s already exists on topic %s", subscriberID, topic)
	}

	// Build DLQ callback: republish failed messages to _dlq.<topic>
	var dlq func(*Message)
	if n.opts.EnableDLQ {
		dlqTopic := "_dlq." + topic
		dlq = func(msg *Message) {
			n.Publish(context.Background(), msg.Source, dlqTopic, msg.Payload)
		}
	}

	s := newSubscriber(subscriberID, topic, handler, n.opts, &n.stats, dlq)
	n.subscribers[topic][subscriberID] = s
	go s.run(n.ctx)

	return nil
}

// Unsubscribe removes a subscriber from a topic.
func (n *Node) Unsubscribe(topic, subscriberID string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	subs, ok := n.subscribers[topic]
	if !ok {
		return fmt.Errorf("topic %s not found", topic)
	}
	s, ok := subs[subscriberID]
	if !ok {
		return fmt.Errorf("subscriber %s not found on topic %s", subscriberID, topic)
	}

	s.stop()
	delete(subs, subscriberID)
	if len(subs) == 0 {
		delete(n.subscribers, topic)
	}

	return nil
}

// AddPeer manually adds a peer by address. Useful for testing or static config.
func (n *Node) AddPeer(addr string) error {
	return n.addPeer(addr)
}

func (n *Node) deliverLocal(msg *Message) {
	n.mu.RLock()
	subs, ok := n.subscribers[msg.Destination]
	if !ok {
		n.mu.RUnlock()
		return
	}
	targets := make([]*subscriber, 0, len(subs))
	for _, s := range subs {
		targets = append(targets, s)
	}
	n.mu.RUnlock()

	for _, s := range targets {
		s.enqueue(msg)
	}
}

func (n *Node) forwardToPeers(msg *Message) {
	n.mu.RLock()
	peers := make([]*peer, 0, len(n.peers))
	for _, p := range n.peers {
		if p.hasTopic(msg.Destination) {
			peers = append(peers, p)
		}
	}
	n.mu.RUnlock()

	// Check if payload needs chunking
	if n.opts.MaxMessageSize > 0 && len(msg.Payload) > n.opts.MaxMessageSize {
		n.forwardChunked(peers, msg)
		return
	}

	for _, p := range peers {
		go n.forwardWithRetry(p, msg)
	}
}

func (n *Node) forwardChunked(peers []*peer, msg *Message) {
	chunks := splitPayload(msg.Payload, n.opts.MaxMessageSize)
	streamID := uuid.New().String()
	total := uint32(len(chunks))

	for i, chunk := range chunks {
		chunkMsg := &Message{
			ID:          uuid.New().String(),
			Source:      msg.Source,
			Destination: msg.Destination,
			Payload:     chunk,
			Timestamp:   msg.Timestamp,
			Sequence:    msg.Sequence,
			OriginNode:  msg.OriginNode,
			ReplyTo:     msg.ReplyTo,
			StreamID:    streamID,
			ChunkIndex:  uint32(i),
			TotalChunks: total,
		}
		n.seen.Store(chunkMsg.ID, time.Now())
		for _, p := range peers {
			go n.forwardWithRetry(p, chunkMsg)
		}
	}
}

func (n *Node) forwardWithRetry(p *peer, msg *Message) {
	req := &pb.ForwardRequest{
		Id:          msg.ID,
		Source:      msg.Source,
		Destination: msg.Destination,
		Payload:     msg.Payload,
		Timestamp:   msg.Timestamp,
		Sequence:    msg.Sequence,
		OriginNode:  msg.OriginNode,
		ReplyTo:     msg.ReplyTo,
		StreamId:    msg.StreamID,
		ChunkIndex:  msg.ChunkIndex,
		TotalChunks: msg.TotalChunks,
	}

	for attempt := 0; attempt <= n.opts.MaxRetries; attempt++ {
		ctx, cancel := context.WithTimeout(n.ctx, 5*time.Second)
		_, err := p.client.Forward(ctx, req)
		cancel()
		if err == nil {
			n.stats.Forwarded.Add(1)
			return
		}
		log.Printf("forward to %s attempt %d failed: %v", p.addr, attempt+1, err)
		if attempt < n.opts.MaxRetries {
			time.Sleep(n.opts.RetryInterval)
		}
	}
	n.stats.ForwardsFailed.Add(1)
	log.Printf("forward to %s failed after %d attempts, message %s dropped", p.addr, n.opts.MaxRetries+1, msg.ID)
}

// Forward implements the gRPC Internal service — called by peers.
func (n *Node) Forward(ctx context.Context, req *pb.ForwardRequest) (*pb.ForwardResponse, error) {
	if _, loaded := n.seen.LoadOrStore(req.Id, time.Now()); loaded {
		n.stats.Deduplicated.Add(1)
		return &pb.ForwardResponse{MessageId: req.Id, Accepted: true}, nil
	}
	n.stats.Received.Add(1)

	// Chunked message — buffer until all parts arrive
	if req.StreamId != "" {
		template := &Message{
			Source:      req.Source,
			Destination: req.Destination,
			Timestamp:   req.Timestamp,
			Sequence:    req.Sequence,
			OriginNode:  req.OriginNode,
			ReplyTo:     req.ReplyTo,
		}
		payload := n.assembler.addChunk(req.StreamId, req.ChunkIndex, req.TotalChunks, req.Payload, template)
		if payload == nil {
			// Still waiting for more chunks
			return &pb.ForwardResponse{MessageId: req.Id, Accepted: true}, nil
		}
		// All chunks received — deliver the reassembled message
		msg := &Message{
			ID:          req.StreamId, // use stream ID as the logical message ID
			Source:      template.Source,
			Destination: template.Destination,
			Payload:     payload,
			Timestamp:   template.Timestamp,
			Sequence:    template.Sequence,
			OriginNode:  template.OriginNode,
			ReplyTo:     template.ReplyTo,
		}
		n.deliverLocal(msg)
		return &pb.ForwardResponse{MessageId: req.Id, Accepted: true}, nil
	}

	msg := &Message{
		ID:          req.Id,
		Source:      req.Source,
		Destination: req.Destination,
		Payload:     req.Payload,
		Timestamp:   req.Timestamp,
		Sequence:    req.Sequence,
		OriginNode:  req.OriginNode,
		ReplyTo:     req.ReplyTo,
	}

	n.deliverLocal(msg)

	return &pb.ForwardResponse{MessageId: req.Id, Accepted: true}, nil
}

// Join implements the gRPC Internal service — called by new nodes joining the mesh.
func (n *Node) Join(ctx context.Context, req *pb.JoinRequest) (*pb.JoinResponse, error) {
	// Add the joining node as a peer
	if req.Addr != n.opts.AdvertiseAddr {
		if err := n.addPeer(req.Addr); err != nil {
			log.Printf("failed to add joining peer %s: %v", req.Addr, err)
		}
	}

	// Return our known peer list
	return &pb.JoinResponse{Peers: n.peerAddrs()}, nil
}

// Exchange implements the gRPC Internal service — periodic peer list sync.
func (n *Node) Exchange(ctx context.Context, req *pb.ExchangeRequest) (*pb.ExchangeResponse, error) {
	// Merge any peers we don't know about
	for _, addr := range req.Peers {
		if addr == n.opts.AdvertiseAddr {
			continue
		}
		_ = n.addPeer(addr)
	}

	// Update the calling peer's topic subscriptions
	if req.Addr != "" {
		n.mu.RLock()
		if p, ok := n.peers[req.Addr]; ok {
			p.setTopics(req.Topics)
		}
		n.mu.RUnlock()
	}

	return &pb.ExchangeResponse{
		Peers:  n.peerAddrs(),
		Topics: n.localTopics(),
	}, nil
}

func (n *Node) joinViaSeed(addr string) error {
	if err := n.addPeer(addr); err != nil {
		return err
	}

	n.mu.RLock()
	p, ok := n.peers[addr]
	n.mu.RUnlock()
	if !ok {
		return fmt.Errorf("peer %s not found after add", addr)
	}

	ctx, cancel := context.WithTimeout(n.ctx, 5*time.Second)
	defer cancel()

	resp, err := p.client.Join(ctx, &pb.JoinRequest{
		NodeId: n.opts.ID,
		Addr:   n.opts.AdvertiseAddr,
	})
	if err != nil {
		return fmt.Errorf("join via %s: %w", addr, err)
	}

	// Connect to all peers returned by the seed
	for _, peerAddr := range resp.Peers {
		if peerAddr == n.opts.AdvertiseAddr {
			continue
		}
		if err := n.addPeer(peerAddr); err != nil {
			log.Printf("failed to connect to discovered peer %s: %v", peerAddr, err)
		}
	}

	return nil
}

func (n *Node) exchangeLoop() {
	ticker := time.NewTicker(n.opts.ExchangeInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			n.exchangeWithPeers()
		case <-n.ctx.Done():
			return
		}
	}
}

func (n *Node) exchangeWithPeers() {
	n.mu.RLock()
	peers := make([]*peer, 0, len(n.peers))
	for _, p := range n.peers {
		peers = append(peers, p)
	}
	n.mu.RUnlock()

	myPeers := n.peerAddrs()
	myTopics := n.localTopics()

	for _, p := range peers {
		ctx, cancel := context.WithTimeout(n.ctx, 5*time.Second)
		resp, err := p.client.Exchange(ctx, &pb.ExchangeRequest{
			NodeId: n.opts.ID,
			Peers:  myPeers,
			Topics: myTopics,
			Addr:   n.opts.AdvertiseAddr,
		})
		cancel()

		if err != nil {
			log.Printf("exchange with %s failed: %v", p.addr, err)
			p.failCount.Add(1)
			if p.failCount.Load() > int64(n.opts.MaxRetries) {
				log.Printf("removing unreachable peer %s", p.addr)
				n.removePeer(p.addr)
			}
			continue
		}

		p.failCount.Store(0)
		p.setTopics(resp.Topics)

		for _, addr := range resp.Peers {
			if addr == n.opts.AdvertiseAddr {
				continue
			}
			_ = n.addPeer(addr)
		}
	}
}

// localTopics returns the list of topics this node has local subscribers for.
func (n *Node) localTopics() []string {
	n.mu.RLock()
	defer n.mu.RUnlock()
	topics := make([]string, 0, len(n.subscribers))
	for topic := range n.subscribers {
		topics = append(topics, topic)
	}
	return topics
}

func (n *Node) peerAddrs() []string {
	n.mu.RLock()
	defer n.mu.RUnlock()

	addrs := make([]string, 0, len(n.peers)+1)
	addrs = append(addrs, n.opts.AdvertiseAddr)
	for addr := range n.peers {
		addrs = append(addrs, addr)
	}
	return addrs
}

func (n *Node) addPeer(addr string) error {
	n.mu.Lock()
	defer n.mu.Unlock()

	if _, exists := n.peers[addr]; exists {
		return nil
	}

	p, err := newPeer(addr)
	if err != nil {
		return fmt.Errorf("connect to peer %s: %w", addr, err)
	}

	n.peers[addr] = p
	log.Printf("connected to peer %s", addr)
	return nil
}

func (n *Node) removePeer(addr string) {
	n.mu.Lock()
	defer n.mu.Unlock()

	if p, ok := n.peers[addr]; ok {
		p.close()
		delete(n.peers, addr)
		log.Printf("removed peer %s", addr)
	}
}

func (n *Node) nextSequence(source string) uint64 {
	val, _ := n.sequences.LoadOrStore(source, &atomic.Uint64{})
	return val.(*atomic.Uint64).Add(1)
}

func (n *Node) cleanupSeen() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			cutoff := time.Now().Add(-time.Minute)
			n.seen.Range(func(key, value any) bool {
				if value.(time.Time).Before(cutoff) {
					n.seen.Delete(key)
				}
				return true
			})
			n.assembler.cleanup(time.Minute)
		case <-n.ctx.Done():
			return
		}
	}
}
