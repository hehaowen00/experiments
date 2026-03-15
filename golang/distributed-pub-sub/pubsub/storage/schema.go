package storage

// CreateQueueTable defines the DDL for the persistent message queue table.
const CreateQueueTable = `CREATE TABLE IF NOT EXISTS queue_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    subscriber TEXT NOT NULL,
    message_id TEXT NOT NULL,
    source TEXT,
    payload BLOB,
    timestamp INTEGER,
    sequence INTEGER,
    reply_to TEXT,
    stream_id TEXT,
    attempt INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_queue_topic_sub ON queue_messages(topic, subscriber);`

// CreateDLQTable defines the DDL for the dead-letter queue table.
const CreateDLQTable = `CREATE TABLE IF NOT EXISTS dlq_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_topic TEXT NOT NULL,
    source TEXT,
    payload BLOB,
    reason TEXT,
    attempts INTEGER DEFAULT 0,
    dead_at INTEGER,
    message_id TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_dlq_topic ON dlq_messages(original_topic);
CREATE INDEX IF NOT EXISTS idx_dlq_message_id ON dlq_messages(message_id);`

// CreateSeenTable defines the DDL for the message deduplication table.
const CreateSeenTable = `CREATE TABLE IF NOT EXISTS seen_messages (
    message_id TEXT PRIMARY KEY,
    seen_at INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_seen_at ON seen_messages(seen_at);`
