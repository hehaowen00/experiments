package main

import (
	"fmt"
	"log"
	messagequeue "message-queue"
	"time"
)

func main() {
	ex, err := messagequeue.NewExchange()
	if err != nil {
		panic(err)
	}
	defer ex.Stop()

	ex.Run()

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
			log.Println(count, id, string(b))
			count++
			return nil
		},
	)
	if err != nil {
		panic(err)
	}
	defer c.Stop()

	log.Println("publishing message...")

	pub, err := ex.NewPublisher("test")
	if err != nil {
		panic(err)
	}

	_ = pub

	for i := range 1000 {
		id, err := pub.Publish("test", []byte("hello world!"))
		if err != nil {
			panic(err)
		}

		fmt.Println("publish", i, id)

		// id, err = pub.Publish("testing", []byte("hello world!"))
		// if err != nil {
		// 	panic(err)
		// }

		break
	}

	t, err := ex.GetTopic("testing")
	if err != nil {
		panic(err)
	}

	metrics := t.Metrics()
	log.Println("metrics:", metrics.TotalMessages, metrics.TotalChannels)

	time.Sleep(time.Second * 100)
}
