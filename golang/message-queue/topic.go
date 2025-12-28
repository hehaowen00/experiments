package messagequeue

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

var ErrStopped = errors.New("stopped")

func EncodeTimestamp(millis int64) string {
	return fmt.Sprintf("%024d", millis)
}

type topic struct {
	db        *sql.DB
	name      string
	last      string
	consumers []chan struct{}
	running   atomic.Bool
	rw        sync.RWMutex

	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once
}

func newTopic(name string) (*topic, error) {
	if strings.HasSuffix(name, "#temp") {
		t := &topic{
			name:      name,
			consumers: []chan struct{}{},
		}

		go t.gc()
	}

	db, err := sql.Open("sqlite", "./_msq_/"+name+".db")
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS messages (
		id text not null,
		timestamp int not null,
		msg blob not null,
		primary key (id)
	)`)
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS channels (
		id text not null,
		last_read text not null,
		primary key (id)
	)`)
	if err != nil {
		return nil, err
	}

	last := ""
	err = db.QueryRow(
		`SELECT last_read
		FROM channels
		ORDER BY last_read DESC
		LIMIT 1`,
	).
		Scan(&last)
	if err != sql.ErrNoRows && err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())

	t := &topic{
		name:      name,
		db:        db,
		consumers: []chan struct{}{},
		last:      last,
		ctx:       ctx,
		cancel:    cancel,
		once:      sync.Once{},
	}

	go t.gc()

	return t, nil
}

func (t *topic) Name() string {
	return t.name
}

type Metrics struct {
	TotalMessages int64
	TotalChannels int64
}

func (t *topic) Metrics() (*Metrics, error) {
	var totalMessages, totalChannels int64

	err := t.db.QueryRow(`SELECT COUNT(*) FROM messages`).
		Scan(&totalMessages)
	if err != nil {
		return nil, err
	}

	err = t.db.QueryRow(`SELECT COUNT(*) FROM channels`).
		Scan(&totalChannels)
	if err != nil {
		return nil, err
	}

	return &Metrics{
		TotalMessages: totalMessages,
		TotalChannels: totalChannels,
	}, nil
}

func (t *topic) run() {
	t.running.Store(true)
}

