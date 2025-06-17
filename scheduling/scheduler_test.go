package scheduling

import (
	"log"
	"os"
	"os/signal"
	"testing"
	"time"
)

func TestScheduler(t *testing.T) {
	w := NewTimeScheduler(
		func() {
			log.Println("reset")
		},
		func() {
			log.Println("time range start")
		},
		func() {
			log.Println("time range end")
		},
	)

	timezone := "Australia/Brisbane"

	err := w.Set(timezone, "20:52", "10:53")
	if err != nil {
		panic(err)
	}

	time.Sleep(time.Second * 10)

	err = w.Set(timezone, "00:31", "07:00")
	if err != nil {
		panic(err)
	}

	time.Sleep(time.Second * 10)
	if err != nil {
		panic(err)
	}

	err = w.Set(timezone, "00:36", "07:00")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	<-sig
}
