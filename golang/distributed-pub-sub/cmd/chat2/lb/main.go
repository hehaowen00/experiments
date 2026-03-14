// Load balancer — sits between chat2 clients and mesh nodes. Distributes
// WebSocket and HTTP connections across a pool of mesh node gateways with
// health checks and automatic WebSocket failover.
//
//	go run ./cmd/chat2/lb -listen :9090 -nodes http://localhost:8080,http://localhost:8081
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type node struct {
	url     string
	healthy atomic.Bool
}

type loadBalancer struct {
	nodes   []*node
	counter atomic.Uint64
}

func newLB(urls []string) *loadBalancer {
	lb := &loadBalancer{}
	for _, u := range urls {
		n := &node{url: strings.TrimRight(u, "/")}
		n.healthy.Store(true)
		lb.nodes = append(lb.nodes, n)
	}
	return lb
}

// next returns the next healthy node using round-robin.
func (lb *loadBalancer) next() *node {
	n := len(lb.nodes)
	for i := 0; i < n; i++ {
		idx := lb.counter.Add(1) % uint64(n)
		nd := lb.nodes[idx]
		if nd.healthy.Load() {
			return nd
		}
	}
	// Fallback: return any node
	idx := lb.counter.Add(1) % uint64(n)
	return lb.nodes[idx]
}

// healthyNode returns any healthy node, or nil.
func (lb *loadBalancer) healthyNode(exclude string) *node {
	for _, n := range lb.nodes {
		if n.url != exclude && n.healthy.Load() {
			return n
		}
	}
	return nil
}

// healthCheck periodically pings /stats on each node.
func (lb *loadBalancer) healthCheck(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	client := &http.Client{Timeout: 2 * time.Second}

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, n := range lb.nodes {
				resp, err := client.Get(n.url + "/stats")
				if err != nil || resp.StatusCode != http.StatusOK {
					if n.healthy.Swap(false) {
						log.Printf("node %s is DOWN", n.url)
					}
				} else {
					if !n.healthy.Swap(true) {
						log.Printf("node %s is UP", n.url)
					}
					resp.Body.Close()
				}
			}
		}
	}
}

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (lb *loadBalancer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if websocket.IsWebSocketUpgrade(r) {
		lb.proxyWS(w, r)
		return
	}
	lb.proxyHTTP(w, r)
}

