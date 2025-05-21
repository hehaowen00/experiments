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

	var count int64

	con, err := ex.NewConsumer(
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
	defer con.Stop()

	log.Println("publishing message...")

	pub, err := ex.NewPublisher("test")
	if err != nil {
		panic(err)
	}

	_ = pub

	for i := range 100 {
		fmt.Println("publish", i)

		err = pub.Publish("test", []byte("hello world!"))
		if err != nil {
			panic(err)
		}
	}

	time.Sleep(time.Second * 100)
}
