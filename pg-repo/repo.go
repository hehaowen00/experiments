package repo

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/jackc/pgx/v4"
	"github.com/jackc/pgx/v4/pgxpool"
)

type SQL interface {
	ID_() []string
	Cols() []string
}

type Repo[T SQL] struct {
	pool    *pgxpool.Pool
	stmts   []string
	table   string
	scanner Accessor[T]
	id      []string
}

type Mapper[T SQL] interface {
	SQL
	Scan(*T) []interface{}
}

type Accessor[T SQL] func(*T) []interface{}

func NewRepo[T Mapper[T]](pool *pgxpool.Pool, table string) *Repo[T] {
	var payload T

	ids := payload.ID_()
	cols := payload.Cols()
	interfaces := payload.Scan(&payload)

	if len(ids) > 0 && len(ids) >= len(cols) ||
		len(cols) != len(interfaces) {
		panic("number of columns does not match number of params")
	}

	acc := []string{}
	setParams := []string{}
	idParams := []string{}

	for i, s := range payload.ID_() {
		idParams = append(idParams, fmt.Sprintf("%s = $%d", s, i+1))
	}

	upsertCols := []string{}
	cleanedCols := []string{}

	for i := range len(cols[len(idParams):]) {
		if !strings.HasPrefix(cols[i+len(idParams)], "!") {
			upsertCols = append(upsertCols,
				fmt.Sprintf("%s = $%d", clean(cols[i+len(idParams)]),
					i+1+len(idParams)))
		}

		col := clean(cols[i+len(idParams)])
		setParams = append(setParams,
			fmt.Sprintf("%s = $%d", col, i+1+len(idParams)))
		cleanedCols = append(cleanedCols, col)
	}

	for i := range len(cols) {
		cols[i] = clean(cols[i])
		acc = append(acc, fmt.Sprintf("$%d", i+1))
	}

	upsertParams := strings.Join(upsertCols, ", ")
	params := strings.Join(acc, ", ")
	setParamsStr := strings.Join(setParams, ", ")
	idParamsStr := strings.Join(idParams, ", ")

	return &Repo[T]{
		pool: pool,
		stmts: []string{
			fmt.Sprintf("select %s from %s",
				strings.Join(cols, ", "), table,
			),
			fmt.Sprintf("insert into %s (%s) values (%s)",
				table, strings.Join(cleanedCols, ", "), params,
			),
			fmt.Sprintf("update %s set %s where %s",
				table, setParamsStr, idParamsStr,
			),
			fmt.Sprintf("delete from %s where %s",
				table, idParamsStr,
			),
			fmt.Sprintf("insert into %s (%s) values (%s) on conflict (%s) do update set %s",
				table, strings.Join(cols, ", "), params,
				strings.Join(ids, ", "), upsertParams,
			),
		},
		scanner: payload.Scan,
		id:      ids,
	}
}

func (repo *Repo[T]) Table() string {
	return repo.table
}

func (repo *Repo[T]) Log() {
	s, _ := json.MarshalIndent(repo.stmts, "", "  ")
	log.Println(string(s))
}

func (repo *Repo[T]) Select(filter string, args ...any) ([]*T, error) {
	stmt := repo.stmts[0]
	if filter != "" {
		stmt = fmt.Sprintf("%s %s", stmt, filter)
	}

	rows, err := query(repo.pool, stmt, args)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []*T

	for rows.Next() {
		var item T

		err = rows.Scan(repo.scanner(&item)...)
		if err != nil {
			return nil, err
		}

		items = append(items, &item)
	}

	return items, nil
}

func (repo *Repo[T]) SelectOne(filter string, args ...any) (*T, error) {
	stmt := repo.stmts[0]
	if filter != "" {
		stmt = fmt.Sprintf("%s %s", stmt, filter)
	}

	var item T

	err := repo.pool.QueryRow(context.Background(),
		stmt+" LIMIT 1", args...).Scan(repo.scanner(&item)...)
	if err != nil {
		return nil, err
	}

	return &item, nil
}

func (repo *Repo[T]) Insert(resp T) error {
	_, err := repo.pool.Exec(context.Background(),
		repo.stmts[1], repo.scanner(&resp)...)
	return err
}

func (repo *Repo[T]) Upsert(resp T) error {
	_, err := repo.pool.Exec(context.Background(),
		repo.stmts[4], repo.scanner(&resp)...)
	return err
}

func (repo *Repo[T]) Update(resp T) error {
	_, err := repo.pool.Exec(context.Background(),
		repo.stmts[2], repo.scanner(&resp)...)
	return err
}

func (repo *Repo[T]) Delete(resp T) error {
	_, err := repo.pool.Exec(
		context.Background(),
		repo.stmts[3],
		repo.scanner(&resp)[:len(repo.id)]...,
	)
	return err
}

func (repo *Repo[T]) Each(filter string, args []any, handler func(*T) error) error {
	stmt := repo.stmts[0]
	if filter != "" {
		stmt = fmt.Sprintf("%s %s", stmt, filter)
	}

	rows, err := query(repo.pool, stmt, args)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var item T

		err = rows.Scan(repo.scanner(&item)...)
		if err != nil {
			return err
		}

		err = handler(&item)
		if err != nil {
			return err
		}
	}

	return nil
}

func (repo *Repo[T]) Values(filter string, args ...any) ([][]any, error) {
	stmt := repo.stmts[0]
	if filter != "" {
		stmt = fmt.Sprintf("%s %s", stmt, filter)
	}

	rows, err := query(repo.pool, stmt, args)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items [][]any

	var payload T
	cols := payload.Cols()
	items = append(items, toAny(cols))

	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("values err - %w", err)
		}
		items = append(items, vals)
	}

	return items, nil
}

func query(
	pool *pgxpool.Pool,
	query string,
	args []any,
) (pgx.Rows, error) {
	if len(args) == 0 {
		return pool.Query(context.Background(), query)
	}
	return pool.Query(context.Background(), query, args...)
}

func toAny(xs []string) []any {
	res := make([]any, len(xs))
	for i := range xs {
		res[i] = xs[i]
	}
	return res
}

func clean(s string) string {
	return strings.TrimPrefix(s, "!")
}
