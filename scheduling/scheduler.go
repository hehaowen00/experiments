package scheduling

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"
)

type TimeScheduler struct {
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
) *TimeScheduler {
	sch := &TimeScheduler{
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
func (w *TimeScheduler) Set(tz, start, end string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.started.Load() {
		w.Stop()
	}

	startTime, err := time.Parse("15:04", start)
	if err != nil {
		return fmt.Errorf("failed to parse start time - %w", err)
	}

	endTime, err := time.Parse("15:04", end)
	if err != nil {
		return fmt.Errorf("failed to parse end time - %w", err)
	}

	loc, err := time.LoadLocation(tz)
	if err != nil {
		return err
	}

	w.start = startTime
	w.end = endTime
	w.loc = loc

	ctx, cancel := context.WithCancel(context.Background())
	w.ctx = ctx
	w.cancel = cancel
	w.once = sync.Once{}

	time.Sleep(time.Second)
	go w.run()

	return nil
}

func (w *TimeScheduler) Stop() {
	w.once.Do(func() {
		w.cancel()
		w.started.Store(false)
	})

	time.Sleep(time.Second * 5)
}

// should not be called directly
func (w *TimeScheduler) run() {
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
