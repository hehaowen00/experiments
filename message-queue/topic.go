package messagequeue

import (
	"database/sql"
	"log"
	"sync"
	"sync/atomic"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/segmentio/ksuid"
)

type topic struct {
	db            *sql.DB
	name          string
	last          string
	consumers     []chan struct{}
	consumersRead map[string]string
	running       atomic.Bool
	// in            chan []byte
	// waiting       chan chan struct{}
	rw sync.RWMutex
}

func newTopic(name string) (*topic, error) {
	db, err := sql.Open("sqlite3", "./_msq_/"+name+".db")
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`create table if not exists topics (id text not null, name text not null, primary key (id))`)
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`create table if not exists messages (id text not null, timestamp int not null, msg blob not null, primary key (id))`)
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`create table if not exists channels (id text not null, last_read text not null, primary key (id))`)
	if err != nil {
		return nil, err
	}

	return &topic{
		name: name,
		db:   db,
		// in:            make(chan []byte),
		consumers:     []chan struct{}{},
		consumersRead: map[string]string{},
	}, nil
}

func (t *topic) Send(msg []byte) error {
	// for {
	// 	select {
	// 	case msg := <-t.in:
	t.rw.Lock()
	defer t.rw.Unlock()

	_, err := t.db.Exec(
		`insert into messages (id, timestamp, msg) values (?, ?, ?)`,
		ksuid.New().String(),
		time.Now().UnixMilli(),
		msg,
	)
	if err != nil {
		panic(err)
	}

	time.Sleep(time.Second)

	for _, v := range t.consumers {
		close(v)
	}
	t.consumers = nil
	// case notify := <-t.waiting:
	// 	t.rw.Lock()
	// 	t.rw.Unlock()
	// }
	// }

	return nil
}

func (t *topic) readNext(channel string) (string, []byte, error) {
	log.Println("read next", channel)

	last := ""

	err := t.db.QueryRow(`select last_read from channels where id = ?`, channel).Scan(&last)
	if err == sql.ErrNoRows {
		err = nil
	} else if err != nil {
		return "", nil, err
	}

	log.Println("reading", channel, last)

	for {
		id := ""
		msg := []byte{}

		err := t.db.QueryRow(`select id, msg from messages where id > ? order by id desc limit 1`, last).Scan(&id, &msg)
		log.Println("read", last, id, err)
		if err == sql.ErrNoRows {
			t.rw.Lock()
			ch := make(chan struct{})
			t.consumers = append(t.consumers, ch)
			t.rw.Unlock()
			<-ch
			continue
		}
		if err != nil {
			return "", nil, err
		}
		if id != "" {
			return id, msg, nil
		}
	}
}

func (t *topic) markRead(channel string, id string) error {
	_, err := t.db.Exec(`insert into channels (id, last_read) values (?, ?) on conflict(id) do update set last_read = ?`, channel, id, id)
	return err
}

func (t *topic) Clear() error {
	_, err := t.db.Exec(`delete from messages`)
	if err != nil {
		return err
	}

	return nil
}

func (t *topic) Stop() {
	t.running.Store(false)
	t.db.Close()
}
