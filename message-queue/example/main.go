package main

import messagequeue "message-queue"

func main() {
	ex, err := messagequeue.NewExchange(":memory")
	if err != nil {
		panic(err)
	}
	defer ex.Stop()

	pub, err := ex.NewPublisher("test")
	if err != nil {
		panic(err)
	}

	con, err := ex.NewConsumer("test")
	if err != nil {
		panic(err)
	}
	defer con.Stop()

	for con.Next() {
		msg, err := con.Read()
		if err != nil {
			panic(err)
		}
	}

	_ = pub.Publish("test", []byte("hello world!"))
}
