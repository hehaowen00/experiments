package discovery

import (
	"context"
	"fmt"
	"net"
	"sync"
	"time"
)

const defaultDNSPollInterval = 10 * time.Second

// DNS implements Discovery by periodically resolving a DNS name.
// This is useful for Kubernetes headless services.
type DNS struct {
	name     string
	interval time.Duration

	mu     sync.Mutex
	cancel context.CancelFunc
	wg     sync.WaitGroup
}

// DNSOption configures the DNS discovery.
type DNSOption func(*DNS)

// WithPollInterval sets the DNS polling interval.
func WithPollInterval(d time.Duration) DNSOption {
	return func(dns *DNS) {
		dns.interval = d
	}
}

// NewDNS creates a DNS-based discovery that resolves the given name.
// The name should be a headless service DNS name (e.g., "my-service.default.svc.cluster.local").
func NewDNS(name string, opts ...DNSOption) *DNS {
	d := &DNS{
		name:     name,
		interval: defaultDNSPollInterval,
	}
	for _, opt := range opts {
		opt(d)
	}
	return d
}

// Start begins periodically resolving the DNS name and emitting new peer addresses.
func (d *DNS) Start(ctx context.Context, advertiseAddr string) (<-chan string, error) {
	ctx, cancel := context.WithCancel(ctx)
	d.mu.Lock()
	d.cancel = cancel
	d.mu.Unlock()

	ch := make(chan string, 16)
	seen := make(map[string]struct{})

	d.wg.Add(1)
	go func() {
		defer d.wg.Done()
		defer close(ch)

		ticker := time.NewTicker(d.interval)
		defer ticker.Stop()

		// Resolve immediately on start, then on each tick.
		d.resolve(ctx, advertiseAddr, seen, ch)

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				d.resolve(ctx, advertiseAddr, seen, ch)
			}
		}
	}()

	return ch, nil
}

// Stop halts DNS discovery.
func (d *DNS) Stop() error {
	d.mu.Lock()
	cancel := d.cancel
	d.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	d.wg.Wait()
	return nil
}

// resolve performs a single DNS lookup and emits any new addresses.
func (d *DNS) resolve(ctx context.Context, advertiseAddr string, seen map[string]struct{}, ch chan<- string) {
	addrs := d.lookup()
	for _, addr := range addrs {
		if addr == advertiseAddr {
			continue
		}
		if _, ok := seen[addr]; !ok {
			seen[addr] = struct{}{}
			select {
			case ch <- addr:
			case <-ctx.Done():
				return
			}
		}
	}
}

// lookup tries SRV first, then falls back to A record resolution.
func (d *DNS) lookup() []string {
	// Try SRV lookup first.
	_, srvs, err := net.LookupSRV("", "", d.name)
	if err == nil && len(srvs) > 0 {
		var addrs []string
		for _, srv := range srvs {
			addr := fmt.Sprintf("%s:%d", srv.Target, srv.Port)
			addrs = append(addrs, addr)
		}
		return addrs
	}

	// Fall back to A record lookup.
	hosts, err := net.LookupHost(d.name)
	if err != nil {
		return nil
	}

	return hosts
}
