package discovery

import "context"

// Discovery finds peers on the network.
type Discovery interface {
	// Start begins advertising this node and discovering peers.
	// Returns a channel that emits discovered peer addresses.
	Start(ctx context.Context, advertiseAddr string) (<-chan string, error)
	// Stop halts discovery.
	Stop() error
}
