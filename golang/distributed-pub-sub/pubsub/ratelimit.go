package pubsub

import (
	"sync"
	"time"
)

// RateLimiter implements per-key token bucket rate limiting.
type RateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   int     // max burst
}

type bucket struct {
	tokens   float64
	lastTime time.Time
}

// NewRateLimiter creates a RateLimiter with the given rate (tokens per second)
// and burst size. If rate <= 0, Allow always returns true.
func NewRateLimiter(rate float64, burst int) *RateLimiter {
	return &RateLimiter{
		buckets: make(map[string]*bucket),
		rate:    rate,
		burst:   burst,
	}
}

// Allow reports whether an event for the given key may happen now.
// It consumes one token from the key's bucket if available.
func (r *RateLimiter) Allow(key string) bool {
	if r.rate <= 0 {
		return true
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	now := time.Now()
	b, ok := r.buckets[key]
	if !ok {
		b = &bucket{
			tokens:   float64(r.burst) - 1,
			lastTime: now,
		}
		r.buckets[key] = b
		return true
	}

	// Refill tokens based on elapsed time
	elapsed := now.Sub(b.lastTime).Seconds()
	b.tokens += elapsed * r.rate
	if b.tokens > float64(r.burst) {
		b.tokens = float64(r.burst)
	}
	b.lastTime = now

	if b.tokens >= 1 {
		b.tokens--
		return true
	}

	return false
}
