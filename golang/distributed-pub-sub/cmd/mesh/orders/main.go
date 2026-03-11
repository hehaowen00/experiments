// Order service — publishes order events to the mesh via HTTP.
// Simulates an e-commerce backend submitting orders for processing.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"time"
)

type publishReq struct {
	Source  string          `json:"source"`
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload"`
}

var items = []string{"widget", "gadget", "sprocket", "gizmo", "doohickey"}

func main() {
	nodeURL := flag.String("node", "http://localhost:8080", "mesh node HTTP address")
	rate := flag.Duration("rate", 2*time.Second, "order submission interval")
	source := flag.String("source", "order-service", "service identity")
	flag.Parse()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)

	log.Printf("order service publishing to %s every %v", *nodeURL, *rate)

	ticker := time.NewTicker(*rate)
	defer ticker.Stop()

	seq := 0
	for {
		select {
		case <-ticker.C:
			seq++
			order := map[string]any{
				"order_id": fmt.Sprintf("ORD-%04d", seq),
				"item":     items[rand.Intn(len(items))],
				"qty":      rand.Intn(10) + 1,
				"price":    float64(rand.Intn(9000)+1000) / 100.0,
				"ts":       time.Now().UnixMilli(),
			}
			payload, _ := json.Marshal(order)

			body, _ := json.Marshal(publishReq{
				Source:  *source,
				Topic:   "orders.new",
				Payload: payload,
			})

			resp, err := http.Post(*nodeURL+"/publish", "application/json", bytes.NewReader(body))
			if err != nil {
				log.Printf("publish failed: %v", err)
				continue
			}
			resp.Body.Close()
			log.Printf("submitted %s — %dx %s @ $%.2f",
				order["order_id"], order["qty"], order["item"], order["price"])

		case <-sigCh:
			log.Println("order service stopped")
			return
		}
	}
}
