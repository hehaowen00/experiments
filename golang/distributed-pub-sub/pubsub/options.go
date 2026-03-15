package pubsub

import (
	"time"

	"github.com/google/uuid"
)

// topicSync is the internal topic used for broadcasting topic list changes
// between peers. Messages on this topic are always forwarded to all peers.
const topicSync = "_sync.topics"

// topicServiceSync is the internal topic for broadcasting service registry
// changes between peers, enabling redirect-based server redundancy.
const topicServiceSync = "_sync.services"

// Options configures a Node
type Options struct {
	NodeID         string        // unique node identifier (default: UUID)
	GRPCAddress    string        // gRPC listen address (default: ":9000")
	HTTPAddress    string        // HTTP/WS listen address (default: ":8080")
	MaxRetries     int           // max delivery retries before DLQ (default: 5)
	RetryBaseDelay time.Duration // base delay for retry backoff (default: 1s)
	RetryMaxDelay  time.Duration // max retry delay (default: 30s)
	ChannelSize    int           // subscriber channel buffer size (default: 256)
	EnableMDNS     bool          // enable mDNS discovery (default: true)
	Seeds          []string      // seed node addresses for initial join
	DBPath         string        // SQLite database path (empty = in-memory mode)
	RateLimit      float64       // messages per second per topic (0 = unlimited)
	RateBurst      int           // burst size for rate limiter (default: 10)
	DedupTTL            time.Duration // TTL for dedup entries (default: 1h)
	HealthCheckInterval time.Duration // interval between peer health checks (default: 10s)
	MaxHealthFailures   int           // consecutive failures before peer removal (default: 3)
	RejoinInterval      time.Duration // interval between dead peer rejoin attempts (default: 30s)
	TLSCert             string        // TLS certificate file path (empty = no TLS)
	TLSKey              string        // TLS private key file path
	TLSCACert           string        // TLS CA certificate file path (for mutual TLS)
}

// DefaultOptions returns Options populated with sensible defaults.
func DefaultOptions() Options {
	return Options{
		NodeID:         uuid.New().String(),
		GRPCAddress:    ":9000",
		HTTPAddress:    ":8080",
		MaxRetries:     5,
		RetryBaseDelay: 1 * time.Second,
		RetryMaxDelay:  30 * time.Second,
		ChannelSize:    256,
		EnableMDNS:     true,
		Seeds:          nil,
		DBPath:         "",
		RateLimit:      0,
		RateBurst:      10,
		DedupTTL:            1 * time.Hour,
		HealthCheckInterval: 10 * time.Second,
		MaxHealthFailures:   3,
		RejoinInterval:      30 * time.Second,
	}
}
