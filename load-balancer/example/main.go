package main

import (
	"fmt"
	loadbalancer "load-balancer"
	"log"
	"net/http"
	"time"
)

func main() {
	go func() {
		log.Println("starting server1")
		mux := http.NewServeMux()
		mux.HandleFunc("GET /hello", func(w http.ResponseWriter, r *http.Request) {
			name := r.URL.Query().Get("name")
			w.Write(fmt.Appendf(nil, "Hello, %s!", name))
		})

		http.ListenAndServe(":4321", mux)
	}()

	pool := loadbalancer.NewServerPool()
	pool.AddServer(&loadbalancer.Server{
		Name:            "server1",
		Protocol:        "http",
		Host:            "localhost",
		Port:            4321,
		URL:             "http://localhost:4321",
		IsHealthy:       true,
		LastHealthCheck: time.Now(),
	})

	rr := loadbalancer.NewRoundRobin(pool)
	lb := loadbalancer.NewLoadBalancer(rr)
	http.ListenAndServe(":8000", lb)

	select {}
}
