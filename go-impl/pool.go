package go_impl

import (
	"sync"

	"github.com/hehaowen00/workspace/ring_buffer"
)

type ObjectPool[T any] struct {
	buf   *ring_buffer.RingBuffer[*T]
	limit int
}

func NewPool[T any](size ...int) *ObjectPool[T] {
	bufSize := 32
	if len(size) == 0 {
		bufSize = size[0]
	}

	return &ObjectPool[T]{
		buf:   ring_buffer.New[*T](bufSize),
		limit: bufSize,
	}
}

func (pool *ObjectPool[T]) Acquire() *T {
	if pool.buf.Len() == 0 {
		var item T
		return &item
	}

	return pool.buf.Pop()
}

func (pool *ObjectPool[T]) Release(item *T) {
	if pool.buf.Len() == pool.limit {
		return
	}

	var zero T
	*item = zero
	pool.buf.Push(item)
}

type ConcurrentObjectPool[T any] struct {
	buf   *ring_buffer.RingBuffer[*T]
	limit int
	mu    sync.Mutex
}

func NewConcurrentPool[T any](size ...int) *ObjectPool[T] {
	bufSize := 32
	if len(size) == 0 {
		bufSize = size[0]
	}

	return &ObjectPool[T]{
		buf:   ring_buffer.New[*T](bufSize),
		limit: bufSize,
	}
}

func (pool *ConcurrentObjectPool[T]) Acquire() *T {
	pool.mu.Lock()
	if pool.buf.Len() == 0 {
		var item T
		pool.mu.Unlock()
		return &item
	}

	item := pool.buf.Pop()
	pool.mu.Unlock()

	return item
}

func (pool *ConcurrentObjectPool[T]) Release(item *T) {
	pool.mu.Lock()
	if pool.buf.Len() == pool.limit {
		pool.mu.Unlock()
		return
	}

	var zero T
	*item = zero

	pool.buf.Push(item)
	pool.mu.Unlock()
}
