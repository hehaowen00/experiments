// Validator service — subscribes to orders.new via WebSocket, validates each
// order, and publishes to orders.validated or orders.rejected via HTTP.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"

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

func publish(nodeURL, source, topic string, payload json.RawMessage) {
	body, _ := json.Marshal(publishReq{Source: source, Topic: topic, Payload: payload})
	resp, err := http.Post(nodeURL+"/publish", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("publish to %s failed: %v", topic, err)
		return
	}
	resp.Body.Close()
}

func main() {
	nodeURL := flag.String("node", "http://localhost:8080", "mesh node HTTP address")
	source := flag.String("source", "validator", "service identity")
	flag.Parse()

	wsURL := wsAddr(*nodeURL) + "/subscribe?topic=orders.new&id=" + *source
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		log.Fatalf("connect failed: %v", err)
	}
	defer conn.Close()

	log.Printf("validator connected to %s, subscribing to orders.new", *nodeURL)

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
		qty, _ := order["qty"].(float64)
		price, _ := order["price"].(float64)

		// Validation rules
		if qty <= 0 || price <= 0 {
			order["rejection_reason"] = "invalid quantity or price"
			payload, _ := json.Marshal(order)
			publish(*nodeURL, *source, "orders.rejected", payload)
			log.Printf("[REJECT] %s — invalid qty/price", orderID)
			continue
		}

		total := qty * price
		if total > 500 {
			order["rejection_reason"] = "order exceeds $500 limit"
			payload, _ := json.Marshal(order)
			publish(*nodeURL, *source, "orders.rejected", payload)
			log.Printf("[REJECT] %s — total $%.2f exceeds limit", orderID, total)
			continue
		}

		order["validated_by"] = *source
		order["total"] = total
		payload, _ := json.Marshal(order)
		publish(*nodeURL, *source, "orders.validated", payload)
		log.Printf("[VALID]  %s — %0.fx %s = $%.2f", orderID, qty, order["item"], total)
	}
}

func wsAddr(httpURL string) string {
	// Convert http:// to ws://
	if len(httpURL) > 7 && httpURL[:7] == "http://" {
		return "ws://" + httpURL[7:]
	}
	if len(httpURL) > 8 && httpURL[:8] == "https://" {
		return "wss://" + httpURL[8:]
	}
	return httpURL
}
