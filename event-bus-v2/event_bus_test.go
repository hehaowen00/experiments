package eventbusv2_test

import (
	eventbusv2 "event-bus-v2"
	"log"
	"testing"
	"time"
)

func TestEventBus(t *testing.T) {
	bus := eventbusv2.NewEventBus[string]()

	s1, err := bus.Subscribe()
	if err != nil {
		t.FailNow()
	}

	s2, err := bus.Subscribe()
	if err != nil {
		t.FailNow()
	}

	go func() {
		m := <-s1
		log.Println(m)
	}()

	go func() {
		m := <-s2
		log.Println(m)
	}()

	bus.Publish("event1")
	bus.Publish("event2")
	time.Sleep(2 * time.Second)
}
