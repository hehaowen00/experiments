// Interactive distributed hashmap demo. Run multiple instances to form a
// replicated cluster:
//
//	go run ./cmd/hashmap -grpc :9000 -advertise 127.0.0.1:9000
//	go run ./cmd/hashmap -grpc :9001 -advertise 127.0.0.1:9001 -seeds 127.0.0.1:9000
//	go run ./cmd/hashmap -grpc :9002 -advertise 127.0.0.1:9002 -seeds 127.0.0.1:9000
//
// Commands: set <key> <value>, get <key>, del <key>, keys, dump, quit
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
	"sort"
	"strings"

	"distributed-pub-sub/hashmap"
	"distributed-pub-sub/pubsub"
)

func main() {
	grpcAddr := flag.String("grpc", ":9000", "internal gRPC listen address")
	advertise := flag.String("advertise", "127.0.0.1:9000", "address peers use to reach this node")
	seeds := flag.String("seeds", "", "comma-separated seed node addresses")
	flag.Parse()

	var seedList []string
	if *seeds != "" {
		seedList = strings.Split(*seeds, ",")
	}

	m, err := hashmap.New(hashmap.Options{
		PubsubOptions: pubsub.Options{
			ListenAddr:    *grpcAddr,
			AdvertiseAddr: *advertise,
			Seeds:         seedList,
			QueueFactory:  pubsub.MemoryQueueFactory(),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	if err := m.Start(ctx); err != nil {
		log.Fatal(err)
	}
	defer m.Stop()

	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, os.Interrupt)
		<-sigCh
		fmt.Println("\nshutting down")
		cancel()
		m.Stop()
		os.Exit(0)
	}()

	log.Printf("distributed hashmap — gRPC %s, advertise %s", *grpcAddr, *advertise)
	if len(seedList) > 0 {
		log.Printf("seeds: %v", seedList)
	}
	fmt.Println("commands: set <key> <json-value>, get <key>, del <key>, keys, dump, quit")

	scanner := bufio.NewScanner(os.Stdin)
	fmt.Print("> ")
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			fmt.Print("> ")
			continue
		}

		parts := strings.SplitN(line, " ", 3)
		cmd := strings.ToLower(parts[0])

		switch cmd {
		case "set":
			if len(parts) < 3 {
				fmt.Println("usage: set <key> <json-value>")
				break
			}
			key := parts[1]
			value := json.RawMessage(parts[2])
			if !json.Valid(value) {
				// Treat as a plain string
				value, _ = json.Marshal(parts[2])
			}
			if err := m.Set(ctx, key, value); err != nil {
				fmt.Printf("error: %v\n", err)
			} else {
				fmt.Printf("OK (%d keys)\n", m.Len())
			}

		case "get":
			if len(parts) < 2 {
				fmt.Println("usage: get <key>")
				break
			}
			val, ok := m.Get(parts[1])
			if !ok {
				fmt.Println("(not found)")
			} else {
				fmt.Println(string(val))
			}

		case "del", "delete":
			if len(parts) < 2 {
				fmt.Println("usage: del <key>")
				break
			}
			if err := m.Delete(ctx, parts[1]); err != nil {
				fmt.Printf("error: %v\n", err)
			} else {
				fmt.Println("OK")
			}

		case "keys":
			keys := m.Keys()
			sort.Strings(keys)
			if len(keys) == 0 {
				fmt.Println("(empty)")
			} else {
				for _, k := range keys {
					fmt.Println(k)
				}
			}

		case "dump":
			snap := m.Snapshot()
			if len(snap) == 0 {
				fmt.Println("(empty)")
			} else {
				keys := make([]string, 0, len(snap))
				for k := range snap {
					keys = append(keys, k)
				}
				sort.Strings(keys)
				for _, k := range keys {
					fmt.Printf("%s = %s\n", k, snap[k])
				}
			}

		case "quit", "exit":
			return

		default:
			fmt.Println("unknown command:", cmd)
		}

		fmt.Print("> ")
	}
}
