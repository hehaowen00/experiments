package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"distributed-pub-sub/kv"
	"distributed-pub-sub/pubsub"
	"distributed-pub-sub/pubsub/discovery"
	"distributed-pub-sub/service"
)

const serviceName = "auth"

func keyForClient(clientID string) string { return "auth.client:" + clientID }
func keyForToken(token string) string     { return "auth.token:" + token }

type registerRequest struct {
	ClientID string `json:"client_id"`
}

type registerResponse struct {
	Token string `json:"token"`
}

type validateRequest struct {
	Token string `json:"token"`
}

type validateResponse struct {
	ClientID string `json:"client_id"`
}

type revokeRequest struct {
	ClientID string `json:"client_id"`
}

// ---------------------------------------------------------------------------
// Auth service — stores tokens in the distributed KV cache
// ---------------------------------------------------------------------------

type authService struct {
	store *kv.Store
	svc   *service.Service
}

func newAuthService(node *pubsub.Node, store *kv.Store) *authService {
	transport := service.NewEmbeddedTransport(node)
	svc := service.NewService(serviceName, transport)

	s := &authService{store: store, svc: svc}
	svc.Handle("register", s.handleRegister)
	svc.Handle("validate", s.handleValidate)
	svc.Handle("revoke", s.handleRevoke)
	return s
}

func (s *authService) Start() error { return s.svc.Start() }
func (s *authService) Stop() error  { return s.svc.Stop() }

func (s *authService) register(clientID string) (string, error) {
	if existing, ok := s.store.Get(keyForClient(clientID)); ok {
		s.store.Delete(keyForToken(string(existing)))
	}
	token, err := generateToken()
	if err != nil {
		return "", fmt.Errorf("generate token: %w", err)
	}
	s.store.Set(keyForClient(clientID), []byte(token), 0)
	s.store.Set(keyForToken(token), []byte(clientID), 0)
	return token, nil
}

func (s *authService) validate(token string) (string, bool) {
	val, ok := s.store.Get(keyForToken(token))
	if !ok {
		return "", false
	}
	return string(val), true
}

func (s *authService) revoke(clientID string) {
	if token, ok := s.store.Get(keyForClient(clientID)); ok {
		s.store.Delete(keyForToken(string(token)))
	}
	s.store.Delete(keyForClient(clientID))
}

func (s *authService) handleRegister(req *service.Request) *service.Response {
	var r registerRequest
	if err := json.Unmarshal(req.Payload, &r); err != nil {
		return &service.Response{Error: "invalid request"}
	}
	if r.ClientID == "" {
		return &service.Response{Error: "client_id required"}
	}
	token, err := s.register(r.ClientID)
	if err != nil {
		return &service.Response{Error: err.Error()}
	}
	payload, _ := json.Marshal(registerResponse{Token: token})
	return &service.Response{Payload: payload}
}

func (s *authService) handleValidate(req *service.Request) *service.Response {
	var r validateRequest
	if err := json.Unmarshal(req.Payload, &r); err != nil {
		return &service.Response{Error: "invalid request"}
	}
	clientID, ok := s.validate(r.Token)
	if !ok {
		return &service.Response{Error: "invalid token"}
	}
	payload, _ := json.Marshal(validateResponse{ClientID: clientID})
	return &service.Response{Payload: payload}
}

func (s *authService) handleRevoke(req *service.Request) *service.Response {
	var r revokeRequest
	if err := json.Unmarshal(req.Payload, &r); err != nil {
		return &service.Response{Error: "invalid request"}
	}
	if r.ClientID == "" {
		return &service.Response{Error: "client_id required"}
	}
	s.revoke(r.ClientID)
	return &service.Response{}
}

func generateToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ---------------------------------------------------------------------------
// Auth middleware — validates Bearer tokens via the KV-backed auth service
// ---------------------------------------------------------------------------

