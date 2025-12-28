package loadbalancer

import (
	"errors"
	"io"
	"log"
	"maps"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ServerPool struct {
	Servers []*Server
}
type Server struct {
	Name            string
	Protocol        string
	Host            string
	Port            int
	URL             string
	IsHealthy       bool
	LastHealthCheck time.Time
}

func NewServerPool() *ServerPool {
	return &ServerPool{
		Servers: make([]*Server, 0),
	}
}

func (p *ServerPool) AddServer(server *Server) error {
	p.Servers = append(p.Servers, server)
	return nil
}

func (p *ServerPool) GetAllServers() []*Server {
	return p.Servers
}

type RoundRobin struct {
	pool *ServerPool
	mu   sync.Mutex
	idx  int
}

func NewRoundRobin(pool *ServerPool) *RoundRobin {
	return &RoundRobin{
		pool: pool,
		idx:  -1,
	}
}

func (rr *RoundRobin) GetNextServer() (*Server, error) {
	servers := rr.pool.GetAllServers()
	if len(servers) == 0 {
		return nil, errors.New("no servers found")
	}

	rr.mu.Lock()
	defer rr.mu.Unlock()

	rr.idx = (rr.idx + 1) % len(servers)

	selected := servers[rr.idx]

	return selected, nil
}

type Strategy interface {
	GetNextServer() (*Server, error)
}

type LoadBalancer struct {
	strategy Strategy
}

func NewLoadBalancer(strategy Strategy) *LoadBalancer {
	return &LoadBalancer{
		strategy: strategy,
	}
}

func (lb *LoadBalancer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	server, err := lb.strategy.GetNextServer()
	if err != nil {
		log.Println(err)
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	targetUrl, err := url.Parse(server.URL)
	if err != nil {
		log.Println(err)
		http.Error(w, "Invalid backend URL", http.StatusInternalServerError)
		return
	}

	targetPath := strings.TrimRight(targetUrl.String(), "/") + r.URL.Path
	if r.URL.RawQuery == "" {
		targetPath += "?" + r.URL.RawQuery
	}

	req, err := http.NewRequest(r.Method, targetPath, r.Body)
	if err != nil {
		log.Println(err)
		http.Error(w, "Failed to forward request", http.StatusInternalServerError)
		return
	}

	maps.Copy(req.Header, r.Header)

	req.Header.Set("X-Forwarded-For", r.RemoteAddr)
	req.Header.Set("X-Request-ID", strconv.FormatInt(time.Now().UnixMilli(), 10))

	client := &http.Client{
		Timeout: time.Second * 30,
	}

	res, err := client.Do(req)
	if err != nil {
		log.Println(err)
		http.Error(w, "Failed to forward request", http.StatusInternalServerError)
	}
	defer res.Body.Close()

	for k, values := range res.Header {
		for _, value := range values {
			w.Header().Add(k, value)
		}
	}

	w.WriteHeader(res.StatusCode)
	io.Copy(w, res.Body)
}