func (lb *loadBalancer) proxyHTTP(w http.ResponseWriter, r *http.Request) {
	nd := lb.next()
	target, _ := url.Parse(nd.url)

	upstream := *r.URL
	upstream.Scheme = target.Scheme
	upstream.Host = target.Host

	req, err := http.NewRequestWithContext(r.Context(), r.Method, upstream.String(), r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	req.Header = r.Header.Clone()

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vs := range resp.Header {
		for _, v := range vs {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// wsSession tracks a proxied WebSocket client and the messages it sends,
// so that on failover we can replay subscriptions on the new upstream.
type wsSession struct {
	lb       *loadBalancer
	client   *websocket.Conn
	requestURI string

	mu       sync.Mutex
	upstream *websocket.Conn
	node     *node
	topics   map[string]bool // topics the client subscribed to
}

func (lb *loadBalancer) proxyWS(w http.ResponseWriter, r *http.Request) {
	nd := lb.next()

	// Connect to upstream
	upstream, err := dialUpstream(nd, r.URL.RequestURI())
	if err != nil {
		http.Error(w, fmt.Sprintf("upstream connect: %v", err), http.StatusBadGateway)
		return
	}

	// Accept client connection
	client, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		upstream.Close()
		return
	}

	sess := &wsSession{
		lb:         lb,
		client:     client,
		requestURI: r.URL.RequestURI(),
		upstream:   upstream,
		node:       nd,
		topics:     make(map[string]bool),
	}

	// Parse initial topic from query
	if t := r.URL.Query().Get("topic"); t != "" {
		sess.topics[t] = true
	}

	sess.run()
}

func dialUpstream(nd *node, requestURI string) (*websocket.Conn, error) {
	wsURL := wsURLFor(nd.url) + requestURI
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	return conn, err
}

func (s *wsSession) run() {
	done := make(chan struct{})

	// upstream → client
	go func() {
		defer close(done)
		for {
			s.mu.Lock()
			up := s.upstream
			s.mu.Unlock()

			mt, msg, err := up.ReadMessage()
			if err != nil {
				// Try failover
				if s.failover() {
					continue // retry with new upstream
				}
				// No failover possible — close client
				s.client.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseGoingAway, "upstream unavailable"))
				return
			}
			if err := s.client.WriteMessage(mt, msg); err != nil {
				return
			}
		}
	}()

	// client → upstream (also tracks subscriptions)
	go func() {
		for {
			mt, msg, err := s.client.ReadMessage()
			if err != nil {
				s.mu.Lock()
				up := s.upstream
				s.mu.Unlock()
				up.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}

			// Track subscribe/unsubscribe actions
			s.trackAction(msg)

			s.mu.Lock()
			up := s.upstream
			s.mu.Unlock()
			if err := up.WriteMessage(mt, msg); err != nil {
				// Upstream write failed — the read goroutine will handle failover
				continue
			}
		}
	}()

	<-done
	s.mu.Lock()
	s.upstream.Close()
	s.mu.Unlock()
	s.client.Close()
}

// trackAction watches for subscribe/unsubscribe messages to maintain the topic list.
func (s *wsSession) trackAction(raw []byte) {
	var msg struct {
		Action string `json:"action"`
		Topic  string `json:"topic"`
	}
	if err := json.Unmarshal(raw, &msg); err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	switch msg.Action {
	case "subscribe":
		s.topics[msg.Topic] = true
	case "unsubscribe":
		delete(s.topics, msg.Topic)
	}
}

// failover connects to a different healthy node and replays all subscriptions.
// Returns true if failover succeeded.
func (s *wsSession) failover() bool {
	s.mu.Lock()
	oldNode := s.node
	s.upstream.Close()
	s.mu.Unlock()

	// Try other healthy nodes first, then fall back to any node
	targets := make([]*node, 0, len(s.lb.nodes))
	if alt := s.lb.healthyNode(oldNode.url); alt != nil {
		targets = append(targets, alt)
	}
	for _, n := range s.lb.nodes {
		if n.url != oldNode.url {
			targets = append(targets, n)
		}
	}
	// Also retry the original node (it might have restarted)
	targets = append(targets, oldNode)

	backoff := 500 * time.Millisecond
	maxBackoff := 5 * time.Second

	for attempt := 0; attempt < 20; attempt++ {
		for _, nd := range targets {
			conn, err := dialUpstream(nd, s.requestURI)
			if err != nil {
				continue
			}

			// Re-subscribe to all tracked topics
			s.mu.Lock()
			topics := make([]string, 0, len(s.topics))
			for t := range s.topics {
				topics = append(topics, t)
			}
			s.mu.Unlock()

			for _, t := range topics {
				msg, _ := json.Marshal(map[string]string{"action": "subscribe", "topic": t})
				conn.WriteMessage(websocket.TextMessage, msg)
			}

			s.mu.Lock()
			s.upstream = conn
			s.node = nd
			s.mu.Unlock()

			log.Printf("lb: failover to %s, re-subscribed %d topics", nd.url, len(topics))
			return true
		}

		time.Sleep(backoff)
		backoff = min(backoff*2, maxBackoff)
	}

	log.Printf("lb: failover failed after retries")
	return false
}

func wsURLFor(httpURL string) string {
	if strings.HasPrefix(httpURL, "http://") {
		return "ws://" + httpURL[7:]
	}
	if strings.HasPrefix(httpURL, "https://") {
		return "wss://" + httpURL[8:]
	}
	return httpURL
}

func main() {
	listen := flag.String("listen", ":9090", "listen address")
	nodes := flag.String("nodes", "http://localhost:8080", "comma-separated mesh node gateway URLs")
	healthInterval := flag.Duration("health-interval", 5*time.Second, "health check interval")
	flag.Parse()

	urls := strings.Split(*nodes, ",")
	for i := range urls {
		urls[i] = strings.TrimSpace(urls[i])
	}

	lb := newLB(urls)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go lb.healthCheck(ctx, *healthInterval)

	log.Printf("chat2 load balancer listening on %s, nodes=%v", *listen, urls)
	if err := http.ListenAndServe(*listen, lb); err != nil {
		log.Fatal(err)
	}
}
