package main

import (
	"cmp"
	"sync"
)

type minheap[K cmp.Ordered, T any] struct {
	root []node[K, T]
	pool sync.Pool
	size int
}

type node[K cmp.Ordered, T any] struct {
	key   K
	value T
}

func initMinHeap[K cmp.Ordered, T any](heap *minheap[K, T]) {
	heap.root = nil
	heap.pool = sync.Pool{
		New: func() any {
			return node[K, T]{}
		},
	}
}

func parent(index int) int {
	return (index - 1) / 2
}

func left(index int) int {
	return (index * 2) + 1
}

func right(index int) int {
	return (index * 2) + 2
}

func (heap *minheap[K, T]) insert(key K, value T) {
	n := heap.pool.Get().(node[K, T])
	n.key = key
	n.value = value

	heap.root = append(heap.root, n)

	i := len(heap.root) - 1

	for i > 0 && heap.root[parent(i)].key > heap.root[i].key {
		p := parent(i)
		tmp := heap.root[p]
		heap.root[p] = heap.root[i]
		heap.root[i] = tmp
		i = p
	}
}

func (heap *minheap[K, T]) min() (K, T, bool) {
	var zeroK K
	var zeroT T

	if len(heap.root) == 0 {
		return zeroK, zeroT, false
	}

	minNode := heap.root[0]
	key, value := minNode.key, minNode.value

	return key, value, true
}

func (heap *minheap[K, T]) popmin() (K, T, bool) {
	var zeroK K
	var zeroT T

	if len(heap.root) == 0 {
		return zeroK, zeroT, false
	}

	minNode := heap.root[0]
	key, value := minNode.key, minNode.value

	heap.pool.Put(minNode)

	lastIndex := len(heap.root) - 1

	if lastIndex > 0 {
		heap.root[0] = heap.root[lastIndex]
	}

	heap.root = heap.root[:lastIndex]

	heap.heapifyDown(0)

	return key, value, true
}

func (heap *minheap[K, T]) heapifyDown(i int) {
	n := len(heap.root)
	smallest := i

	leftIdx := left(i)
	rightIdx := right(i)

	if leftIdx < n && heap.root[leftIdx].key < heap.root[smallest].key {
		smallest = leftIdx
	}

	if rightIdx < n && heap.root[rightIdx].key < heap.root[smallest].key {
		smallest = rightIdx
	}

	if smallest != i {
		heap.root[i], heap.root[smallest] = heap.root[smallest], heap.root[i]
		heap.heapifyDown(smallest)
	}
}
