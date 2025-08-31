package sqlitesetup

import (
	"database/sql"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

type SQLiteResult struct {
	reader *sql.DB
	writer *sql.DB
	err    error
}

func (res SQLiteResult) DB() (reader *sql.DB, writer *sql.DB) {
	return res.reader, res.writer
}

func (res SQLiteResult) Err() error {
	return res.err
}

func SetupSQLite(filePath string) SQLiteResult {
	writer, err := sql.Open(
		"sqlite3",
		fmt.Sprintf("file:%s?_journal_mode=WAL&_timeout=10000&_fk=true", filePath),
	)
	if err != nil {
		return SQLiteResult{
			err: err,
		}
	}
	writer.SetMaxOpenConns(1)

	reader, err := sql.Open(
		"sqlite3",
		fmt.Sprintf("file:%s?_journal_mode=WAL&_timeout=10000&_fk=true", filePath),
	)
	if err != nil {
		writer.Close()
		return SQLiteResult{
			err: err,
		}
	}

	return SQLiteResult{
		reader: reader,
		writer: writer,
	}
}
