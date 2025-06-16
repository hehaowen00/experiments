package scheduling

import (
	"log"
	"os"
	"os/signal"
	"testing"
	"time"
)

func TestScheduler(t *testing.T) {
	w, err := NewTimeScheduler(
		"Australia/Brisbane",
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
	if err != nil {
		panic(err)
	}

	w.Set("20:52", "10:53")

	time.Sleep(time.Second * 10)

	w.Set("00:31", "07:00")

	time.Sleep(time.Second * 10)

	w.Set("00:36", "07:00")

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	<-sig
}
