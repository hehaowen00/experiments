package eventbusv2

import (
	"context"
	"errors"
	"sync"
)

var (
	ErrClosed = errors.New("event bus closed")
)

type EventBus[T any] struct {
	incoming chan T
	// subscribers []chan T
	subscribers map[chan T]struct{}
	// isClosed    bool
	ctx    context.Context
	cancel context.CancelFunc
	rw     sync.RWMutex
}

func NewEventBus[T any]() *EventBus[T] {
	ctx, cancel := context.WithCancel(context.Background())

	ev := &EventBus[T]{
		incoming:    make(chan T, 16),
		subscribers: make(map[chan T]struct{}, 8),
		ctx:         ctx,
		cancel:      cancel,
	}

	go ev.run()

	return ev
}

func (ev *EventBus[T]) run() {
	for {
		select {
		case <-ev.ctx.Done():
			return
		case event := <-ev.incoming:
			ev.rw.RLock()
			for ch := range ev.subscribers {
				select {
				case ch <- event:
				default:
				}
			}
			ev.rw.RUnlock()
		}
	}
}

func (ev *EventBus[T]) IsClosed() error {
	return ev.ctx.Err()
}

func (ev *EventBus[T]) Stop() error {
	select {
	case <-ev.ctx.Done():
		return ErrClosed
	default:
		ev.cancel()
		return nil
	}
}

func (ev *EventBus[T]) Subscribe() (chan T, error) {
	ev.rw.Lock()
	defer ev.rw.Unlock()

	// if ev.isClosed {
	// 	return nil
	// }

	// ev.subscribers = append(ev.subscribers, ch)

	select {
	case <-ev.ctx.Done():
		return nil, ErrClosed
	default:
	}

	ch := make(chan T, 16)
	ev.subscribers[ch] = struct{}{}

	return ch, nil
}

func (ev *EventBus[T]) Unsubscribe(ch chan T) {
	ev.rw.Lock()
	defer ev.rw.Unlock()

	// if ev.isClosed {
	// 	return
	// }

	// for i := range ev.subscribers {
	// 	val := ev.subscribers[i]
	// 	if val == ch {
	// 		ev.subscribers = append(ev.subscribers[:i], ev.subscribers[i+1:]...)
	// 		close(val)
	// 	}
	// }

	if _, ok := ev.subscribers[ch]; ok {
		delete(ev.subscribers, ch)
		close(ch)
	}
}

func (ev *EventBus[T]) Publish(event T) error {
	ev.rw.RLock()
	defer ev.rw.RUnlock()

	// if ev.isClosed {
	// 	return
	// }

	// for _, ch := range ev.subscribers {
	// 	go func(ch chan T) {
	// 		select {
	// 		case ch <- event:
	// 		default:
	// 		}
	// 	}(ch)
	// }

	select {
	case <-ev.ctx.Done():
		return ErrClosed
	case ev.incoming <- event:
		return nil
	}
}
