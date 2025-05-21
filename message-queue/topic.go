package messagequeue

import (
	"database/sql"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/segmentio/ksuid"
)

var ERR_STOPPED = errors.New("stopped")

type topic struct {
	db        *sql.DB
	name      string
	last      string
	consumers []chan struct{}
	running   atomic.Bool
	rw        sync.RWMutex

	log     []string
	entries map[string][]byte
}

func newTopic(name string) (*topic, error) {
	if strings.HasSuffix(name, "#temp") {
		t := &topic{
			name:      name,
			consumers: []chan struct{}{},
		}

		go t.gc()
	}

	db, err := sql.Open("sqlite3", "./_msq_/"+name+".db")
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

	last := ""
	err = db.QueryRow(`select last_read from channels order by last_read desc limit 1`).Scan(&last)
	if err != sql.ErrNoRows && err != nil {
		return nil, err
	}

	t := &topic{
		name:      name,
		db:        db,
		consumers: []chan struct{}{},
		last:      last,
	}

	// go t.gc()

	return t, nil
}

func (t *topic) run() {
	t.running.Store(true)
}

func (t *topic) gc() {
	ch := newClosedChan[time.Time]()
	instant := ch

	for {
		select {
		case <-instant:
			last := ""
			instant = time.After(5 * time.Minute)

			err := t.db.QueryRow(`select min(last_read) from channels`).Scan(&last)
			if err != nil {
				panic(err)
			}

			_, err = t.db.Exec(`delete from messages where id <= ?`, last)
			if err != nil {
				panic(err)
			}
		}
	}
}

func newClosedChan[T any]() <-chan T {
	ch := make(chan T)
	close(ch)
	return ch
}

func (t *topic) Send(msg []byte) error {
	if !t.running.Load() {
		return ERR_STOPPED
	}

	t.rw.Lock()
	defer t.rw.Unlock()

	id := ksuid.New().String()

	_, err := t.db.Exec(
		`insert into messages (id, timestamp, msg) values (?, ?, ?)`,
		id,
		time.Now().UnixMilli(),
		msg,
	)
	if err != nil {
		panic(err)
	}

	// time.Sleep(time.Second)

	for _, v := range t.consumers {
		close(v)
	}
	t.consumers = nil
	t.last = id

	// time.Sleep(time.Second)

	return nil
}

func (t *topic) readNext(channel string) (string, []byte, error) {
	// log.Println("read next", channel)

	last := ""

	err := t.db.QueryRow(`select last_read from channels where id = ?`, channel).Scan(&last)
	if err == sql.ErrNoRows {
		err = nil
	} else if err != nil {
		return "", nil, err
	}

	for {
		if !t.running.Load() {
			return "", nil, ERR_STOPPED
		}

		id := ""
		msg := []byte{}

		if last == "" && t.last != "" {
			t.markRead(channel, t.last)
			last = t.last
		}

		err := t.db.QueryRow(`select id, msg from messages where id > ? order by id ASC limit 1`, last).
			Scan(&id, &msg)

		if err == sql.ErrNoRows {
			err = nil
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
	// time.Sleep(time.Second)
	return err
}

func (t *topic) Clear() error {
	tx, err := t.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`delete from messages`)
	if err != nil {
		return err
	}

	_, err = tx.Exec(`delete from channels`)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (t *topic) Stop() {
	t.rw.Lock()

	t.running.Store(false)

	for _, v := range t.consumers {
		close(v)
	}
	t.consumers = nil

	last := ""

	err := t.db.QueryRow(`select last_read from channels order by last_read desc limit 1`).Scan(&last)
	if err != nil {
		panic(err)
	}

	_, err = t.db.Exec(`delete from messages where id <= ?`, last)
	if err != nil {
		panic(err)
	}

	t.db.Close()
	t.rw.Unlock()
}

type dbStore struct {
	db *sql.DB
}

type memStore struct {
	log      []string          // append only list of published payloads
	entries  map[string][]byte // lookup table of id to payload
	channels map[string]string
}

type istore interface {
	clear()
	gc()
	readNext(channel string) (string, []byte, error)
	markRead(channel, id string) error
}

func (s *memStore) clear() {
	s.log = nil
	s.channels = map[string]string{}
	s.entries = map[string][]byte{}
}

func (s *memStore) gc() {
	last := ""
	for _, v := range s.channels {
		last = min(last, v)
	}
}
