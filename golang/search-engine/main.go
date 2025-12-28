package main

import (
	"log"
	"time"
)

type Document struct {
	ID      string
	Title   string
	Summary string
	Bag     map[string]int
}

func TFIDF() {
}

// func Query(tfidf Lookup, term string) []Document {
// 	var docs []Document
// 	for d, e := range tfidf[term] {
// 		docs = append(docs, Document{
// 			ID: d,
// 		})
// 	}
// 	return docs
// }

func main() {
	// inputCh := NewChan[string]()
	//
	// outputCh := Pipeline[string, string](
	// 	inputCh,
	// 	func(s string) string {
	// 		return ""
	// 	})
	//
	// for r := range <-outputCh {
	// 	log.Println(r)
	// }

	heap := minheap[int, int]{}
	initMinHeap(&heap)

	for i := range 5 {
		heap.insert(i, i)
	}

	log.Println(heap.root)

	for i := 10; i > 4; i-- {
		heap.insert(i, i)
	}
	heap.insert(10, 102)
	heap.insert(10, 102)
	heap.insert(10, 102)
	heap.insert(10, 102)

	log.Println(heap.root)

	k, t, ok := heap.popmin()
	for ok {
		log.Println(k, t)
		k, t, ok = heap.popmin()
	}

	inputCh2 := NewChan[Entry[int]]()
	tq := TimeQueue(inputCh2)

	go func() {
		now := time.Now()

		for i := range 20 {
			now = now.Add(time.Second)
			inputCh2 <- Entry[int]{
				Data:   i,
				Expiry: now,
			}
		}
	}()

	for t := range tq {
		log.Println(t)
	}
}
