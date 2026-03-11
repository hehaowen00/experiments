package pubsub

import "sync/atomic"

// Stats holds atomic counters for node activity.
type Stats struct {
	Published        atomic.Uint64 // messages published locally
	Forwarded        atomic.Uint64 // messages forwarded to peers
	ForwardsFailed   atomic.Uint64 // forward attempts that exhausted retries
	Received         atomic.Uint64 // messages received from peers
	Delivered        atomic.Uint64 // messages delivered to subscriber handlers
	DeliveryRetries  atomic.Uint64 // handler retries (each retry attempt)
	Dropped          atomic.Uint64 // messages dropped (buffer full or handler exhausted)
	Deduplicated     atomic.Uint64 // messages rejected by dedup
	RateLimited      atomic.Uint64 // publishes rejected by rate limiter
	DeadLettered     atomic.Uint64 // messages sent to dead letter queue
	Overflowed       atomic.Uint64 // messages spilled to overflow queue
}

// Snapshot returns a point-in-time copy of all counters.
type StatsSnapshot struct {
	Published       uint64 `json:"published"`
	Forwarded       uint64 `json:"forwarded"`
	ForwardsFailed  uint64 `json:"forwards_failed"`
	Received        uint64 `json:"received"`
	Delivered       uint64 `json:"delivered"`
	DeliveryRetries uint64 `json:"delivery_retries"`
	Dropped         uint64 `json:"dropped"`
	Deduplicated    uint64 `json:"deduplicated"`
	RateLimited     uint64 `json:"rate_limited"`
	DeadLettered    uint64 `json:"dead_lettered"`
	Overflowed      uint64 `json:"overflowed"`
}

func (s *Stats) Snapshot() StatsSnapshot {
	return StatsSnapshot{
		Published:       s.Published.Load(),
		Forwarded:       s.Forwarded.Load(),
		ForwardsFailed:  s.ForwardsFailed.Load(),
		Received:        s.Received.Load(),
		Delivered:       s.Delivered.Load(),
		DeliveryRetries: s.DeliveryRetries.Load(),
		Dropped:         s.Dropped.Load(),
		Deduplicated:    s.Deduplicated.Load(),
		RateLimited:     s.RateLimited.Load(),
		DeadLettered:    s.DeadLettered.Load(),
		Overflowed:      s.Overflowed.Load(),
	}
}
