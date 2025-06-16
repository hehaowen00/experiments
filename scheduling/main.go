package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"sync"
	"time"
)

func makeTime(ts time.Time, t time.Time, loc *time.Location) time.Time {
	return time.Date(ts.Year(), ts.Month(), ts.Day(), t.Hour(), t.Minute(), 0, 0, loc)
}

type Scheduling struct {
	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once

	onStart func()
	onEnd   func()
	loc     *time.Location
	start   time.Time
	end     time.Time
	mu      sync.Mutex
}

func NewScheduling(tz string, onStart, onEnd func()) *Scheduling {
	ctx, cancel := context.WithCancel(context.Background())

	loc, err := time.LoadLocation(tz)
	if err != nil {
		panic(err)
	}

	return &Scheduling{
		ctx:    ctx,
		cancel: cancel,
		once:   sync.Once{},

		onStart: onStart,
		onEnd:   onEnd,
		loc:     loc,
	}
}

func (w *Scheduling) Set(start, end string) {
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

}

func (w *Scheduling) Run() {
	startTime := w.start
	endTime := w.end
	// log.Println(startTime)
	// log.Println(endTime)
	// log.Println(startTime.Add(10 * time.Hour))

	var diff time.Duration

	if endTime.Before(startTime) {
		// log.Println("before")
		diff = 24*time.Hour - startTime.Sub(endTime)
		log.Println(startTime.Add(diff), diff)
	} else {
		diff = endTime.Sub(startTime)
	}

	// log.Println("DIFF", diff)

	// log.Println(w.start.Sub(endTime))
	now := time.Now()
	// log.Println("NOW", now)
	nowAdj := now.Add(time.Hour * -24)

	actualStart := makeTime(nowAdj, startTime, w.loc)
	actualEnd := actualStart.Add(diff)
	// log.Println("initial", actualStart, actualEnd)

	if actualEnd.Before(now) {
		actualStart = makeTime(now, startTime, w.loc)
		actualEnd = actualStart.Add(diff)
		// log.Println("new", actualStart, actualEnd)
	}

	if actualStart.Before(now) && actualEnd.Before(now) {
		actualStart = actualStart.Add(24 * time.Hour)
	}
	if actualEnd.Before(now) {
		actualEnd = actualEnd.Add(24 * time.Hour)
	}

	// log.Println("next", actualStart, actualEnd)

	ticker := time.NewTicker(time.Minute * 10)

	for {
		select {
		case <-w.ctx.Done():
			return
			break
		case <-ticker.C:
			w.mu.Lock()
			startTime := w.start
			endTime := w.end
			// log.Println(startTime)
			// log.Println(endTime)
			// log.Println(startTime.Add(10 * time.Hour))

			var diff time.Duration

			if endTime.Before(startTime) {
				// log.Println("before")
				diff = 24*time.Hour - startTime.Sub(endTime)
				log.Println(startTime.Add(diff), diff)
			} else {
				diff = endTime.Sub(startTime)
			}

			// log.Println("DIFF", diff)

			// log.Println(w.start.Sub(endTime))
			now := time.Now()
			// log.Println("NOW", now)
			nowAdj := now.Add(time.Hour * -24)

			actualStart := makeTime(nowAdj, startTime, w.loc)
			actualEnd := actualStart.Add(diff)
			// log.Println("initial", actualStart, actualEnd)

			if actualEnd.Before(now) {
				actualStart = makeTime(now, startTime, w.loc)
				actualEnd = actualStart.Add(diff)
				// log.Println("new", actualStart, actualEnd)
			}

			if actualStart.Before(now) && actualEnd.Before(now) {
				actualStart = actualStart.Add(24 * time.Hour)
			}
			if actualEnd.Before(now) {
				actualEnd = actualEnd.Add(24 * time.Hour)
			}
			w.mu.Unlock()
			continue
			break
		case <-time.After(time.Until(actualStart)):
			w.onStart()
			actualStart = actualStart.Add(time.Hour * 24)
			break
		case <-time.After(time.Until(actualEnd)):
			w.onEnd()
			actualEnd = actualEnd.Add(time.Hour * 24)
			break
		}

		log.Println("new", actualStart, actualEnd)
	}
}

func (w *Scheduling) Stop() {
	w.once.Do(func() {
		w.cancel()
	})
}

func main() {
	w := NewScheduling(
		"Australia/Brisbane",
		func() {
			log.Println("time range start")
		},
		func() {
			log.Println("time range end")
		},
	)
	w.Set("20:52", "10:53")
	w.Run()
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	<-sig
}
