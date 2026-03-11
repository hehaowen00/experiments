package pubsub

import (
	"context"
	"time"
)

// Resolver abstracts DNS lookups so tests can inject a fake.
type Resolver interface {
	LookupHost(ctx context.Context, host string) ([]string, error)
}

type Options struct {
	// ID uniquely identifies this node in the mesh. Auto-generated if empty.
	ID string

	// ListenAddr is the address the internal gRPC server binds to.
	ListenAddr string

	// AdvertiseAddr is the address this node tells peers to connect to.
	// Required — must be reachable by other nodes (e.g. "10.0.1.5:9000").
	AdvertiseAddr string

	// Seeds is a list of known peer addresses to bootstrap into the mesh.
	// Only need one reachable seed to discover the full mesh.
	Seeds []string

	// ExchangeInterval controls how often peer lists are exchanged with
	// connected peers to discover new nodes and detect departed ones.
	ExchangeInterval time.Duration

	// BufferSize is the per-subscriber message buffer capacity.
	BufferSize int

	// MaxRetries is the number of retry attempts for message delivery and forwarding.
	MaxRetries int

	// RetryInterval is the delay between retry attempts.
	RetryInterval time.Duration

	// DNSDiscovery is a hostname to periodically resolve for peer discovery.
	// Designed for Kubernetes headless services (e.g. "pubsub.default.svc.cluster.local").
	// Leave empty to disable.
	DNSDiscovery string

	// DNSDiscoveryPort is the gRPC port appended to each resolved IP.
	// Required when DNSDiscovery is set.
	DNSDiscoveryPort string

	// DNSDiscoveryInterval controls how often the DNS name is re-resolved.
	DNSDiscoveryInterval time.Duration

	// Resolver overrides the DNS resolver used for discovery. Defaults to net.DefaultResolver.
	Resolver Resolver

	// PublishRate is the max messages per second per source. 0 means unlimited.
	PublishRate float64

	// PublishBurst is the max burst size for rate limiting. Defaults to 10 when PublishRate is set.
	PublishBurst int

	// DrainTimeout is how long Stop() waits for in-flight messages to drain.
	// Defaults to 5 seconds.
	DrainTimeout time.Duration

	// MaxMessageSize is the maximum payload size (in bytes) for a single
	// forwarded message. Payloads exceeding this are automatically chunked
	// for transmission and reassembled on the receiving end. Subscribers
	// always receive the complete message. 0 means no limit.
	MaxMessageSize int

	// QueueFactory creates overflow buffers for subscribers. When a subscriber's
	// in-memory channel is full, messages spill to the queue instead of being
	// dropped. Nil means overflow messages are dropped (original behavior).
	QueueFactory QueueFactory

	// EnableDLQ enables the dead letter queue. When a subscriber exhausts all
	// delivery retries, the message is republished to "_dlq.<original_topic>"
	// instead of being silently dropped. Subscribe to DLQ topics to inspect
	// or retry failed messages.
	EnableDLQ bool
}

func DefaultOptions() Options {
	return Options{
		ListenAddr:       ":9000",
		ExchangeInterval: 5 * time.Second,
		BufferSize:       64,
		MaxRetries:       3,
		RetryInterval:    time.Second,
	}
}
