package storage

import (
	"database/sql"
	"fmt"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// ---------------------------------------------------------------------------
// SQLiteStorage - shared database handle with factory methods
// ---------------------------------------------------------------------------

// SQLiteStorage wraps a single *sql.DB and provides implementations of
// QueueFactory, DLQStore, and DeduplicationStore.
type SQLiteStorage struct {
	db *sql.DB
	mu sync.Mutex // serialise DDL / schema operations

	// prepared statements for DLQ
	dlqAdd   *sql.Stmt
	dlqList  *sql.Stmt
	dlqGet   *sql.Stmt
	dlqDel   *sql.Stmt
	dlqPurge *sql.Stmt
	dlqCount *sql.Stmt

	// prepared statements for dedup
	dedupMark    *sql.Stmt
	dedupCheck   *sql.Stmt
	dedupCleanup *sql.Stmt
}

// OpenSQLite opens (or creates) a SQLite database at path and initialises the
// schema. The database is configured with WAL mode, a 5-second busy timeout,
// and foreign keys enabled.
func OpenSQLite(path string) (*SQLiteStorage, error) {
	dsn := fmt.Sprintf("%s?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on", path)
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("sqlite open: %w", err)
	}

	// Single writer connection is safest for WAL mode.
	db.SetMaxOpenConns(1)

	// Create tables.
	for _, ddl := range []string{CreateQueueTable, CreateDLQTable, CreateSeenTable} {
		if _, err := db.Exec(ddl); err != nil {
			db.Close()
			return nil, fmt.Errorf("sqlite schema: %w", err)
		}
	}

	s := &SQLiteStorage{db: db}
	if err := s.prepareStatements(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *SQLiteStorage) prepareStatements() error {
	var err error

	// DLQ statements
	s.dlqAdd, err = s.db.Prepare(`INSERT INTO dlq_messages
		(original_topic, source, payload, reason, attempts, dead_at, message_id)
		VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("prepare dlqAdd: %w", err)
	}

	s.dlqList, err = s.db.Prepare(`SELECT id, original_topic, source, payload, reason, attempts, dead_at, message_id
		FROM dlq_messages WHERE original_topic = ? ORDER BY id LIMIT ? OFFSET ?`)
	if err != nil {
		return fmt.Errorf("prepare dlqList: %w", err)
	}

	s.dlqGet, err = s.db.Prepare(`SELECT id, original_topic, source, payload, reason, attempts, dead_at, message_id
		FROM dlq_messages WHERE id = ?`)
	if err != nil {
		return fmt.Errorf("prepare dlqGet: %w", err)
	}

	s.dlqDel, err = s.db.Prepare(`DELETE FROM dlq_messages WHERE id = ?`)
	if err != nil {
		return fmt.Errorf("prepare dlqDel: %w", err)
	}

	s.dlqPurge, err = s.db.Prepare(`DELETE FROM dlq_messages WHERE original_topic = ?`)
	if err != nil {
		return fmt.Errorf("prepare dlqPurge: %w", err)
	}

	s.dlqCount, err = s.db.Prepare(`SELECT COUNT(*) FROM dlq_messages WHERE original_topic = ?`)
	if err != nil {
		return fmt.Errorf("prepare dlqCount: %w", err)
	}

	// Dedup statements
	s.dedupCheck, err = s.db.Prepare(`SELECT 1 FROM seen_messages WHERE message_id = ?`)
	if err != nil {
		return fmt.Errorf("prepare dedupCheck: %w", err)
	}

	s.dedupMark, err = s.db.Prepare(`INSERT OR IGNORE INTO seen_messages (message_id) VALUES (?)`)
	if err != nil {
		return fmt.Errorf("prepare dedupMark: %w", err)
	}

	s.dedupCleanup, err = s.db.Prepare(`DELETE FROM seen_messages WHERE seen_at < ?`)
	if err != nil {
		return fmt.Errorf("prepare dedupCleanup: %w", err)
	}

	return nil
}

// Close closes all prepared statements and the database.
func (s *SQLiteStorage) Close() error {
	stmts := []*sql.Stmt{
		s.dlqAdd, s.dlqList, s.dlqGet, s.dlqDel, s.dlqPurge, s.dlqCount,
		s.dedupCheck, s.dedupMark, s.dedupCleanup,
	}
	for _, st := range stmts {
		if st != nil {
			st.Close()
		}
	}
	return s.db.Close()
}

// DB returns the underlying database handle.
func (s *SQLiteStorage) DB() *sql.DB {
	return s.db
}

// ---------------------------------------------------------------------------
// QueueFactory
// ---------------------------------------------------------------------------

// NewQueueFactory returns a QueueFactory that creates SQLiteQueue instances
// sharing this storage's database connection.
func (s *SQLiteStorage) NewQueueFactory() QueueFactory {
	return func(topic, subscriberID string) QueueStore {
		return &SQLiteQueue{
			db:         s.db,
			topic:      topic,
			subscriber: subscriberID,
		}
	}
}

// ---------------------------------------------------------------------------
// SQLiteQueue - per topic+subscriber queue backed by SQLite
// ---------------------------------------------------------------------------

// SQLiteQueue implements QueueStore for a specific topic and subscriber pair,
// sharing the underlying *sql.DB from SQLiteStorage.
type SQLiteQueue struct {
	db         *sql.DB
	topic      string
	subscriber string

	// lazily prepared statements
	once    sync.Once
	enqueue *sql.Stmt
	dequeue *sql.Stmt
	length  *sql.Stmt
	delByID *sql.Stmt
}

func (q *SQLiteQueue) prepare() error {
	var firstErr error
	q.once.Do(func() {
		var err error

		q.enqueue, err = q.db.Prepare(`INSERT INTO queue_messages
			(topic, subscriber, message_id, source, payload, timestamp, sequence, reply_to, stream_id, attempt)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
		if err != nil {
			firstErr = fmt.Errorf("prepare enqueue: %w", err)
			return
		}

		q.dequeue, err = q.db.Prepare(`SELECT id, message_id, source, payload, timestamp, sequence, reply_to, stream_id, attempt
			FROM queue_messages WHERE topic = ? AND subscriber = ? ORDER BY id ASC LIMIT 1`)
		if err != nil {
			firstErr = fmt.Errorf("prepare dequeue: %w", err)
			return
		}

		q.length, err = q.db.Prepare(`SELECT COUNT(*) FROM queue_messages WHERE topic = ? AND subscriber = ?`)
		if err != nil {
			firstErr = fmt.Errorf("prepare length: %w", err)
			return
		}

		q.delByID, err = q.db.Prepare(`DELETE FROM queue_messages WHERE id = ?`)
		if err != nil {
			firstErr = fmt.Errorf("prepare delByID: %w", err)
			return
		}
	})
	return firstErr
}

