package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
)

type backend struct {
	addr     string
	url      *url.URL
	healthy  bool
	topics   map[string]bool
	services map[string]bool
}

type loadBalancer struct {
	mu       sync.RWMutex
	backends []*backend
	counter  atomic.Uint64

	// Indexes: topic/service -> list of backend indexes that serve them.
	topicIndex   map[string][]int
	serviceIndex map[string][]int
}

func newLoadBalancer() *loadBalancer {
	return &loadBalancer{
		topicIndex:   make(map[string][]int),
		serviceIndex: make(map[string][]int),
	}
}

func (lb *loadBalancer) addBackend(addr string) {
	lb.mu.Lock()
	defer lb.mu.Unlock()

	for _, b := range lb.backends {
		if b.addr == addr {
			return
		}
	}

	u, err := url.Parse(fmt.Sprintf("http://%s", addr))
	if err != nil {
		log.Printf("invalid backend address %s: %v", addr, err)
		return
	}

	lb.backends = append(lb.backends, &backend{
		addr:     addr,
		url:      u,
		healthy:  true,
		topics:   make(map[string]bool),
		services: make(map[string]bool),
	})
	log.Printf("added backend: %s", addr)
}

// healthyBackend returns a healthy backend using round-robin.
func (lb *loadBalancer) healthyBackend() *backend {
	lb.mu.RLock()
	defer lb.mu.RUnlock()

	return lb.pickHealthy(lb.allIndexes())
}

// healthyBackendForTopic returns a healthy backend that has subscribers for the topic.
// Falls back to any healthy backend if no match.
func (lb *loadBalancer) healthyBackendForTopic(topic string) *backend {
	lb.mu.RLock()
	defer lb.mu.RUnlock()

	if idxs, ok := lb.topicIndex[topic]; ok && len(idxs) > 0 {
		if b := lb.pickHealthy(idxs); b != nil {
			return b
		}
	}
	return lb.pickHealthy(lb.allIndexes())
}

// healthyBackendForService returns a healthy backend that has the service registered.
// Falls back to any healthy backend if no match.
func (lb *loadBalancer) healthyBackendForService(service string) *backend {
	lb.mu.RLock()
	defer lb.mu.RUnlock()

	if idxs, ok := lb.serviceIndex[service]; ok && len(idxs) > 0 {
		if b := lb.pickHealthy(idxs); b != nil {
			return b
		}
	}
	return lb.pickHealthy(lb.allIndexes())
}

// pickHealthy selects a healthy backend from the given index list using round-robin.
// Must be called with lb.mu held.
func (lb *loadBalancer) pickHealthy(idxs []int) *backend {
	if len(idxs) == 0 {
		return nil
	}
	n := len(idxs)
	start := int(lb.counter.Add(1)) % n
	for i := range n {
		b := lb.backends[idxs[(start+i)%n]]
		if b.healthy {
			return b
		}
	}
	return nil
}

func (lb *loadBalancer) allIndexes() []int {
	idxs := make([]int, len(lb.backends))
	for i := range lb.backends {
		idxs[i] = i
	}
	return idxs
}

// routesResponse is the JSON returned by a node's /routes endpoint.
type routesResponse struct {
	NodeID   string   `json:"node_id"`
	Topics   []string `json:"topics"`
	Services []string `json:"services"`
}

func (lb *loadBalancer) healthCheck() {
	lb.mu.RLock()
	backends := make([]*backend, len(lb.backends))
	copy(backends, lb.backends)
	lb.mu.RUnlock()

	client := &http.Client{Timeout: 3 * time.Second}

	for i, b := range backends {
		// Health check.
		resp, err := client.Get(fmt.Sprintf("http://%s/health", b.addr))
		wasHealthy := b.healthy
		if err != nil || resp.StatusCode != http.StatusOK {
			b.healthy = false
			if wasHealthy {
				log.Printf("backend %s is unhealthy", b.addr)
			}
		} else {
			b.healthy = true
			if !wasHealthy {
				log.Printf("backend %s is healthy", b.addr)
			}
		}
		if resp != nil {
			resp.Body.Close()
		}

		// Fetch route table from healthy backends.
		if b.healthy {
			lb.fetchRoutes(client, i, b)
		}
	}

	lb.rebuildIndexes()
}

