package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"time"
)

type Scheduling struct {
	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once

	reset   func()
	onStart func()
	onEnd   func()

	started atomic.Bool

	loc   *time.Location
	start time.Time
	end   time.Time
	mu    sync.Mutex
}

func NewScheduling(tz string, reset, onStart, onEnd func()) *Scheduling {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		panic(err)
	}

	sch := &Scheduling{
		reset:   reset,
		onStart: onStart,
		onEnd:   onEnd,
		loc:     loc,
	}

	return sch
}

func (w *Scheduling) Set(start, end string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.started.Load() {
		w.Stop()
	}

	startTime, err := time.Parse("15:04", start)
	if err != nil {
		panic(err)
	}

	endTime, err := time.Parse("15:04", end)
	if err != nil {
		panic(err)
	}

	w.start = startTime
	w.end = endTime

	ctx, cancel := context.WithCancel(context.Background())
	w.ctx = ctx
	w.cancel = cancel
	w.once = sync.Once{}

	time.Sleep(time.Second)
	go w.Run()
}

func (w *Scheduling) Run() {
	w.started.Store(true)
	call(w.reset)

	w.mu.Lock()
	now := time.Now()
	actualStart, actualEnd := calculateTimeRange(w.loc, now, w.start, w.end)
	w.mu.Unlock()

	log.Println("started scheduling", actualStart, actualEnd)

	for {
		startDiff := time.Until(actualStart)
		endDiff := time.Until(actualEnd)

		select {
		case <-w.ctx.Done():
			return

		case <-time.After(startDiff):
			call(w.onStart)
			actualStart = actualStart.Add(time.Hour * 24)
			break

		case <-time.After(endDiff):
			call(w.onEnd)
			actualEnd = actualEnd.Add(time.Hour * 24)
			break
		}
	}
}

func (w *Scheduling) Stop() {
	w.once.Do(func() {
		w.cancel()
		w.started.Store(false)
		time.Sleep(time.Second * 5)
	})
}

func makeTime(
	oldTime time.Time,
	newTime time.Time,
	loc *time.Location,
) time.Time {
	return time.Date(
		oldTime.Year(), oldTime.Month(), oldTime.Day(),
		newTime.Hour(), newTime.Minute(),
		0, 0, loc,
	)
}

func call(fn func()) {
	if fn != nil {
		fn()
	}
}

func calculateTimeRange(
	loc *time.Location,
	now, startTime, endTime time.Time,
) (time.Time, time.Time) {
	var diff time.Duration

	if endTime.Before(startTime) {
		diff = 24*time.Hour - startTime.Sub(endTime)
	} else {
		diff = endTime.Sub(startTime)
	}

	log.Println("range difference", diff)

	nowAdj := now.Add(time.Hour * -24)

	actualStart := makeTime(nowAdj, startTime, loc)
	actualEnd := actualStart.Add(diff)

	if actualEnd.Before(now) {
		actualStart = makeTime(now, startTime, loc)
		actualEnd = actualStart.Add(diff)
	}

	if actualStart.Before(now) && actualEnd.Before(now) {
		actualStart = actualStart.Add(24 * time.Hour)
	}

	if actualEnd.Before(now) {
		actualEnd = actualEnd.Add(24 * time.Hour)
	}

	return actualStart, actualEnd
}

func main() {
	w := NewScheduling(
		"Australia/Brisbane",
		func() {
			log.Println("reset")
		},
		func() {
			log.Println("time range start")
		},
		func() {
			log.Println("time range end")
		},
	)
	w.Set("20:52", "10:53")

	time.Sleep(time.Second * 10)

	w.Set("00:31", "07:00")

	time.Sleep(time.Second * 10)

	w.Set("00:36", "07:00")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	<-sig
}
