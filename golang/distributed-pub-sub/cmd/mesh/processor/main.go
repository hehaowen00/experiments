// Processor service — subscribes to orders.validated via WebSocket,
// simulates fulfillment, and publishes to orders.completed via HTTP.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/gorilla/websocket"
)

type serverMsg struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	Source  string          `json:"source"`
	Payload json.RawMessage `json:"payload"`
}

type publishReq struct {
	Source  string          `json:"source"`
	Topic   string          `json:"topic"`
	Payload json.RawMessage `json:"payload"`
}

func main() {
	nodeURL := flag.String("node", "http://localhost:8080", "mesh node HTTP address")
	source := flag.String("source", "processor", "service identity")
	flag.Parse()

	wsURL := wsAddr(*nodeURL) + "/subscribe?topic=orders.validated&id=" + *source
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		log.Fatalf("connect failed: %v", err)
	}
	defer conn.Close()

	log.Printf("processor connected to %s, subscribing to orders.validated", *nodeURL)

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt)
		<-sigCh
		conn.Close()
		os.Exit(0)
	}()

	for {
		_, raw, err := conn.ReadMessage()
		if err != nil {
			log.Fatalf("read error: %v", err)
		}

		var msg serverMsg
		if err := json.Unmarshal(raw, &msg); err != nil || msg.Type != "message" {
			continue
		}

		var order map[string]any
		json.Unmarshal(msg.Payload, &order)

		orderID, _ := order["order_id"].(string)
		item, _ := order["item"].(string)
		total, _ := order["total"].(float64)

		// Simulate processing time
		log.Printf("[PROCESSING] %s — %s ($%.2f)", orderID, item, total)
		time.Sleep(500 * time.Millisecond)

		order["processed_by"] = *source
		order["completed_at"] = time.Now().UnixMilli()
		payload, _ := json.Marshal(order)

		body, _ := json.Marshal(publishReq{Source: *source, Topic: "orders.completed", Payload: payload})
		resp, err := http.Post(*nodeURL+"/publish", "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("publish failed: %v", err)
			continue
		}
		resp.Body.Close()

		log.Printf("[COMPLETED]  %s", orderID)
	}
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
