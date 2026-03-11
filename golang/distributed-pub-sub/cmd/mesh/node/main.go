// Standalone pubsub mesh node. Runs the p2p routing layer and exposes the
// HTTP/WebSocket gateway. Application services connect to this node — they
// don't embed the library themselves.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"

	"distributed-pub-sub/pubsub"
)

func main() {
	httpAddr := flag.String("http", ":8080", "HTTP gateway listen address")
	grpcAddr := flag.String("grpc", ":9000", "internal gRPC listen address")
	advertise := flag.String("advertise", "127.0.0.1:9000", "address peers use to reach this node")
	seeds := flag.String("seeds", "", "comma-separated seed node addresses")
	flag.Parse()

	var seedList []string
	if *seeds != "" {
		seedList = strings.Split(*seeds, ",")
	}

	node, err := pubsub.New(pubsub.Options{
		ListenAddr:    *grpcAddr,
		AdvertiseAddr: *advertise,
		Seeds:         seedList,
		EnableDLQ:     true,
		QueueFactory:  pubsub.MemoryQueueFactory(),
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := node.Start(ctx); err != nil {
		log.Fatal(err)
	}
	defer node.Stop()

	gw := pubsub.NewGateway(node)

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt)
		<-sigCh
		log.Println("shutting down node")
		cancel()
		os.Exit(0)
	}()

	log.Printf("mesh node — HTTP %s, gRPC %s, advertise %s", *httpAddr, *grpcAddr, *advertise)
	if len(seedList) > 0 {
		log.Printf("seeds: %v", seedList)
	}
	log.Fatal(http.ListenAndServe(*httpAddr, gw))
}
