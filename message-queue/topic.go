package messagequeue

import (
	"database/sql"
	"sync/atomic"
)

type topic struct {
	db            *sql.DB
	name          string
	consumers     map[string]chan []byte
	consumersRead map[string]int64
	running       atomic.Bool
}

func newTopic(name string) (*topic, error) {
	db, err := sql.Open("sqlite3", "./_msq_/"+name+".db")
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`create table if not exist topics (id text not null, name text not null, primary key (id))`)
	if err != nil {
		return nil, err
	}

	_, err = db.Exec(`create table if not exist messages (id text not null, msg blob not null, primary key (id))`)
	if err != nil {
		return nil, err
	}

	return &topic{
		name: name,
		db:   db,
	}, nil
}

func (t *topic) Subscribe(name string) chan []byte {
	return nil
}

func (t *topic) Run() error {
	_, err := t.db.Exec(`insert into messages (id, msg) values (?, ?)`)
	if err != nil {
		return nil
	}

	return nil
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
