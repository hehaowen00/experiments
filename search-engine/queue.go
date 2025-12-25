package main

import (
	"container/heap"
	"slices"
	"time"
)

type queue[T any] struct {
	data  []Entry[T]
	data2 heap.Interface
}

func (q *queue[T]) insert(e Entry[T]) {
	r, _ := slices.BinarySearchFunc(
		q.data,
		e.Expiry,
		func(e Entry[T], target time.Time) int {
			return e.Expiry.Compare(target)
		})

	q.data = slices.Insert(q.data, r, e)
}

func (q *queue[T]) next() (time.Time, bool) {
	if len(q.data) == 0 {
		return time.Time{}, false
	}

	return q.data[0].Expiry, true
}

func (q *queue[T]) get() *Entry[T] {
	if len(q.data) == 0 {
		return nil
	}

	t := q.data[0]
	q.data = q.data[1:]

	return &t
}
