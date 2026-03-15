package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"distributed-pub-sub/pubsub"
	"distributed-pub-sub/pubsub/discovery"
)

func main() {
	httpAddr := flag.String("http", ":8080", "HTTP/WS listen address")
	grpcAddr := flag.String("grpc", ":9000", "gRPC listen address")
	enableMDNS := flag.Bool("mdns", true, "enable mDNS discovery")
	dbPath := flag.String("db", "", "SQLite database path (empty = in-memory)")
	seeds := flag.String("seeds", "", "comma-separated seed node addresses")
	nodeID := flag.String("id", "", "node ID (default: auto-generated)")
	tlsCert := flag.String("tls-cert", "", "TLS certificate file path")
	tlsKey := flag.String("tls-key", "", "TLS private key file path")
	tlsCACert := flag.String("tls-ca", "", "TLS CA certificate file path")
	flag.Parse()

	opts := pubsub.DefaultOptions()
	opts.GRPCAddress = *grpcAddr
	opts.HTTPAddress = *httpAddr
	opts.EnableMDNS = *enableMDNS
	opts.DBPath = *dbPath
	opts.TLSCert = *tlsCert
	opts.TLSKey = *tlsKey
	opts.TLSCACert = *tlsCACert

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
	log.Printf("node %s started (gRPC=%s, HTTP=%s, mDNS=%v)",
		opts.NodeID, *grpcAddr, *httpAddr, *enableMDNS)

	gw := pubsub.NewGateway(node)
	server := &http.Server{
		Addr:    *httpAddr,
		Handler: gw.Handler(),
	}

	go func() {
		log.Printf("HTTP server listening on %s", *httpAddr)
		var err error
		if *tlsCert != "" && *tlsKey != "" {
			err = server.ListenAndServeTLS(*tlsCert, *tlsKey)
		} else {
			err = server.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// Wait for interrupt signal.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	sig := <-sigCh
	log.Printf("received signal %v, shutting down...", sig)

	// Graceful shutdown.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}
	if err := node.Stop(); err != nil {
		log.Printf("node shutdown error: %v", err)
	}

	log.Println("shutdown complete")
}
