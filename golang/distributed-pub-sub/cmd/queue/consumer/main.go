package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"os"
	"os/signal"
	"time"

	"distributed-pub-sub/pubsub"
)

func main() {
	grpcAddr := flag.String("grpc", ":19200", "gRPC listen address")
	advertise := flag.String("advertise", "127.0.0.1:19200", "advertise address")
	seeds := flag.String("seeds", "", "comma-separated seed addresses")
	topic := flag.String("topic", "jobs", "topic to consume from")
	consumer := flag.String("id", "consumer-1", "consumer identity")
	failRate := flag.Float64("fail-rate", 0.0, "probability of simulated failure (0.0-1.0)")
	queueDir := flag.String("queue-dir", "", "directory for disk-backed overflow queue (empty = in-memory)")
	flag.Parse()

	var seedList []string
	if *seeds != "" {
		for _, s := range splitComma(*seeds) {
			seedList = append(seedList, s)
		}
	}

	var qf pubsub.QueueFactory
	if *queueDir != "" {
		qf = pubsub.FileQueueFactory(*queueDir)
		log.Printf("using disk-backed queue at %s", *queueDir)
	} else {
		qf = pubsub.MemoryQueueFactory()
	}

	node, err := pubsub.New(pubsub.Options{
		ListenAddr:    *grpcAddr,
		AdvertiseAddr: *advertise,
		Seeds:         seedList,
		BufferSize:    16,
		MaxRetries:    2,
		RetryInterval: 500 * time.Millisecond,
		EnableDLQ:     true,
		QueueFactory:  qf,
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

	// Subscribe to the work topic
	node.Subscribe(*topic, *consumer, func(_ context.Context, m *pubsub.Message) error {
		var job map[string]any
		json.Unmarshal(m.Payload, &job)

		jobID, _ := job["job_id"].(string)
		task, _ := job["task"].(string)

		// Simulate random failures
		if *failRate > 0 && rand.Float64() < *failRate {
			log.Printf("[FAIL] job %s (%s) — simulated failure", jobID, task)
			return fmt.Errorf("simulated failure")
		}

		// Simulate processing time
		time.Sleep(100 * time.Millisecond)
		log.Printf("[OK]   job %s (%s) processed", jobID, task)
		return nil
	})

	// Subscribe to the DLQ to log failed messages
	node.Subscribe("_dlq."+*topic, *consumer+"-dlq", func(_ context.Context, m *pubsub.Message) error {
		var job map[string]any
		json.Unmarshal(m.Payload, &job)
		jobID, _ := job["job_id"].(string)
		log.Printf("[DLQ]  job %s dead-lettered after exhausting retries", jobID)
		return nil
	})

	log.Printf("consumer %s listening on %q (fail-rate=%.0f%%, dlq=enabled)", *consumer, *topic, *failRate*100)

	// Print stats periodically
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				s := node.Stats()
				log.Printf("[STATS] delivered=%d retries=%d dead_lettered=%d dropped=%d overflowed=%d",
					s.Delivered, s.DeliveryRetries, s.DeadLettered, s.Dropped, s.Overflowed)
			case <-ctx.Done():
				return
			}
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	<-sigCh

	log.Println("shutting down consumer")
	s := node.Stats()
	log.Printf("[FINAL] delivered=%d retries=%d dead_lettered=%d dropped=%d overflowed=%d",
		s.Delivered, s.DeliveryRetries, s.DeadLettered, s.Dropped, s.Overflowed)
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
