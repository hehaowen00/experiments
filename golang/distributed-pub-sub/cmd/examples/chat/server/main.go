package main

import (
	"bufio"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"distributed-pub-sub/pubsub/pb"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// chatMessage is the structured format for all messages on the room topic.
type chatMessage struct {
	Type    string `json:"type"`              // "chat", "system", "kick"
	From    string `json:"from,omitempty"`    // sender name
	Content string `json:"content,omitempty"` // message text
	Target  string `json:"target,omitempty"`  // for kick: target username
}

// grpcConn manages a gRPC connection to a node with reconnect support.
type grpcConn struct {
	mu     sync.Mutex
	conn   *grpc.ClientConn
	client pb.PubSubServiceClient
	nodes  []string // list of node gRPC addresses
	idx    int
}

func newGRPCConn(nodes []string) *grpcConn {
	return &grpcConn{nodes: nodes}
}

func (g *grpcConn) connect() error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.conn != nil {
		g.conn.Close()
	}

	// Try each node in round-robin order.
	for range len(g.nodes) {
		addr := g.nodes[g.idx%len(g.nodes)]
		g.idx++

		conn, err := grpc.NewClient(addr,
			grpc.WithTransportCredentials(insecure.NewCredentials()),
		)
		if err != nil {
			log.Printf("failed to dial %s: %v", addr, err)
			continue
		}

		g.conn = conn
		g.client = pb.NewPubSubServiceClient(conn)
		log.Printf("connected to node %s", addr)
		return nil
	}

	return fmt.Errorf("all nodes unavailable")
}

// connectTo dials a specific address (used for redirects).
func (g *grpcConn) connectTo(addr string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	if g.conn != nil {
		g.conn.Close()
	}

	conn, err := grpc.NewClient(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return fmt.Errorf("failed to dial %s: %w", addr, err)
	}

	g.conn = conn
	g.client = pb.NewPubSubServiceClient(conn)

	// Add to the node list if not already present.
	found := false
	for _, n := range g.nodes {
		if n == addr {
			found = true
			break
		}
	}
	if !found {
		g.nodes = append(g.nodes, addr)
	}

	log.Printf("connected to node %s (redirected)", addr)
	return nil
}

func (g *grpcConn) connectWithRetry() {
	backoff := time.Second
	for {
		if err := g.connect(); err != nil {
			log.Printf("connect failed: %v (retrying in %s)", err, backoff)
			time.Sleep(backoff)
			if backoff < 10*time.Second {
				backoff *= 2
			}
			continue
		}
		return
	}
}

func (g *grpcConn) getClient() pb.PubSubServiceClient {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.client
}

func (g *grpcConn) close() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.conn != nil {
		g.conn.Close()
	}
}

func main() {
	nodes := flag.String("nodes", "localhost:9001", "comma-separated node gRPC addresses")
	room := flag.String("room", "chat", "chat room / topic name")
	name := flag.String("name", "server", "display name for messages")
	service := flag.String("service", "chat", "service name for registration")
	flag.Parse()

	nodeList := strings.Split(*nodes, ",")
	for i := range nodeList {
		nodeList[i] = strings.TrimSpace(nodeList[i])
	}

	gc := newGRPCConn(nodeList)
	gc.connectWithRetry()
	defer gc.close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Register with the node. Handle redirects.
	for {
		client := gc.getClient()
		resp, err := client.Register(ctx, &pb.RegisterRequest{
			ServiceName: *service,
			ServerName:  *name,
		})
		if err != nil {
			log.Printf("registration failed: %v", err)
			break // proceed anyway
		}
		if resp.Accepted {
			log.Printf("registered as %s/%s on current node", *service, *name)
			defer func() {
				c := gc.getClient()
				if c != nil {
					dctx, dcancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer dcancel()
					c.Unregister(dctx, &pb.UnregisterRequest{
						ServiceName: *service,
						ServerName:  *name,
					})
					log.Printf("unregistered %s/%s", *service, *name)
				}
			}()
			break
		}
		// Redirected — reconnect to the specified node.
		log.Printf("redirected to node %s (%s)", resp.RedirectNodeId, resp.RedirectAddress)
		if err := gc.connectTo(resp.RedirectAddress); err != nil {
			log.Printf("redirect connect failed: %v, staying on current node", err)
			break
		}
	}

	kicked := make(chan struct{})

	// Subscribe loop — reconnects on stream error.
	go func() {
		for {
			client := gc.getClient()
			if client == nil {
				gc.connectWithRetry()
				continue
			}

			stream, err := client.SubscribeTopic(ctx, &pb.SubscribeRequest{Topic: *room})
			if err != nil {
				log.Printf("subscribe error: %v, reconnecting...", err)
				gc.connectWithRetry()
				continue
			}

			log.Printf("subscribed to room %q", *room)

			for {
				msg, err := stream.Recv()
				if err != nil {
					if ctx.Err() != nil {
						return // shutting down
					}
					log.Printf("stream error: %v, reconnecting...", err)
					gc.connectWithRetry()
					break
				}

				var cm chatMessage
				if err := json.Unmarshal(msg.Payload, &cm); err != nil {
					fmt.Printf("%s\n", string(msg.Payload))
					continue
				}

				switch cm.Type {
				case "chat":
					fmt.Printf("%s: %s\n", cm.From, cm.Content)
				case "system":
					fmt.Printf("*** %s\n", cm.Content)
				case "kick":
					fmt.Printf("*** %s kicked %s\n", cm.From, cm.Target)
					if cm.Target == *name {
						fmt.Println("*** You have been kicked from the room.")
						close(kicked)
						return
					}
				}
			}
		}
	}()

	// Stdin loop: read and publish messages.
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		fmt.Printf("Chat room %q (you are %s). Type /help for commands.\n", *room, *name)
		for scanner.Scan() {
			text := strings.TrimSpace(scanner.Text())
			if text == "" {
				continue
			}

			var payload []byte

			switch {
			case text == "/help":
				fmt.Println("Commands:")
				fmt.Println("  /rename <name>  — change your display name")
				fmt.Println("  /kick <name>    — kick a user from the room")
				continue

			case strings.HasPrefix(text, "/rename "):
				newName := strings.TrimSpace(strings.TrimPrefix(text, "/rename "))
				if newName == "" {
					fmt.Println("Usage: /rename <name>")
					continue
				}
				oldName := *name
				*name = newName
				cm := chatMessage{Type: "system", Content: fmt.Sprintf("%s is now known as %s", oldName, newName)}
				payload, _ = json.Marshal(cm)

			case strings.HasPrefix(text, "/kick "):
				target := strings.TrimSpace(strings.TrimPrefix(text, "/kick "))
				if target == "" {
					fmt.Println("Usage: /kick <name>")
					continue
				}
				cm := chatMessage{Type: "kick", From: *name, Target: target}
				payload, _ = json.Marshal(cm)

			default:
				if strings.HasPrefix(text, "/") {
					fmt.Printf("Unknown command: %s (type /help)\n", text)
					continue
				}
				cm := chatMessage{Type: "chat", From: *name, Content: text}
				payload, _ = json.Marshal(cm)
			}

			client := gc.getClient()
			if client == nil {
				log.Printf("not connected, message dropped")
				continue
			}
			_, err := client.PublishMessage(ctx, &pb.PublishRequest{
				Topic:   *room,
				Payload: payload,
			})
			if err != nil {
				log.Printf("publish error: %v", err)
			}
		}
	}()

	// Wait for interrupt signal or kick.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	select {
	case <-sigCh:
	case <-kicked:
	}

	fmt.Println("\nbye!")
}
