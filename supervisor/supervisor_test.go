package supervisor_test

import (
	"context"
	"log"
	"testing"
	"time"

	"github.com/hehaowen00/workspace/supervisor"
)

func TestSupervisor(t *testing.T) {
	sup := supervisor.NewSupervisorGroup()

	sup.AddWorkerConfig(supervisor.WorkerConfig{
		Key: "worker1",
		Worker: func(ctx context.Context, ch chan any) {
			for {
				select {
				case <-ctx.Done():
					return
				case msg := <-ch:
					log.Printf("worker1 received message: %v\n", msg)
					if s, ok := msg.(string); ok && s == "panic" {
						log.Panicln("worker1 panicked")
					}
				}
			}
		},
		RestartPolicy: supervisor.RestartAlways,
	})

	restartCount := 0

	sup.AddWorkerConfig(supervisor.WorkerConfig{
		Key: "worker2",
		Worker: func(ctx context.Context, ch chan any) {
			restartCount++
			log.Panicln("worker2 panicked", restartCount)
		},
		RestartPolicy: supervisor.RestartLimited,
		RestartCount:  3,
	})

	sup.AddWorkerConfig(supervisor.WorkerConfig{
		Key: "worker3",
		Worker: func(ctx context.Context, ch chan any) {
			log.Panicln("worker3 panicked")
		},
		RestartPolicy: supervisor.RestartNever,
	})

	sup.Send("worker1", "hello worker1")

	time.Sleep(time.Second * 3)
	sup.Stop()
	sup.Wait()
}
