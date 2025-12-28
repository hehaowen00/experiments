package scheduling

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

type Scheduler struct {
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

// Creates a new TimeScheduler instance.
func NewTimeScheduler(
	reset, onStart, onEnd func(),
) *Scheduler {
	sch := &Scheduler{
		reset:   reset,
		onStart: onStart,
		onEnd:   onEnd,
	}

	return sch
}

// Set does the following:
//
// - Stops the current scheduling routine if any.
//
// - Sets the new time range.
//
// - Starts up a new scheduling routine.
//
// Can be called more than once.
func (w *Scheduler) Set(tz, start, end string) error {
	log.Println("start new scheduler", tz, start, end)

	w.mu.Lock()

	if w.started.Load() {
		w.Stop()
	}

	startTime, err := time.Parse("15:04", start)
	if err != nil {
		w.mu.Unlock()
		return fmt.Errorf("failed to parse start time - %w", err)
	}

	endTime, err := time.Parse("15:04", end)
	if err != nil {
		w.mu.Unlock()
		return fmt.Errorf("failed to parse end time - %w", err)
	}

	loc, err := time.LoadLocation(tz)
	if err != nil {
		w.mu.Unlock()
		return err
	}

	w.start = startTime
	w.end = endTime
	w.loc = loc

	ctx, cancel := context.WithCancel(context.Background())
	w.ctx = ctx
	w.cancel = cancel
	w.once = sync.Once{}

	w.mu.Unlock()

	go w.run()

	return nil
}

func (w *Scheduler) Stop() {
	w.once.Do(func() {
		if w.started.Load() {
			w.cancel()
			w.started.Store(false)
		}
	})
}

// should not be called directly
func (w *Scheduler) run() {
	w.started.Store(true)
	call(w.reset)

	w.mu.Lock()
	now := time.Now()
	actualStart, actualEnd := calculateTimeRangeV2(w.loc, now, w.start, w.end)
	w.mu.Unlock()
	log.Println("started scheduling", actualStart, actualEnd, w.loc.String())

out:
	for {
		startDiff := time.Until(actualStart)
		endDiff := time.Until(actualEnd)
		log.Println("scheduling time until", startDiff, endDiff)

		select {
		case <-w.ctx.Done():
			log.Println("scheduler exited - reason: context")
			break out
		case <-time.After(startDiff):
			call(w.onStart)
			actualStart = actualStart.AddDate(0, 0, 1)
			// actualStart = actualStart.Add(time.Hour * 24)
		case <-time.After(endDiff):
			call(w.onEnd)
			// actualEnd = actualEnd.Add(time.Hour * 24)
			actualEnd = actualEnd.AddDate(0, 0, 1)
		}
	}

	log.Println("scheduler exited")
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

// func calculateTimeRange(
// 	loc *time.Location,
// 	now, startTime, endTime time.Time,
// ) (time.Time, time.Time) {
// 	var diff time.Duration
//
// 	if endTime.Before(startTime) {
// 		diff = 24*time.Hour - startTime.Sub(endTime)
// 	} else {
// 		diff = endTime.Sub(startTime)
// 	}
//
// 	// nowAdj := now.Add(time.Hour * -24)
// 	nowAdj := now.AddDate(0, 0, 1)
//
// 	actualStart := makeTime(nowAdj, startTime, loc)
// 	actualEnd := actualStart.Add(diff)
//
// 	if actualEnd.Before(now) {
// 		actualStart = makeTime(now, startTime, loc)
// 		actualEnd = actualStart.Add(diff)
// 	}
//
// 	if actualStart.Before(now) && actualEnd.Before(now) {
// 		// actualStart = actualStart.Add(24 * time.Hour)
// 		actualStart = actualStart.AddDate(0, 0, 1)
// 	}
//
// 	if actualEnd.Before(now) {
// 		// actualEnd = actualEnd.Add(24 * time.Hour)
// 		actualEnd = actualEnd.AddDate(0, 0, 1)
// 	}
//
// 	return actualStart, actualEnd
// }

func calculateTimeRangeV2(
	loc *time.Location,
	now time.Time,
	startTime, endTime time.Time,
) (time.Time, time.Time) {
	start := time.Date(now.Year(), now.Month(), now.Day(),
		startTime.Hour(), startTime.Minute(), 0, 0, loc)

	end := time.Date(now.Year(), now.Month(), now.Day(),
		endTime.Hour(), endTime.Minute(), 0, 0, loc)

	if end.Before(start) || end.Equal(start) {
		end = end.AddDate(0, 0, 1)
	}

	if now.After(end) {
		start = start.AddDate(0, 0, 1)
		end = end.AddDate(0, 0, 1)
	}

	if now.Before(start) && now.Before(end) && end.Sub(start) > 12*time.Hour {
		start = start.AddDate(0, 0, -1)
		end = end.AddDate(0, 0, -1)
	}

	return start, end
}
