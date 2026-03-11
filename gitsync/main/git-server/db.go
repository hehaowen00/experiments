package main

import (
	"database/sql"
	"fmt"
	"os"
	"regexp"

	_ "modernc.org/sqlite"
)

type DB struct {
	conn *sql.DB
}

func openDB(path string) *DB {
	conn, err := sql.Open("sqlite", path+"?_pragma=journal_mode(wal)")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
		os.Exit(1)
	}
	return &DB{conn: conn}
}

func (db *DB) Close() {
	db.conn.Close()
}

func checkPeerAccepted(db *DB, peerId string) bool {
	var status string
	err := db.conn.QueryRow(
		"SELECT status FROM p2p_peers WHERE peer_id = ?", peerId,
	).Scan(&status)
	if err != nil {
		return false
	}
	return status == "accepted"
}

var sanitizeRe = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

func resolveRepo(db *DB, exportName string) (string, error) {
	rows, err := db.conn.Query(
		`SELECT r.path, r.name FROM git_repos r
		 INNER JOIN p2p_shared_repos s ON s.repo_id = r.id`,
	)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	for rows.Next() {
		var repoPath, name string
		if err := rows.Scan(&repoPath, &name); err != nil {
			continue
		}
		sanitized := sanitizeRe.ReplaceAllString(name, "_")
		if sanitized == exportName {
			return repoPath, nil
		}
	}
	return "", fmt.Errorf("repository not found: %s", exportName)
}
