package main

import (
	"log"
	"time"
	timingqueue "timing-queue"
)

func main() {
	tw := timingqueue.NewTimingQueue()
	tw.Start()

	tw.AddTask("1", time.Now().Add(time.Minute), nil)
	tw.AddTask("2", time.Now().Add(time.Second * 10), nil)
	tw.AddTask("3", time.Now().Add(time.Minute * 5), nil)

	for t := range tw.Signal() {
		log.Println(t)
	}
}