// authMiddleware wraps an http.Handler, requiring a valid Bearer token on
// every request except the public paths (register, health, metrics).
// It looks up the token directly in the KV store, so validation is local
// and works across the cluster because KV replicates writes to all nodes.
func authMiddleware(auth *authService, public map[string]bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow public endpoints without auth.
		if public[r.URL.Path] {
			next.ServeHTTP(w, r)
			return
		}

		// Also allow the auth service's own register endpoint so new
		// clients can obtain a token.
		if strings.HasPrefix(r.URL.Path, "/svc/auth/") {
			next.ServeHTTP(w, r)
			return
		}

		// Extract "Bearer <token>" from the Authorization header.
		header := r.Header.Get("Authorization")
		if header == "" {
			http.Error(w, `{"error":"missing Authorization header"}`, http.StatusUnauthorized)
			return
		}
		token, ok := strings.CutPrefix(header, "Bearer ")
		if !ok || token == "" {
			http.Error(w, `{"error":"invalid Authorization header, expected Bearer <token>"}`, http.StatusUnauthorized)
			return
		}

		clientID, valid := auth.validate(token)
		if !valid {
			http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
			return
		}

		// Attach the authenticated client ID to the request context.
		ctx := context.WithValue(r.Context(), clientIDKey, clientID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type contextKey string

const clientIDKey contextKey = "client_id"

// clientIDFromContext extracts the authenticated client ID set by the middleware.
func clientIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(clientIDKey).(string); ok {
		return v
	}
	return ""
}

// ---------------------------------------------------------------------------
// Remote helpers
// ---------------------------------------------------------------------------

func remoteRegister(svc *service.Service, clientID string, timeout time.Duration) (string, error) {
	payload, _ := json.Marshal(registerRequest{ClientID: clientID})
	resp, err := svc.Call(context.Background(), serviceName, "register", payload, timeout)
	if err != nil {
		return "", err
	}
	if resp.Error != "" {
		return "", fmt.Errorf("%s", resp.Error)
	}
	var r registerResponse
	if err := json.Unmarshal(resp.Payload, &r); err != nil {
		return "", err
	}
	return r.Token, nil
}

func remoteValidate(svc *service.Service, token string, timeout time.Duration) (string, error) {
	payload, _ := json.Marshal(validateRequest{Token: token})
	resp, err := svc.Call(context.Background(), serviceName, "validate", payload, timeout)
	if err != nil {
		return "", err
	}
	if resp.Error != "" {
		return "", fmt.Errorf("%s", resp.Error)
	}
	var r validateResponse
	if err := json.Unmarshal(resp.Payload, &r); err != nil {
		return "", err
	}
	return r.ClientID, nil
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

func main() {
	grpcAddr := flag.String("grpc", ":9000", "gRPC listen address")
	httpAddr := flag.String("http", ":8080", "HTTP listen address")
	seeds := flag.String("seeds", "", "comma-separated seed node addresses")
	nodeID := flag.String("id", "", "node ID")
	enableMDNS := flag.Bool("mdns", false, "enable mDNS discovery")
	flag.Parse()

	opts := pubsub.DefaultOptions()
	opts.GRPCAddress = *grpcAddr
	opts.HTTPAddress = *httpAddr
	opts.EnableMDNS = *enableMDNS
	if *nodeID != "" {
		opts.NodeID = *nodeID
	}
	if *seeds != "" {
		opts.Seeds = strings.Split(*seeds, ",")
	}

	node := pubsub.NewNode(opts)
	if *enableMDNS {
		node.SetDiscovery(discovery.NewMDNS())
	}
	if err := node.Start(); err != nil {
		log.Fatalf("failed to start node: %v", err)
	}

	// KV store — auth tokens are stored here.
	store := kv.NewStore(node)
	if err := store.Start(); err != nil {
		log.Fatalf("failed to start KV store: %v", err)
	}

	// Auth service on top of KV.
	auth := newAuthService(node, store)
	if err := auth.Start(); err != nil {
		log.Fatalf("failed to start auth service: %v", err)
	}

	// Gateway handler (has /topics/, /svc/, /publish, /ws, etc.)
	gw := pubsub.NewGateway(node)

	// Wrap the gateway with auth middleware.
	// Public paths that don't require a token:
	publicPaths := map[string]bool{
		"/health":  true,
		"/metrics": true,
		"/routes":  true,
	}
	handler := authMiddleware(auth, publicPaths, gw.Handler())

	server := &http.Server{Addr: *httpAddr, Handler: handler}
	go func() {
		log.Printf("HTTP listening on %s", *httpAddr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP error: %v", err)
		}
	}()

	log.Printf("auth example node %s started (gRPC=%s, HTTP=%s)", opts.NodeID, *grpcAddr, *httpAddr)
	fmt.Println()
	fmt.Println("This example demonstrates:")
	fmt.Println("  1. Using the KV cache to build a distributed auth token service")
	fmt.Println("  2. Auth middleware that protects all gateway endpoints")
	fmt.Println()

	// Register a demo client so we can show usage.
	token, err := auth.register("demo-client")
	if err != nil {
		log.Fatalf("register demo client: %v", err)
	}
	fmt.Printf("Registered demo-client with token: %s\n\n", token)

	fmt.Println("Try from another terminal:")
	fmt.Println()
	fmt.Printf("  # Register a new client (public — no token needed)\n")
	fmt.Printf("  curl -X POST http://localhost%s/svc/auth/register \\\n", *httpAddr)
	fmt.Printf("    -d '{\"payload\":{\"client_id\":\"alice\"}}'\n")
	fmt.Println()
	fmt.Printf("  # Access a protected endpoint WITHOUT a token (→ 401)\n")
	fmt.Printf("  curl http://localhost%s/services\n", *httpAddr)
	fmt.Println()
	fmt.Printf("  # Access with a valid token (→ 200)\n")
	fmt.Printf("  curl -H 'Authorization: Bearer %s' http://localhost%s/services\n", token, *httpAddr)
	fmt.Println()
	fmt.Printf("  # Publish to a topic with auth\n")
	fmt.Printf("  curl -X POST http://localhost%s/topics/chat \\\n", *httpAddr)
	fmt.Printf("    -H 'Authorization: Bearer %s' \\\n", token)
	fmt.Printf("    -d '{\"payload\":{\"msg\":\"hello\"}}'\n")
	fmt.Println()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	fmt.Println("\nshutting down...")
	auth.Stop()
	store.Stop()
	server.Close()
	node.Stop()
}
