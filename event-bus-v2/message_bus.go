package eventbusv2

import (
	"context"
	"sync"
)

type MessageBus[T any] struct {
	incoming    chan Message[T]
	topics      map[string][]string
	subscribers map[string]chan T
	ctx         context.Context
	cancel      context.CancelFunc
	rw          sync.RWMutex
}

func NewMessageBus[T any]() *MessageBus[T] {
	ctx, cancel := context.WithCancel(context.Background())

	ev := &MessageBus[T]{
		incoming:    make(chan Message[T], 16),
		subscribers: make(map[string]chan T, 8),
		topics:      make(map[string][]string, 8),
		ctx:         ctx,
		cancel:      cancel,
	}

	go ev.run()

	return ev
}

func (ev *MessageBus[T]) run() {
	for {
		select {
		case <-ev.ctx.Done():
			return
		case event := <-ev.incoming:
			ev.rw.RLock()

			if event.dest != "" {
				if ch, ok := ev.subscribers[event.dest]; ok {
					select {
					case ch <- event.payload:
					default:
					}
				}
			}

			if event.topic != "" {
				if subs, ok := ev.topics[event.topic]; ok {
					for _, name := range subs {
						if ch, ok := ev.subscribers[name]; ok {
							select {
							case ch <- event.payload:
							default:
							}
						}
					}
				}
			}

			ev.rw.RUnlock()
		}
	}
}

func (ev *MessageBus[T]) IsClosed() error {
	return ev.ctx.Err()
}

func (ev *MessageBus[T]) Stop() error {
	select {
	case <-ev.ctx.Done():
		return ErrClosed
	default:
		ev.cancel()
		return nil
	}
}

func (ev *MessageBus[T]) Subscribe(name string, topic string) (chan T, error) {
	ev.rw.Lock()
	defer ev.rw.Unlock()

	select {
	case <-ev.ctx.Done():
		return nil, ErrClosed
	default:
	}

	ch := make(chan T, 16)
	ev.subscribers[name] = ch
	if topic != "" {
		ev.topics[topic] = append(ev.topics[topic], name)
	}
	return ch, nil
}

func (ev *MessageBus[T]) Unsubscribe(name string, ch chan T) {
	ev.rw.Lock()
	defer ev.rw.Unlock()

	if _, ok := ev.subscribers[name]; ok {
		delete(ev.subscribers, name)
		close(ch)
	}

	for topic, subs := range ev.topics {
		newSubs := make([]string, 0, len(subs))
		for _, sub := range subs {
			if sub != name {
				newSubs = append(newSubs, sub)
			}
		}
		if len(newSubs) == 0 {
			delete(ev.topics, topic)
		} else {
			ev.topics[topic] = newSubs
		}
	}
}

func (ev *MessageBus[T]) Publish(msg Message[T]) error {
	select {
	case <-ev.ctx.Done():
		return ErrClosed
	case ev.incoming <- msg:
		return nil
	}
}

type Message[T any] struct {
	dest    string
	topic   string
	payload T
}

func NewDirectMessage[T any](dest string, payload T) Message[T] {
	return Message[T]{
		dest:    dest,
		payload: payload,
	}
}

func NewTopicMessage[T any](topic string, payload T) Message[T] {
	return Message[T]{
		topic:   topic,
		payload: payload,
	}
}
