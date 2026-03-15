package pubsub

import (
	"context"
	"crypto/tls"
	"fmt"
	"sync"

	pb "distributed-pub-sub/pubsub/pb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// Peer represents a remote node in the pub-sub cluster.
type Peer struct {
	NodeID    string
	Address   string
	Topics    map[string]bool // topics this peer subscribes to
	conn      *grpc.ClientConn
	client    pb.PubSubServiceClient
	tlsConfig *tls.Config
	mu        sync.RWMutex
}

// NewPeer creates a new Peer with the given node ID and address.
func NewPeer(nodeID, address string) *Peer {
	return &Peer{
		NodeID:  nodeID,
		Address: address,
		Topics:  make(map[string]bool),
	}
}

// Connect establishes a gRPC connection to the peer.
func (p *Peer) Connect(ctx context.Context) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.conn != nil {
		return nil
	}

	var creds grpc.DialOption
	if p.tlsConfig != nil {
		creds = grpc.WithTransportCredentials(credentials.NewTLS(p.tlsConfig))
	} else {
		creds = grpc.WithTransportCredentials(insecure.NewCredentials())
	}
	conn, err := grpc.DialContext(ctx, p.Address, creds, grpc.WithBlock())
	if err != nil {
		return fmt.Errorf("failed to connect to peer %s at %s: %w", p.NodeID, p.Address, err)
	}

	p.conn = conn
	p.client = pb.NewPubSubServiceClient(conn)
	return nil
}

// Close shuts down the gRPC connection to the peer.
func (p *Peer) Close() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.conn == nil {
		return nil
	}

	err := p.conn.Close()
	p.conn = nil
	p.client = nil
	return err
}

// Forward sends a message to this peer via the gRPC Forward RPC.
func (p *Peer) Forward(ctx context.Context, msg *Message) error {
	p.mu.RLock()
	client := p.client
	p.mu.RUnlock()

	if client == nil {
		return fmt.Errorf("peer %s is not connected", p.NodeID)
	}

	req := &pb.ForwardRequest{
		Id:          msg.ID,
		Source:      msg.Source,
		Destination: msg.Destination,
		Payload:     msg.Payload,
		Timestamp:   msg.Timestamp,
		Sequence:    msg.Sequence,
		ReplyTo:     msg.ReplyTo,
		StreamId:    msg.StreamID,
		Attempt:     msg.Attempt,
	}

	resp, err := client.Forward(ctx, req)
	if err != nil {
		return fmt.Errorf("forward to peer %s failed: %w", p.NodeID, err)
	}
	if !resp.Accepted {
		return fmt.Errorf("forward to peer %s was rejected", p.NodeID)
	}
	return nil
}

// Exchange sends our topic list to the peer and receives theirs.
func (p *Peer) Exchange(ctx context.Context, nodeID string, topics []string) ([]string, error) {
	p.mu.RLock()
	client := p.client
	p.mu.RUnlock()

	if client == nil {
		return nil, fmt.Errorf("peer %s is not connected", p.NodeID)
	}

	resp, err := client.Exchange(ctx, &pb.ExchangeRequest{
		NodeId: nodeID,
		Topics: topics,
	})
	if err != nil {
		return nil, fmt.Errorf("exchange with peer %s failed: %w", p.NodeID, err)
	}

	return resp.Topics, nil
}

// UpdateTopics replaces the peer's known topic set with the given topics.
func (p *Peer) UpdateTopics(topics []string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.Topics = make(map[string]bool, len(topics))
	for _, t := range topics {
		p.Topics[t] = true
	}
}

// TopicList returns the peer's topics as a string slice.
func (p *Peer) TopicList() []string {
	p.mu.RLock()
	defer p.mu.RUnlock()

	topics := make([]string, 0, len(p.Topics))
	for t := range p.Topics {
		topics = append(topics, t)
	}
	return topics
}

// HealthCheck sends a health check RPC to the peer.
func (p *Peer) HealthCheck(ctx context.Context) error {
	p.mu.RLock()
	client := p.client
	p.mu.RUnlock()

	if client == nil {
		return fmt.Errorf("peer %s is not connected", p.NodeID)
	}

	_, err := client.HealthCheck(ctx, &pb.HealthCheckRequest{})
	return err
}

// HasTopic returns true if this peer subscribes to the given topic.
func (p *Peer) HasTopic(topic string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()

	return p.Topics[topic]
}