func (q *SQLiteQueue) Enqueue(msg *Message) error {
	if err := q.prepare(); err != nil {
		return err
	}
	_, err := q.enqueue.Exec(
		q.topic, q.subscriber, msg.ID, msg.Source,
		msg.Payload, msg.Timestamp, msg.Sequence,
		msg.ReplyTo, msg.StreamID, msg.Attempt,
	)
	return err
}

func (q *SQLiteQueue) Dequeue() (*Message, error) {
	if err := q.prepare(); err != nil {
		return nil, err
	}

	row := q.dequeue.QueryRow(q.topic, q.subscriber)

	var rowID int64
	msg := &Message{Destination: q.topic}
	err := row.Scan(
		&rowID, &msg.ID, &msg.Source, &msg.Payload,
		&msg.Timestamp, &msg.Sequence, &msg.ReplyTo,
		&msg.StreamID, &msg.Attempt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("dequeue scan: %w", err)
	}

	// Delete the dequeued row.
	if _, err := q.delByID.Exec(rowID); err != nil {
		return nil, fmt.Errorf("dequeue delete: %w", err)
	}
	return msg, nil
}

func (q *SQLiteQueue) Len() (int, error) {
	if err := q.prepare(); err != nil {
		return 0, err
	}
	var n int
	err := q.length.QueryRow(q.topic, q.subscriber).Scan(&n)
	return n, err
}

