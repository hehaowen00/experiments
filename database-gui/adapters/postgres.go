package adapters

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type PostgresConn struct {
	pool *pgx.Conn
}

func NewPostgresConn() *PostgresConn {
	return &PostgresConn{}
}

func (conn *PostgresConn) Close(
	ctx context.Context,
) error {
	return nil
}