func (t *topic) gc() {
	ch := newClosedChan[time.Time]()
	instant := ch

out:
	for {
		select {
		case <-t.ctx.Done():
			break out
		case <-instant:
			last := ""
			instant = time.After(5 * time.Minute)

			err := t.db.QueryRow(
				`SELECT last_read
				FROM channels
				ORDER BY last_read
				DESC LIMIT 1`,
			).Scan(&last)
			if err == sql.ErrNoRows {
				continue
			}

			if err != nil {
				panic(err)
			}

			_, err = t.db.Exec(`DELETE FROM messages WHERE id <= ?`, last)
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

func (t *topic) Send(msg []byte) (string, error) {
	if !t.running.Load() {
		return "", ErrStopped
	}

	t.rw.Lock()
	defer t.rw.Unlock()

	now := time.Now().UnixMilli()
	id := EncodeTimestamp(now)

	_, err := t.db.Exec(
		`INSERT INTO messages (id, timestamp, msg)
		VALUES (?, ?, ?)`,
		id, now, msg,
	)
	if err != nil {
		panic(err)
	}

	for _, v := range t.consumers {
		close(v)
	}
	t.consumers = nil
	t.last = id

	time.Sleep(time.Millisecond * 5)

	return id, nil
}

func (t *topic) readNext(channel string) (string, []byte, error) {
	last := ""

	err := t.db.QueryRow(
		`SELECT LAST_READ FROM channels WHERE id = ?`,
		channel,
	).Scan(&last)
	if err == sql.ErrNoRows {
		err = nil
		if last == "" && t.last != "" {
			t.rw.Lock()
			t.markRead(channel, t.last)
			last = t.last
			t.rw.Unlock()
		}
	} else if err != nil {
		return "", nil, err
	}

	for {
		if !t.running.Load() {
			return "", nil, ErrStopped
		}

		id := ""
		msg := []byte{}

		err := t.db.QueryRow(
			`SELECT id, msg
			FROM messages
			WHERE id > ? ORDER BY id ASC LIMIT 1`,
			last,
		).
			Scan(&id, &msg)

		// log.Println("get next", channel, id, last)

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
	tx, err := t.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO CHANNELS (id, last_read) values (?, ?)
		ON CONFLICT(id)
		DO UPDATE SET last_read = ?;`,
		channel, id, id,
	)
	return tx.Commit()
}

func (t *topic) Clear() error {
	tx, err := t.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`DELETE FROM messages`)
	if err != nil {
		return err
	}

	_, err = tx.Exec(`DELETE FROM channels`)
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (t *topic) Stop() {
	t.rw.Lock()

	t.running.Store(false)
	t.once.Do(func() {
		t.cancel()
	})

	for _, v := range t.consumers {
		close(v)
	}
	t.consumers = nil

	last := ""

	err := t.db.QueryRow(
		`SELECT last_read
		FROM channels
		ORDER BY last_read DESC 
		LIMIT 1`,
	).Scan(&last)
	if err != nil {
	}

	_, err = t.db.Exec(
		`DELETE FROM messages
		WHERE id <= ?`,
		last,
	)
	if err != nil {
		panic(err)
	}

	t.db.Close()
	t.rw.Unlock()
}

type memStore struct {
	messages map[string][]byte
	order    []string
	lastRead map[string]string

	name      string
	last      string
	consumers []chan struct{}
	running   atomic.Bool
	rw        sync.RWMutex

	ctx    context.Context
	cancel context.CancelFunc
	once   sync.Once
}

func newMemStore(name string) *memStore {
	ctx, cancel := context.WithCancel(context.Background())

	return &memStore{
		messages:  map[string][]byte{},
		order:     []string{},
		lastRead:  map[string]string{},
		name:      name,
		last:      "",
		consumers: []chan struct{}{},
		running:   atomic.Bool{},
		ctx:       ctx,
		cancel:    cancel,
	}
}

func (m *memStore) run() {
	m.running.Store(true)
}

func (m *memStore) Send(msg []byte) (string, error) {
	if !m.running.Load() {
		return "", ErrStopped
	}

	m.rw.Lock()
	defer m.rw.Unlock()

	now := time.Now().UnixMilli()
	id := EncodeTimestamp(now)

	m.messages[id] = msg
	m.order = append(m.order, id)
	m.last = id

	for _, v := range m.consumers {
		close(v)
	}
	m.consumers = nil

	time.Sleep(time.Millisecond * 5)

	return id, nil
}

func (m *memStore) readNext(channel string) (string, []byte, error) {
	last := ""

	if m.lastRead[channel] == "" && m.last != "" {
		m.rw.Lock()
		m.markRead(channel, m.last)
		last = m.last
		m.rw.Unlock()
	} else {
		last = m.lastRead[channel]
	}

	for {
		if !m.running.Load() {
			return "", nil, ErrStopped
		}

		id := ""
		msg := []byte{}

		for _, v := range m.order {
			if v > last {
				id = v
				msg = m.messages[v]
				break
			}
		}

		if id != "" {
			return id, msg, nil
		}

		m.rw.Lock()
		ch := make(chan struct{})
		m.consumers = append(m.consumers, ch)
		m.rw.Unlock()
		<-ch
	}
}

func (m *memStore) markRead(channel string, id string) error {
	m.rw.Lock()
	defer m.rw.Unlock()

	m.lastRead[channel] = id
	return nil
}

func (m *memStore) Clear() error {
	m.rw.Lock()
	defer m.rw.Unlock()

	m.messages = map[string][]byte{}
	m.order = []string{}
	m.lastRead = map[string]string{}

	return nil
}
