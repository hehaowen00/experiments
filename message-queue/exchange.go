package messagequeue

import (
	"database/sql"
	"os"
	"sync"
)

type Exchange struct {
	metadata *sql.DB
	topics   map[string]*sql.DB
	rw       sync.RWMutex
	in       chan []byte
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
		topics:   map[string]*sql.DB{},
	}

	return ex, nil
}

func (ex *Exchange) Run() {
}

func (ex *Exchange) Stop() {
	ex.rw.Lock()
	ex.metadata.Close()
	for _, db := range ex.topics {
		db.Close()
	}
}

func (ex *Exchange) CreateTopic(topic string) error {
	_, err := ex.metadata.Exec(`insert into topics (id, name) values (?, ?)`, 0, topic)
	if err != nil {
		return err
	}

	db, err := sql.Open("sqlite3", "./_msq_/"+topic+".db")
	if err != nil {
		return err
	}

	_, err = db.Exec(`create table if not exist topics (id text not null, name text not null, primary key (id))`)
	if err != nil {
		return err
	}

	_, err = db.Exec(`create table if not exist messages (id text not null, name text not null, primary key (id))`)
	if err != nil {
		return err
	}

	return nil
}

func (ex *Exchange) ClearTopic(topic string) {
}

func (ex *Exchange) DeleteTopic(topic string) {

}

func (ex *Exchange) DeleteConsumer(topic string, channel string) {

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
