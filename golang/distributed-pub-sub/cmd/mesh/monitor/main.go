// Monitor service — subscribes to all order topics via WebSocket and logs
// every event flowing through the pipeline. Useful for observability.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type clientMsg struct {
	Action string `json:"action"`
	Topic  string `json:"topic"`
}

type serverMsg struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Source  string          `json:"source"`
	Payload json.RawMessage `json:"payload"`
	Topic   string          `json:"topic"`
}

func main() {
	nodeURL := flag.String("node", "http://localhost:8080", "mesh node HTTP address")
	flag.Parse()

	wsURL := wsAddr(*nodeURL) + "/subscribe?topic=orders.new&id=monitor"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		log.Fatalf("connect failed: %v", err)
	}
	defer conn.Close()

	// Subscribe to additional topics
	var writeMu sync.Mutex
	extraTopics := []string{"orders.validated", "orders.rejected", "orders.completed", "_dlq.orders.new", "_dlq.orders.validated"}
	for _, t := range extraTopics {
		writeMu.Lock()
		conn.WriteJSON(clientMsg{Action: "subscribe", Topic: t})
		writeMu.Unlock()
	}

	log.Printf("monitor connected to %s — watching all order topics", *nodeURL)

	// Track counts
	var mu sync.Mutex
	counts := map[string]int{}

	// Print summary periodically
	go func() {
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			mu.Lock()
			if len(counts) > 0 {
				log.Printf("[SUMMARY] %v", counts)
			}
			mu.Unlock()
		}
	}()

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt)
		<-sigCh
		mu.Lock()
		log.Printf("[FINAL] %v", counts)
		mu.Unlock()
		conn.Close()
		os.Exit(0)
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			log.Fatalf("disconnected: %v", err)
		}

		var msg serverMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "message":
			var order map[string]any
			json.Unmarshal(msg.Payload, &order)
			orderID, _ := order["order_id"].(string)

			// Figure out which topic this came from by inspecting the payload
			topic := identifyTopic(order)

			mu.Lock()
			counts[topic]++
			mu.Unlock()

			switch topic {
			case "orders.new":
				item, _ := order["item"].(string)
				qty, _ := order["qty"].(float64)
				fmt.Printf("  NEW        %s — %0.fx %s\n", orderID, qty, item)
			case "orders.validated":
				total, _ := order["total"].(float64)
				fmt.Printf("  VALIDATED  %s — $%.2f\n", orderID, total)
			case "orders.rejected":
				reason, _ := order["rejection_reason"].(string)
				fmt.Printf("  REJECTED   %s — %s\n", orderID, reason)
			case "orders.completed":
				fmt.Printf("  COMPLETED  %s\n", orderID)
			default:
				fmt.Printf("  DLQ        %s — dead lettered\n", orderID)
			}

		case "subscribed":
			log.Printf("subscribed to %s", msg.Topic)
		case "error":
			log.Printf("error: %s", raw)
		}
	}
}

// identifyTopic infers the pipeline stage from the payload fields.
func identifyTopic(order map[string]any) string {
	if _, ok := order["completed_at"]; ok {
		return "orders.completed"
	}
	if _, ok := order["rejection_reason"]; ok {
		return "orders.rejected"
	}
	if _, ok := order["validated_by"]; ok {
		return "orders.validated"
	}
	return "orders.new"
}

func wsAddr(httpURL string) string {
	if len(httpURL) > 7 && httpURL[:7] == "http://" {
		return "ws://" + httpURL[7:]
	}
	if len(httpURL) > 8 && httpURL[:8] == "https://" {
		return "wss://" + httpURL[8:]
	}
	return httpURL
}
