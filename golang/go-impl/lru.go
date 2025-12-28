package go_impl

import (
	"cmp"
	"fmt"
)

type LRU[K cmp.Ordered, V any] struct {
	values   []V
	keys     []K
	counts   []int8
	capacity int
	len      int
}

func NewLRU[K cmp.Ordered, V any](capacity int) *LRU[K, V] {
	return &LRU[K, V]{
		capacity: capacity,
		keys:     make([]K, capacity),
		values:   make([]V, capacity),
	}
}

func (l *LRU[K, V]) Get(key *K) (*V, bool) {
	for i := range l.keys {
		if l.keys[i] == *key {
			val := l.values[i]

			Shift(l.values, i, l.len-2)
			Shift(l.keys, i, l.len-2)

			l.keys[l.len-1] = *key
			l.values[l.len-1] = val

			return &val, true
		}
	}

	return nil, false
}

func (l *LRU[K, V]) Put(key K, value V) {
	idx := -1
	for i := range l.len {
		if l.keys[i] == key {
			idx = i
		}
	}

	if idx != -1 {
		l.values[idx] = value
	} else {
		if l.len == l.capacity {
			Shift(l.keys, 0, l.len-1)
			Shift(l.values, 0, l.len-1)
			l.len -= 1
		}

		l.len += 1
		l.keys[l.len-1] = key
		l.values[l.len-1] = value
	}
}

func (l *LRU[K, V]) Log() {
	fmt.Print("[")
	for k, v := range Zip(l.keys, l.values) {
		fmt.Printf("(%v, %v) ", k, v)
	}
	fmt.Print("]\n")
}
