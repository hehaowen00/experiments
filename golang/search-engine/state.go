package main

import (
	"log"
	"time"
)

func NewChan[T any]() chan T {
	return make(chan T)
}

func Pipeline[D any, R any](input <-chan D, handler func(D) R) <-chan R {
	output := make(chan R)

	go func(output chan R) {
		defer close(output)

		for data := range input {
			result := handler(data)
			output <- result
		}
	}(output)

	return output
}

func PipelineS[D any, R any](input <-chan D, handler func(D) []R) <-chan R {
	output := make(chan R)

	go func(output chan R) {
		defer close(output)

		for data := range input {
			result := handler(data)

			for _, r := range result {
				output <- r
			}
		}
	}(output)

	return output
}

type Entry[T any] struct {
	Data   T
	Expiry time.Time
}

func TimeQueue[T any](input <-chan Entry[T]) <-chan Entry[T] {
	output := make(chan Entry[T])

	go func(input <-chan Entry[T], output chan Entry[T]) {
		defer close(output)

		q := minheap[int64, T]{}
		initMinHeap(&q)
		timer := time.NewTimer(0)

	primary:
		for {
			k, _, ok := q.min()

			var waitCh <-chan time.Time
			if ok {
				timer.Reset(time.Until(time.UnixMilli(k)))
				waitCh = timer.C
			}

			select {
			case m, ok := <-input:
				if !ok {
					timer.Stop()
					break primary
				}

				if timer.Stop() {
					select {
					case <-timer.C:
					default:
					}

					select {
					case <-waitCh:
					default:
					}
				}
				q.insert(m.Expiry.UnixMilli(), m.Data)
				continue primary
			case <-waitCh:
				k, v, ok := q.popmin()
				if ok {
					output <- Entry[T]{
						Data:   v,
						Expiry: time.UnixMilli(k),
					}
				}
				continue primary
			}
		}

		log.Println("time queue stopped")
	}(input, output)

	return output
}