func (q *SQLiteQueue) Close() error {
	stmts := []*sql.Stmt{q.enqueue, q.dequeue, q.length, q.delByID}
	for _, st := range stmts {
		if st != nil {
			st.Close()
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// DLQStore implementation
// ---------------------------------------------------------------------------

func (s *SQLiteStorage) Add(msg *DeadLetter) error {
	_, err := s.dlqAdd.Exec(
		msg.OriginalTopic, msg.Source, msg.Payload,
		msg.Reason, msg.Attempts, msg.DeadAt, msg.MessageID,
	)
	if err != nil {
		return fmt.Errorf("dlq add: %w", err)
	}
	return nil
}

func (s *SQLiteStorage) List(topic string, limit, offset int) ([]*DeadLetter, error) {
	rows, err := s.dlqList.Query(topic, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("dlq list: %w", err)
	}
	defer rows.Close()

	var results []*DeadLetter
	for rows.Next() {
		dl := &DeadLetter{}
		if err := rows.Scan(
			&dl.ID, &dl.OriginalTopic, &dl.Source, &dl.Payload,
			&dl.Reason, &dl.Attempts, &dl.DeadAt, &dl.MessageID,
		); err != nil {
			return nil, fmt.Errorf("dlq list scan: %w", err)
		}
		results = append(results, dl)
	}
	return results, rows.Err()
}

func (s *SQLiteStorage) Retry(id string) (*Message, error) {
	row := s.dlqGet.QueryRow(id)

	dl := &DeadLetter{}
	var rowID int64
	err := row.Scan(
		&rowID, &dl.OriginalTopic, &dl.Source, &dl.Payload,
		&dl.Reason, &dl.Attempts, &dl.DeadAt, &dl.MessageID,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("dead letter %q not found", id)
	}
	if err != nil {
		return nil, fmt.Errorf("dlq retry scan: %w", err)
	}

	if _, err := s.dlqDel.Exec(rowID); err != nil {
		return nil, fmt.Errorf("dlq retry delete: %w", err)
	}

	return &Message{
		ID:          dl.MessageID,
		Source:      dl.Source,
		Destination: dl.OriginalTopic,
		Payload:     dl.Payload,
		Timestamp:   dl.DeadAt,
		Attempt:     dl.Attempts,
	}, nil
}

func (s *SQLiteStorage) Purge(topic string) (int, error) {
	res, err := s.dlqPurge.Exec(topic)
	if err != nil {
		return 0, fmt.Errorf("dlq purge: %w", err)
	}
	n, err := res.RowsAffected()
	return int(n), err
}

func (s *SQLiteStorage) Count(topic string) (int, error) {
	var n int
	err := s.dlqCount.QueryRow(topic).Scan(&n)
	return n, err
}

// ---------------------------------------------------------------------------
// DeduplicationStore implementation
// ---------------------------------------------------------------------------

func (s *SQLiteStorage) MarkSeen(messageID string) (bool, error) {
	// Check first.
	var exists int
	err := s.dedupCheck.QueryRow(messageID).Scan(&exists)
	if err == nil {
		return true, nil // already seen
	}
	if err != sql.ErrNoRows {
		return false, fmt.Errorf("dedup check: %w", err)
	}

	// Insert.
	_, err = s.dedupMark.Exec(messageID)
	if err != nil {
		return false, fmt.Errorf("dedup mark: %w", err)
	}
	return false, nil
}

func (s *SQLiteStorage) Cleanup(olderThan time.Duration) error {
	cutoff := time.Now().Add(-olderThan).Unix()
	_, err := s.dedupCleanup.Exec(cutoff)
	if err != nil {
		return fmt.Errorf("dedup cleanup: %w", err)
	}
	return nil
}
