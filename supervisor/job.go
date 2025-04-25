package supervisor

import (
	"context"
	"time"
)

type Job struct {
	Name    string
	Func    func(ctx *JobContext) error
	Retries int

	failed int
}

type JobContext struct {
	Name string
	Ctx  context.Context
}

type Event struct {
	Name       string
	Status     string
	Err        error
	StackTrace string
	Timestamp  time.Time
	Retry      int
}

type jobError struct {
	err        error
	stacktrace string
}

func (je jobError) Error() string {
	return je.err.Error()
}
