package pubsub

import (
	"sync"
	"sync/atomic"

	pb "distributed-pub-sub/pubsub/internal/pb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type peer struct {
	addr      string
	conn      *grpc.ClientConn
	client    pb.InternalClient
	failCount atomic.Int64

	mu          sync.RWMutex
	topics      map[string]struct{} // topics this peer has subscribers for
	topicsKnown bool                // false until first exchange
}

func newPeer(addr string) (*peer, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, err
	}
	return &peer{
		addr:   addr,
		conn:   conn,
		client: pb.NewInternalClient(conn),
		topics: make(map[string]struct{}),
	}, nil
}

func (p *peer) setTopics(topics []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.topics = make(map[string]struct{}, len(topics))
	for _, t := range topics {
		p.topics[t] = struct{}{}
	}
	p.topicsKnown = true
}

// hasTopic returns true if the peer has subscribers for the given topic.
// Returns true if the peer's topic list is unknown or empty (conservative —
// only skip forwarding when we know the peer has topics and ours isn't among them).
func (p *peer) hasTopic(topic string) bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if !p.topicsKnown || len(p.topics) == 0 {
		return true
	}
	_, ok := p.topics[topic]
	return ok
}

func (p *peer) close() {
	if p.conn != nil {
		p.conn.Close()
	}
}
