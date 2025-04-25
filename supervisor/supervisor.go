package supervisor

import (
	"context"
	"fmt"
	"log"
	"runtime"
	"sync"
	"time"
)

type Supervisor struct {
	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once

	retryJobs    []*Job
	jobsChan     chan *Job
	mu           sync.Mutex
	eventHandler func(*Event)
}

func New(bufferSize ...int) *Supervisor {
	chanSize := 32
	if len(bufferSize) == 1 {
		chanSize = bufferSize[0]
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &Supervisor{
		ctx:    ctx,
		cancel: cancel,

		jobsChan: make(chan *Job, chanSize),
		eventHandler: func(e *Event) {
		},
	}
}

func (s *Supervisor) UseEventHandler(handler func(*Event)) {
	s.eventHandler = handler
}

func (s *Supervisor) Ctx() context.Context {
	return s.ctx
}

func (s *Supervisor) Stop() {
	s.once.Do(func() {
		s.cancel()
	})
}

func (s *Supervisor) Push(job *Job) {
	s.jobsChan <- job
}

func (s *Supervisor) Run() {
	ticker := time.NewTimer(time.Second * 5)

	for {
		select {
		case <-s.ctx.Done():
			return
		case <-ticker.C:
			s.mu.Lock()

			if len(s.retryJobs) > 0 {
				log.Println("[supervisor] retrying jobs")

				go func() {
					jobs := s.retryJobs
					s.retryJobs = nil

					for _, job := range jobs {
						s.jobsChan <- job
					}
					s.mu.Unlock()
				}()
			}
		case job, ok := <-s.jobsChan:
			if !ok {
				return
			}

			s.handleJob(job)
		}
	}
}

func (s *Supervisor) handleJob(job *Job) {
	err := s.runJob(job)

	evt := &Event{
		Name:      job.Name,
		Status:    "finished",
		Err:       err,
		Retry:     job.Retries,
		Timestamp: time.Now(),
	}

	if err != nil {
		evt.Status = "error"

		if je, ok := err.(jobError); ok {
			evt.Status = "panic"
			evt.StackTrace = je.stacktrace
			evt.Err = je.err
		}

		if job.Retries > 0 {
			job.Retries -= 1

			s.retryJobs = append(s.retryJobs, job)
		}
	}

	s.eventHandler(evt)
}

func (s *Supervisor) runJob(job *Job) (err error) {
	defer func() {
		if r := recover(); r != nil {
			buf := make([]byte, 512)

			for {
				n := runtime.Stack(buf, false)
				if n < len(buf) {
					buf = buf[:n]
					break
				}
				buf = make([]byte, len(buf)*2)
			}

			stackTrace := string(buf)

			switch m := r.(type) {
			case error:
			default:
				err = fmt.Errorf("panic recovered - %w", fmt.Errorf("%v", m))
			}

			err = jobError{
				err:        err,
				stacktrace: stackTrace,
			}
		}
	}()

	ctx := &JobContext{
		Name: job.Name,
		Ctx:  context.Background(),
	}

	err = job.Func(ctx)

	return err
}
