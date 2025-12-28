package messagequeue

import (
	"context"
	"database/sql"
	"log"
	"math"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Exchange struct {
	metadata   *sql.DB
	topics     map[string]*topic
	rw         sync.RWMutex
	running    atomic.Bool
	maxRetries int
}

type ExchangeOpts struct {
	MaxRetries int
}

func NewExchange(opts ...*ExchangeOpts) (*Exchange, error) {
	log.Println("creating exchange...")

	if _, err := os.Stat("./_msq_"); os.IsNotExist(err) {
		err := os.MkdirAll("./_msq_", 0777)
		if err != nil {
			return nil, err
		}
	}

	if len(opts) == 0 {
		opts = append(opts, &ExchangeOpts{
			MaxRetries: 3,
		})
	}

	metadataDB, err := sql.Open("sqlite3", "./_msq_/metadata.db")
	if err != nil {
		panic(err)
	}

	_, err = metadataDB.Exec(`create table if not exists topics (id text not null, name text not null, primary key (id))`)
	if err != nil {
		return nil, err
	}

	rows, err := metadataDB.Query(`select id, name from topics`)
	if err != nil {
		panic(err)
	}
	defer rows.Close()

	ex := &Exchange{
		metadata:   metadataDB,
		topics:     map[string]*topic{},
		maxRetries: opts[0].MaxRetries,
	}

	// DEPRECATED:
	// for rows.Next() {
	// 	id := ""
	// 	name := ""
	// 	rows.Scan(&id, &name)

	// 	t, err := newTopic(name)
	// 	if err != nil {
	// 		return nil, err
	// 	}

	// 	ex.topics[name] = t
	// 	t.run()
	// }

	return ex, nil
}

func (ex *Exchange) Run() {
	ex.running.Store(true)
}

func (ex *Exchange) Stop() {
	ex.running.Store(false)
	ex.rw.Lock()
	ex.metadata.Close()

	for _, db := range ex.topics {
		db.Stop()
	}

	clear(ex.topics)
}

func (ex *Exchange) CreateTopic(topic string) error {
	ex.rw.Lock()
	defer ex.rw.Unlock()

	if !ex.running.Load() {
		return ErrStopped
	}

	if strings.HasSuffix(topic, "#temp") {
		t, err := newTopic(topic)
		if err != nil {
			return err
		}

		ex.topics[topic] = t
		t.run()

		return nil
	}

	_, err := ex.metadata.Exec(
		`INSERT INTO TOPICS (id, name)
		VALUES (?, ?)`,
		0, topic,
	)
	if err != nil {
		err = nil
		// return err
	}

	t, err := newTopic(topic)
	if err != nil {
		return err
	}

	ex.topics[topic] = t
	t.run()

	return nil
}

func (ex *Exchange) ClearTopic(topic string) error {
	if !ex.running.Load() {
		return ErrStopped
	}

	ex.rw.RLock()
	ex.topics[topic].Clear()
	ex.rw.RUnlock()

	return nil
}

func (ex *Exchange) DeleteTopic(topic string) error {
	if !ex.running.Load() {
		return ErrStopped
	}

	return nil
}

func (ex *Exchange) DeleteConsumer(topic string, channel string) error {
	if !ex.running.Load() {
		return ErrStopped
	}

	return nil
}

func (ex *Exchange) NewPublisher(
	topics ...string,
) (*Publisher, error) {
	if !ex.running.Load() {
		return nil, ErrStopped
	}

	p := &Publisher{
		ex: ex,
	}

	return p, nil
}

func (ex *Exchange) NewConsumer(
	topic string,
	channel string,
	handler func(id string, payload []byte) error,
) (*Consumer, error) {
	if !ex.running.Load() {
		return nil, ErrStopped
	}

	ctx, cancel := context.WithCancel(context.Background())

	c := &Consumer{
		handler: handler,
		ctx:     ctx,
		cancel:  cancel,
		once:    sync.Once{},
	}

	ex.rw.RLock()
	t, ok := ex.topics[topic]
	if !ok {
		ex.rw.RUnlock()

		err := ex.CreateTopic(topic)
		if err != nil {
			return nil, err
		}

		t, ok = ex.topics[topic]
	} else {
		ex.rw.RUnlock()
	}

	if !ok {
		log.Panicln("topic not found:", topic)
	}

	go func() {
		for {
			id, msg, err := t.readNext(channel)
			if err != nil {
				log.Println(err)
				break
			}

			for i := 0; i < ex.maxRetries; i++ {
				err = c.handler(id, msg)
				if err != nil {
					if i == ex.maxRetries-1 {
						log.Println("max retries reached:", topic, err)
						break
					}

					dur := math.Exp(float64(i))
					time.Sleep(time.Duration(dur) * time.Second)
					continue
				}
			}

			err = t.markRead(channel, id)
			if err != nil {
				log.Panic(err)
				break
			}
		}
	}()

	return c, nil
}

func (ex *Exchange) GetTopic(topic string) (*topic, error) {
	if !ex.running.Load() {
		return nil, ErrStopped
	}

	ex.rw.RLock()
	t, ok := ex.topics[topic]
	ex.rw.RUnlock()

	if !ok {
		return nil, ErrTopicNotFound
	}

	return t, nil
}
