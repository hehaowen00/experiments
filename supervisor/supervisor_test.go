package supervisor_test

import (
	"errors"
	"log"
	"testing"

	"github.com/hehaowen00/workspace/supervisor"
)

func TestSupervisor(t *testing.T) {
	sup := supervisor.New()

	sup.UseEventHandler(func(e *supervisor.Event) {
		log.Printf("received event %+v\n", e)
	})

	sup.Push(&supervisor.Job{
		Name: "job 1",
		Func: func(ctx *supervisor.JobContext) error {
			log.Println("job 1 run")
			return nil
		},
	})

	sup.Push(&supervisor.Job{
		Name: "job 2",
		Func: func(ctx *supervisor.JobContext) error {
			return errors.New("job 2 error")
		},
		Retries: 1,
	})

	sup.Push(&supervisor.Job{
		Name: "job 3",
		Func: func(ctx *supervisor.JobContext) error {
			panic("job 3 recover")
		},
		Retries: 1,
	})

	sup.Push(&supervisor.Job{
		Name: "job 4",
		Func: func(ctx *supervisor.JobContext) error {
			var test any = "hello world"
			val := test.(float64)
			_ = val
			return nil
		},
		Retries: 1,
	})

	sup.Run()
}
