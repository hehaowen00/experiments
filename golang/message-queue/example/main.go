package main

import (
	"fmt"
	"log"
	messagequeue "message-queue"
	"os"
	"os/signal"
)

func main() {
	ex, err := messagequeue.NewExchange()
	if err != nil {
		panic(err)
	}
	// defer ex.Stop()

	ex.Run()

	log.Println("starting message queue")

	err = ex.CreateTopic("test")
	if err != nil {
		panic(err)
	}

	err = ex.CreateTopic("testing")
	if err != nil {
		panic(err)
	}

	var count int64

	c, err := ex.NewConsumer(
		"test",
		"testing",
		func(id string, b []byte) error {
			log.Println("testing", count, id, string(b))
			count++
			return nil
		},
	)
	if err != nil {
		panic(err)
	}
	defer c.Stop()

	c2, err := ex.NewConsumer(
		"test",
		"testing2",
		func(id string, b []byte) error {
			log.Println("testing2", count, id, string(b))
			count++
			return nil
		},
	)
	if err != nil {
		panic(err)
	}
	defer c2.Stop()

	log.Println("publishing message...")

	pub, err := ex.NewPublisher("test")
	if err != nil {
		panic(err)
	}
	_ = pub

	// for i := range 10 {
	// 	id, err := pub.Publish("test", []byte("hello world!"))
	// 	if err != nil {
	// 		panic(err)
	// 	}
	//
	// 	fmt.Println("publish", i, id)
	// }

	fmt.Println("hello world")
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt)
	<-ch

	t, err := ex.GetTopic("test")
	if err != nil {
		panic(err)
	}

	metrics, err := t.Metrics()
	if err != nil {
		panic(err)
	}
	log.Println("metrics:", metrics.TotalMessages, metrics.TotalChannels)
}
