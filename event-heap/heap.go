package eventtimer

import (
	"cmp"
	"slices"
)

type Event[K any] struct {
	key   K
	delay int64
}

type EventHeap[K any] []*Event[K]

func (h *EventHeap[K]) Len() int {
	return len(*h)
}

func (h *EventHeap[K]) Min() int64 {
	if len(*h) == 0 {
		return -1
	}
	return (*h)[len(*h)-1].delay
}

func (h *EventHeap[K]) Push(evt Event[K]) {
	if len(*h) == 0 {
		(*h) = append((*h), &evt)
		return
	}

	idx, _ := slices.BinarySearchFunc(*h, &evt, func(lhs, rhs *Event[K]) int {
		return cmp.Compare(rhs.delay, lhs.delay)
	})

	*h = slices.Insert(*h, idx, &evt)
}

func (h *EventHeap[K]) Pop() *Event[K] {
	old := *h
	n := len(old)

	evt := old[n-1]
	*h = old[0 : n-1]
	return evt
}

func (h *EventHeap[K]) Decrement(seconds int64) []*Event[K] {
	var ready []*Event[K]

	if len(*h) == 0 {
		return ready
	}

	for i := range *h {
		if (*h)[i].delay <= seconds {
			evt := h.Pop()
			evt.delay -= seconds
			ready = append(ready, evt)
		} else {
			(*h)[i].delay -= seconds
		}
	}

	return ready
}
