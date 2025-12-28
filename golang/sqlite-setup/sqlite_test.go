package sqlitesetup_test

import (
	"database/sql"
	"fmt"
	"os"
	sqlitesetup "sqlite-setup"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func BenchmarkSQLiteInsertAndCount(b *testing.B) {
	filePath := "./separate.db"
	_ = os.Remove(filePath)

	res := sqlitesetup.SetupSQLite(filePath)
	if res.Err() != nil {
		b.Fatalf("failed to setup sqlite: %v", res.Err())
	}
	reader, writer := res.DB()
	defer reader.Close()
	defer writer.Close()

	_, err := writer.Exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT)`)
	if err != nil {
		b.Fatalf("failed to create table: %v", err)
	}

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := writer.Exec(`INSERT INTO messages (body) VALUES (?)`, fmt.Sprintf("msg-%d", i))
		if err != nil {
			b.Fatalf("insert failed: %v", err)
		}
	}
}

func BenchmarkSQliteDefault(b *testing.B) {
	filePath := "./default.db"
	_ = os.Remove(filePath)

	conn, err := sql.Open("sqlite3", filePath)
	if err != nil {
		b.Fatalf("failed to setup sqlite: %v", err)
	}

	_, err = conn.Exec(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT)`)
	if err != nil {
		b.Fatalf("failed to create table: %v", err)
	}

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		_, err := conn.Exec(`INSERT INTO messages (body) VALUES (?)`, fmt.Sprintf("msg-%d", i))
		if err != nil {
			b.Fatalf("insert failed: %v", err)
		}
	}
}

