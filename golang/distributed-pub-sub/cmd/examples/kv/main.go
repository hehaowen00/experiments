package main

import (
	"bufio"
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
)

func main() {
	grpcAddr := flag.String("grpc", ":9000", "gRPC listen address")
	httpAddr := flag.String("http", ":8080", "HTTP listen address")
	seeds := flag.String("seeds", "", "comma-separated seed node addresses")
	nodeID := flag.String("id", "", "node ID")
	enableMDNS := flag.Bool("mdns", false, "enable mDNS discovery")
	tlsCert := flag.String("tls-cert", "", "TLS certificate file path")
	tlsKey := flag.String("tls-key", "", "TLS private key file path")
	tlsCACert := flag.String("tls-ca", "", "TLS CA certificate file path")
	flag.Parse()

	opts := pubsub.DefaultOptions()
	opts.GRPCAddress = *grpcAddr
	opts.HTTPAddress = *httpAddr
	opts.EnableMDNS = *enableMDNS
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

	// Start HTTP gateway.
	gw := pubsub.NewGateway(node)
	server := &http.Server{Addr: *httpAddr, Handler: gw.Handler()}
	go func() {
		log.Printf("HTTP listening on %s", *httpAddr)
		var err error
		if *tlsCert != "" && *tlsKey != "" {
			err = server.ListenAndServeTLS(*tlsCert, *tlsKey)
		} else {
			err = server.ListenAndServe()
		}
		if err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP error: %v", err)
		}
	}()

	// Start KV store.
	store := kv.NewStore(node)
	if err := store.Start(); err != nil {
		log.Fatalf("failed to start KV store: %v", err)
	}

	log.Printf("KV node %s started (gRPC=%s, HTTP=%s)", opts.NodeID, *grpcAddr, *httpAddr)
	fmt.Println("Commands: SET <key> <value> [ttl], GET <key>, DEL <key>, LIST, QUIT")

	// REPL.
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			parts := strings.Fields(line)
			cmd := strings.ToUpper(parts[0])

			switch cmd {
			case "SET":
				if len(parts) < 3 {
					fmt.Println("Usage: SET <key> <value> [ttl]")
					continue
				}
				var ttl time.Duration
				if len(parts) >= 4 {
					d, err := time.ParseDuration(parts[3])
					if err != nil {
						fmt.Printf("invalid TTL: %v\n", err)
						continue
					}
					ttl = d
				}
				store.Set(parts[1], []byte(parts[2]), ttl)
				fmt.Printf("OK\n")

			case "GET":
				if len(parts) < 2 {
					fmt.Println("Usage: GET <key>")
					continue
				}
				val, ok := store.Get(parts[1])
				if !ok {
					fmt.Println("(nil)")
				} else {
					fmt.Printf("%s\n", val)
				}

			case "DEL":
				if len(parts) < 2 {
					fmt.Println("Usage: DEL <key>")
					continue
				}
				store.Delete(parts[1])
				fmt.Println("OK")

			case "LIST":
				keys := store.Keys()
				if len(keys) == 0 {
					fmt.Println("(empty)")
				} else {
					for _, k := range keys {
						fmt.Println(k)
					}
				}

			case "QUIT", "EXIT":
				fmt.Println("bye!")
				os.Exit(0)

			default:
				fmt.Printf("Unknown command: %s\n", cmd)
			}
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	fmt.Println("\nshutting down...")
	store.Stop()
	server.Close()
	node.Stop()
}
