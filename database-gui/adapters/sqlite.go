package adapters

import "database/sql"

type SQLiteConn struct {
	conn *sql.DB
}

func NewSQLiteConn() *SQLiteConn {
	return &SQLiteConn{}
}