func (lb *loadBalancer) fetchRoutes(client *http.Client, _ int, b *backend) {
	resp, err := client.Get(fmt.Sprintf("http://%s/routes", b.addr))
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return
	}

	var routes routesResponse
	if err := json.NewDecoder(resp.Body).Decode(&routes); err != nil {
		log.Printf("failed to decode routes from %s: %v", b.addr, err)
		return
	}

	lb.mu.Lock()
	b.topics = make(map[string]bool, len(routes.Topics))
	for _, t := range routes.Topics {
		b.topics[t] = true
	}
	b.services = make(map[string]bool, len(routes.Services))
	for _, s := range routes.Services {
		b.services[s] = true
	}
	lb.mu.Unlock()
}

func (lb *loadBalancer) rebuildIndexes() {
	lb.mu.Lock()
	defer lb.mu.Unlock()

	topicIdx := make(map[string][]int)
	serviceIdx := make(map[string][]int)

	for i, b := range lb.backends {
		if !b.healthy {
			continue
		}
		for t := range b.topics {
			topicIdx[t] = append(topicIdx[t], i)
		}
		for s := range b.services {
			serviceIdx[s] = append(serviceIdx[s], i)
		}
	}

	lb.topicIndex = topicIdx
	lb.serviceIndex = serviceIdx
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (lb *loadBalancer) serveHTTP(w http.ResponseWriter, r *http.Request) {
	// WebSocket upgrade
	if websocket.IsWebSocketUpgrade(r) {
		lb.serveWS(w, r)
		return
	}

	b := lb.pickBackendForPath(r.URL.Path)
	if b == nil {
		http.Error(w, "no healthy backends", http.StatusServiceUnavailable)
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(b.url)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		log.Printf("proxy error for %s: %v", b.addr, err)
		http.Error(w, "backend error", http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, r)
}

func (lb *loadBalancer) serveWS(w http.ResponseWriter, r *http.Request) {
	b := lb.pickBackendForPath(r.URL.Path)
	if b == nil {
		http.Error(w, "no healthy backends", http.StatusServiceUnavailable)
		return
	}

	// Upgrade client connection
	clientConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("client upgrade error: %v", err)
		return
	}
	defer clientConn.Close()

	// Connect to upstream
	upstreamURL := fmt.Sprintf("ws://%s%s", b.addr, r.URL.Path)
	upstreamConn, _, err := websocket.DefaultDialer.Dial(upstreamURL, nil)
	if err != nil {
		log.Printf("upstream dial error for %s: %v", upstreamURL, err)
		clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "upstream unavailable"))
		return
	}
	defer upstreamConn.Close()

	// Bidirectional pipe
	done := make(chan struct{}, 2)

	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, data, err := upstreamConn.ReadMessage()
			if err != nil {
				return
			}
			if err := clientConn.WriteMessage(msgType, data); err != nil {
				return
			}
		}
	}()

	go func() {
		defer func() { done <- struct{}{} }()
		for {
			msgType, data, err := clientConn.ReadMessage()
			if err != nil {
				return
			}
			if err := upstreamConn.WriteMessage(msgType, data); err != nil {
				return
			}
		}
	}()

	<-done
}

// pickBackendForPath selects a backend based on the URL path.
// /topics/{topic} routes to a backend with that topic.
// /svc/{service}/... routes to a backend with that service.
// Everything else uses global round-robin.
func (lb *loadBalancer) pickBackendForPath(path string) *backend {
	if topic, ok := strings.CutPrefix(path, "/topics/"); ok && topic != "" {
		return lb.healthyBackendForTopic(topic)
	}

	if rest, ok := strings.CutPrefix(path, "/svc/"); ok {
		parts := strings.SplitN(rest, "/", 2)
		if len(parts) >= 1 && parts[0] != "" {
			return lb.healthyBackendForService(parts[0])
		}
	}

	return lb.healthyBackend()
}

func main() {
	addr := flag.String("addr", ":8081", "listen address")
	nodes := flag.String("nodes", "", "comma-separated node HTTP addresses")
	flag.Parse()

	lb := newLoadBalancer()

	if *nodes != "" {
		for _, n := range strings.Split(*nodes, ",") {
			n = strings.TrimSpace(n)
			if n != "" {
				lb.addBackend(n)
			}
		}
	}

	// Health check + route sync loop.
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			lb.healthCheck()
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/", lb.serveHTTP)

	server := &http.Server{
		Addr:    *addr,
		Handler: mux,
	}

	go func() {
		log.Printf("load balancer listening on %s", *addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Printf("received signal %v, shutting down...", sig)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Printf("server shutdown error: %v", err)
	}

	log.Println("shutdown complete")
}
