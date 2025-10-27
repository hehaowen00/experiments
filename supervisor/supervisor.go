package supervisor

import (
	"context"
	"fmt"
	"log"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type SupervisorGroup struct {
	workers      map[string]context.CancelFunc
	channels     map[string]chan any
	errorHandler func(err error)
	wg           sync.WaitGroup
	mu           sync.Mutex
	running      atomic.Bool
}

func NewSupervisorGroup() *SupervisorGroup {
	sup := &SupervisorGroup{
		workers:  map[string]context.CancelFunc{},
		channels: map[string]chan any{},
	}

	sup.running.Store(true)

	return sup
}

type WorkerConfig struct {
	Key           string
	Worker        func(ctx context.Context, ch chan any)
	LogStackTrace bool
	RestartPolicy RestartPolicy
	RestartCount  int
}

func (g *SupervisorGroup) AddWorkerConfig(
	config WorkerConfig,
) {
	g.mu.Lock()
	defer g.mu.Unlock()

	cancel_, ok := g.workers[config.Key]
	if ok {
		cancel_()
	}

	ch_, ok := g.channels[config.Key]
	if ok {
		close(ch_)
	}

	ctx, cancel := context.WithCancel(context.Background())
	ch := make(chan any, 1)

	g.workers[config.Key] = cancel
	g.channels[config.Key] = ch
	g.wg.Add(1)

	log.Printf("supervisor: add worker %s - %v - %v \n", config.Key, config.RestartPolicy, config.RestartCount)

	go func(key string) {
		defer g.done(key)

		restartCount := 0

		for {
			err := func() (err error) {
				defer func() {
					r := recover()
					if r != nil {
						log.Println("supervisor: worker quit", r)

						if config.LogStackTrace {
							stackTrace := debug.Stack()
							log.Printf("%s stack trace:\n%s\n", key, stackTrace)
						}

						err = fmt.Errorf("%v", r)
						return
					}

					log.Println("worker stopped", key)
				}()

				config.Worker(ctx, ch)

				return
			}()
			if err != nil {
				log.Println("supervisor: worker panicked", err)
			}

			if ctx.Err() != nil {
				log.Println("supervisor: worker cancelled")
				break
			}

			shouldRestart := false

			switch config.RestartPolicy {
			case RestartAlways:
				shouldRestart = true
			case RestartLimited:
				if restartCount <= config.RestartCount {
					shouldRestart = true
					restartCount++
				}
			case RestartNever:
				shouldRestart = false
			}

			log.Println(key, shouldRestart, ctx.Err())
			shouldRestart = shouldRestart && g.running.Load() && ctx.Err() == nil

			if !shouldRestart {
				break
			}
		}
	}(config.Key)
}

func (g *SupervisorGroup) Cancel(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	cancel := g.workers[key]
	cancel()
}

func (g *SupervisorGroup) Stop() {
	log.Println("supervisor: cancel all")
	g.running.Store(false)

	for key, cancel := range g.workers {
		log.Println("cancelling worker", key)
		cancel()
	}
	g.wg.Wait()
}

// workers whose channel is full will be skipped
func (g *SupervisorGroup) Broadcast(message any) {
	log.Println("supervisor: broadcast", message)

	g.mu.Lock()
	defer g.mu.Unlock()

	for k, ch := range g.channels {
		go func() {
			select {
			case ch <- message:
			case <-time.After(time.Minute):
				log.Println("supervisor: broadcast timeout", k)
			}
		}()
	}
}

// workers whose channel is full will be skipped
func (g *SupervisorGroup) BroadcastWithPrefix(prefix string, message any) {
	log.Println("supervisor: broadcast with prefix", prefix)

	g.mu.Lock()
	defer g.mu.Unlock()

	for k, ch := range g.channels {
		if !strings.HasPrefix(k, prefix) {
			continue
		}

		go func() {
			select {
			case ch <- message:
			case <-time.After(time.Minute):
				log.Println("supervisor: broadcast_prefix timeout", k)
			}
		}()
	}
}

func (g *SupervisorGroup) Send(key string, message any) {
	g.mu.Lock()
	defer g.mu.Unlock()

	ch, ok := g.channels[key]
	if ok {
		go func() {
			select {
			case ch <- message:
			case <-time.After(time.Minute):
				log.Println("supervisor: send timeout", key)
			}
		}()
	}
}

func (g *SupervisorGroup) done(key string) {
	g.mu.Lock()
	defer g.mu.Unlock()

	ch, ok := g.channels[key]
	if ok {
		close(ch)
	}

	delete(g.channels, key)
	delete(g.workers, key)
	g.wg.Done()

	log.Println("supervisor: worker done", key)
}

func (g *SupervisorGroup) Wait() {
	log.Println("supervisor: wait")
	g.wg.Wait()
}
