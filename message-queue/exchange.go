package messagequeue

import (
	"database/sql"
	"os"
	"sync"
	"sync/atomic"
)

type Exchange struct {
	metadata *sql.DB
	topics   map[string]*topic
	rw       sync.RWMutex
	in       chan []byte
	running  atomic.Bool
}

func NewExchange() (*Exchange, error) {
	if _, err := os.Stat("./_msq_"); os.IsNotExist(err) {
		err := os.MkdirAll("./_msq_", 0777)
		if err != nil {
			return nil, err
		}
	}

	metadataDB, err := sql.Open("sqlite3", "./_msq_/metadata.db")
	if err != nil {
		panic(err)
	}

	metadataDB.Exec(`create table if not exist topics (id text not null, name text not null, primary key (id))`)

	ex := &Exchange{
		metadata: metadataDB,
		topics:   map[string]*topic{},
	}

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
	if !ex.running.Load() {
		return nil
	}

	_, err := ex.metadata.Exec(`insert into topics (id, name) values (?, ?)`, 0, topic)
	if err != nil {
		return err
	}

	t, err := newTopic(topic)
	if err != nil {
		return err
	}

	ex.topics[topic] = t

	return nil
}

func (ex *Exchange) ClearTopic(topic string) error {
	if !ex.running.Load() {
		return nil
	}

	ex.rw.RLock()
	ex.topics[topic].Clear()
	ex.rw.RUnlock()

	return nil
}

func (ex *Exchange) DeleteTopic(topic string) error {
	if !ex.running.Load() {
		return nil
	}

	return nil
}

func (ex *Exchange) DeleteConsumer(topic string, channel string) error {
	if !ex.running.Load() {
		return nil
	}

	return nil
}

func (ex *Exchange) NewPublisher(
	topics ...string,
) (*Publisher, error) {
	p := &Publisher{
		ex: ex,
	}

	return p, nil
}

func (ex *Exchange) NewConsumer(
	topic string,
	handler func([]byte) error,
) (*Consumer, error) {
	c := &Consumer{
		handler: handler,
	}

	return c, nil
}
