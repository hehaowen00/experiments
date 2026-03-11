package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"time"

	"distributed-pub-sub/pubsub"
)

func main() {
	grpcAddr := flag.String("grpc", ":19100", "gRPC listen address")
	advertise := flag.String("advertise", "127.0.0.1:19100", "advertise address")
	seeds := flag.String("seeds", "", "comma-separated seed addresses")
	topic := flag.String("topic", "jobs", "topic to publish to")
	rate := flag.Duration("rate", time.Second, "interval between messages")
	source := flag.String("source", "producer-1", "producer identity")
	flag.Parse()

	var seedList []string
	if *seeds != "" {
		for _, s := range splitComma(*seeds) {
			seedList = append(seedList, s)
		}
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

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)

	log.Printf("producer %s publishing to %q every %v", *source, *topic, *rate)

	ticker := time.NewTicker(*rate)
	defer ticker.Stop()

	seq := 0
	for {
		select {
		case <-ticker.C:
			seq++
			payload, _ := json.Marshal(map[string]any{
				"job_id": fmt.Sprintf("%s-%d", *source, seq),
				"task":   fmt.Sprintf("process-item-%d", seq),
				"ts":     time.Now().UnixMilli(),
			})
			id, err := node.Publish(ctx, *source, *topic, payload)
			if err != nil {
				log.Printf("publish failed: %v", err)
				continue
			}
			log.Printf("published job %d (msg %s)", seq, id[:8])

		case <-sigCh:
			log.Println("shutting down producer")
			return
		}
	}
}

func splitComma(s string) []string {
	var out []string
	for _, p := range split(s, ',') {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func split(s string, sep byte) []string {
	var parts []string
	start := 0
	for i := range len(s) {
		if s[i] == sep {
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	parts = append(parts, s[start:])
	return parts
}
