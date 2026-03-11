package main

import (
	"flag"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// backend represents a single upstream server node.
type backend struct {
	url      *url.URL
	healthy  atomic.Bool
	lastSeen time.Time
}

// balancer round-robins across healthy backends with dynamic discovery.
type balancer struct {
	mu       sync.RWMutex
	backends map[string]*backend // keyed by URL string
	order    []string            // round-robin order
	counter  atomic.Uint64
}

func newBalancer() *balancer {
	return &balancer{
		backends: make(map[string]*backend),
	}
}

// addBackend registers or refreshes a backend by URL string.
func (b *balancer) addBackend(addr string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if be, ok := b.backends[addr]; ok {
		be.lastSeen = time.Now()
		return
	}

	u, err := url.Parse(addr)
	if err != nil {
		log.Printf("invalid backend address %q: %v", addr, err)
		return
	}

	be := &backend{url: u, lastSeen: time.Now()}
	be.healthy.Store(true)
	b.backends[addr] = be
	b.order = append(b.order, addr)
	log.Printf("discovered backend %s", addr)
}

// removeStale removes backends that haven't announced within the TTL.
func (b *balancer) removeStale(ttl time.Duration) {
	b.mu.Lock()
	defer b.mu.Unlock()

	cutoff := time.Now().Add(-ttl)
	newOrder := b.order[:0]
	for _, addr := range b.order {
		be := b.backends[addr]
		if be.lastSeen.Before(cutoff) {
			delete(b.backends, addr)
			log.Printf("removed stale backend %s", addr)
		} else {
			newOrder = append(newOrder, addr)
		}
	}
	b.order = newOrder
}

// next returns the next healthy backend, or nil if none are available.
func (b *balancer) next() *backend {
	b.mu.RLock()
	defer b.mu.RUnlock()

	n := len(b.order)
	if n == 0 {
		return nil
	}
	for range n {
		idx := b.counter.Add(1) - 1
		addr := b.order[idx%uint64(n)]
		be := b.backends[addr]
		if be.healthy.Load() {
			return be
		}
	}
	return nil
}

// healthCheck periodically pings each backend and removes stale entries.
func (b *balancer) healthCheck(interval, staleTTL time.Duration) {
	client := &http.Client{Timeout: 2 * time.Second}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for range ticker.C {
		b.mu.RLock()
		addrs := make([]string, len(b.order))
		copy(addrs, b.order)
		b.mu.RUnlock()

		for _, addr := range addrs {
			b.mu.RLock()
			be, ok := b.backends[addr]
			b.mu.RUnlock()
			if !ok {
				continue
			}

			resp, err := client.Get(be.url.String() + "/stats")
			if err != nil {
				if be.healthy.Swap(false) {
					log.Printf("backend %s unhealthy: %v", addr, err)
				}
				continue
			}
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				if !be.healthy.Swap(true) {
					log.Printf("backend %s recovered", addr)
				}
			} else {
				if be.healthy.Swap(false) {
					log.Printf("backend %s unhealthy: status %d", addr, resp.StatusCode)
				}
			}
		}

		b.removeStale(staleTTL)
	}
}

// listenMulticast listens for UDP multicast announcements from servers.
func (b *balancer) listenMulticast(multicastAddr string) {
	addr, err := net.ResolveUDPAddr("udp4", multicastAddr)
	if err != nil {
		log.Fatalf("resolve multicast: %v", err)
	}
	conn, err := net.ListenMulticastUDP("udp4", nil, addr)
	if err != nil {
		log.Fatalf("listen multicast: %v", err)
	}
	defer conn.Close()

	buf := make([]byte, 1024)
	for {
		n, _, err := conn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("multicast read error: %v", err)
			continue
		}
		httpAddr := string(buf[:n])
		b.addBackend(httpAddr)
	}
}

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (b *balancer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	be := b.next()
	if be == nil {
		http.Error(w, `{"error":"no healthy backends"}`, http.StatusServiceUnavailable)
		return
	}

	if websocket.IsWebSocketUpgrade(r) {
		b.proxyWebSocket(w, r, be)
		return
	}

	b.proxyHTTP(w, r, be)
}

func (b *balancer) proxyHTTP(w http.ResponseWriter, r *http.Request, be *backend) {
	target := *be.url
	target.Path = r.URL.Path
	target.RawQuery = r.URL.RawQuery

	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), r.Body)
	if err != nil {
		http.Error(w, `{"error":"proxy error"}`, http.StatusBadGateway)
		return
	}
	proxyReq.Header = r.Header.Clone()

	resp, err := http.DefaultClient.Do(proxyReq)
	if err != nil {
		be.healthy.Store(false)
		http.Error(w, `{"error":"backend unavailable"}`, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (b *balancer) proxyWebSocket(w http.ResponseWriter, r *http.Request, be *backend) {
	backendURL := *be.url
	if backendURL.Scheme == "http" {
		backendURL.Scheme = "ws"
	} else {
		backendURL.Scheme = "wss"
	}
	backendURL.Path = r.URL.Path
	backendURL.RawQuery = r.URL.RawQuery

	backendConn, _, err := websocket.DefaultDialer.Dial(backendURL.String(), nil)
	if err != nil {
		be.healthy.Store(false)
		http.Error(w, `{"error":"backend ws connect failed"}`, http.StatusBadGateway)
		return
	}
	defer backendConn.Close()

	clientConn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer clientConn.Close()

	done := make(chan struct{}, 2)

	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, data, err := clientConn.ReadMessage()
			if err != nil {
				return
			}
			if err := backendConn.WriteMessage(msgType, data); err != nil {
				return
			}
		}
	}()

	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, data, err := backendConn.ReadMessage()
			if err != nil {
				return
			}
			if err := clientConn.WriteMessage(msgType, data); err != nil {
				return
			}
		}
	}()

	<-done
}

func main() {
	addr := flag.String("addr", ":8000", "listen address")
	multicastAddr := flag.String("multicast", "239.1.1.1:9999", "UDP multicast address to listen for server announcements")
	healthInterval := flag.Duration("health-interval", 3*time.Second, "health check interval")
	staleTTL := flag.Duration("stale-ttl", 10*time.Second, "remove backends that stop announcing after this duration")
	flag.Parse()

	lb := newBalancer()

	go lb.listenMulticast(*multicastAddr)
	go lb.healthCheck(*healthInterval, *staleTTL)

	log.Printf("load balancer listening on %s, discovering backends via multicast %s", *addr, *multicastAddr)
	log.Fatal(http.ListenAndServe(*addr, lb))
}
