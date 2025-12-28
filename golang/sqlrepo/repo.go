package sqlrepo

import (
	"context"
	"database/sql"
	"fmt"
	"slices"
	"strings"

	"sqlrepo/sqlmap"
)

type IDB interface {
	QueryContext(ctx context.Context, stmt string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, stmt string, args ...any) *sql.Row
	ExecContext(ctx context.Context, stmt string, args ...any) (sql.Result, error)
}

type Repo[T any] struct {
	db        *sql.DB
	table     string
	pks       []string
	keys      []string
	accessors []sqlmap.Accessor[T]
}

func New[T sqlmap.IMapper[T]](
	db *sql.DB,
	table string,
	pks []string,
) *Repo[T] {
	var empty T
	mapper := empty.Mapper()

	keys := []string{}
	accessors := []sqlmap.Accessor[T]{}

	for k, v := range mapper {
		keys = append(keys, k)
		accessors = append(accessors, v)
	}

	return &Repo[T]{
		db:        db,
		table:     table,
		keys:      keys,
		pks:       pks,
		accessors: accessors,
	}
}

func (r *Repo[T]) DB() *sql.DB {
	return r.db
}

func (r *Repo[T]) Count(
	db IDB, ctx context.Context, stmt string, args ...any,
) (int, error) {
	params := WrapParams(args...)
	count := 0

	err := db.QueryRowContext(
		ctx,
		fmt.Sprintf("SELECT COUNT(*) FROM %s %s", r.table, stmt),
		params...,
	).Scan(&count)
	if err != nil {
		return 0, err
	}

	return count, nil
}

func (r *Repo[T]) Select(
	db IDB,
	ctx context.Context,
	suffix string,
	args ...any,
) ([]T, error) {
	params := WrapParams(args...)

	joinKeys := slices.Clone(r.keys)
	for i := range joinKeys {
		joinKeys[i] = string(r.table[0]) + "." + joinKeys[i]
	}

	rows, err := query(
		db,
		ctx,
		fmt.Sprintf("SELECT %s FROM %s %s %s", strings.Join(r.keys, ", "), r.table, string(r.table[0]), suffix),
		params...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := []T{}

	for rows.Next() {
		var item T

		values := []any{}
		for _, f := range r.accessors {
			values = append(values, f(&item))
		}

		err = rows.Scan(values...)
		if err != nil {
			panic(err)
		}

		res = append(res, item)
	}

	return res, nil
}

// SelectJoin does a normal select query and assigned a single letter name to the table
// the name is the first letter of the table name stored in the repo
func (r *Repo[T]) SelectJoin(
	db IDB,
	ctx context.Context,
	suffix string,
	args ...any,
) ([]*T, error) {
	params := WrapParams(args...)

	joinKeys := slices.Clone(r.keys)
	for i := range joinKeys {
		joinKeys[i] = string(r.table[0]) + "." + joinKeys[i]
	}

	rows, err := query(
		db,
		ctx,
		fmt.Sprintf("SELECT %s FROM %s %s %s", strings.Join(joinKeys, ", "), r.table, string(r.table[0]), suffix),
		params...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	res := []*T{}

	for rows.Next() {
		var item T

		values := []any{}
		for _, f := range r.accessors {
			values = append(values, f(&item))
		}

		err = rows.Scan(values...)
		if err != nil {
			panic(err)
		}

		res = append(res, &item)
	}

	return res, nil
}

func (r *Repo[T]) SelectOne(
	db IDB,
	ctx context.Context,
	suffix string,
	args ...any,
) (T, error) {
	var res T
	params := WrapParams(args...)

	dest := []any{}
	for _, f := range r.accessors {
		dest = append(dest, f(&res))
	}

	stmt := fmt.Sprintf("SELECT %s FROM %s %s LIMIT 1", strings.Join(r.keys, ", "), r.table, suffix)

	err := queryRow(
		db,
		ctx,
		stmt,
		params...,
	).Scan(dest...)
	if err != nil {
		var empty T
		return empty, err
	}

	return res, nil
}
func (r *Repo[T]) Insert(
	db IDB,
	ctx context.Context,
	item T,
) error {
	values := []any{}
	placeholders := []string{}

	for i, f := range r.accessors {
		values = append(values, f(&item))
		placeholders = append(placeholders, fmt.Sprintf("$c%d", i+1))
	}

	err := exec(
		db,
		ctx,
		fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s)", r.table, strings.Join(r.keys, ", "), strings.Join(placeholders, ", ")),
		values...,
	)

	return err
}

func (r *Repo[T]) Update(
	db IDB,
	ctx context.Context,
	stmt string,
	args ...any,
) error {
	values := WrapParams(args...)
	err := exec(db, ctx, fmt.Sprintf("UPDATE %s %s", r.table, stmt), values...)
	return err
}

func (r *Repo[T]) Upsert(
	db IDB,
	ctx context.Context,
	item T,
	ignored []string,
	conflict []string,
) error {
	values := []any{}
	placeholders := []string{}

	defaultKeys := []string{}
	if len(conflict) > 0 {
		defaultKeys = conflict
	} else {
		defaultKeys = r.pks
	}

	for i, f := range r.accessors {
		values = append(values, f(&item))
		placeholders = append(placeholders, fmt.Sprintf("$c%d", i+1))
	}

	setters := []string{}
	for i, k := range r.keys {
		if slices.Contains(r.pks, k) {
			continue
		}

		if slices.Contains(ignored, k) {
			continue
		}

		setters = append(setters, fmt.Sprintf("%s = $c%d", k, i+1))
	}

	err := exec(
		db,
		ctx,
		fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s",
			r.table,
			strings.Join(r.keys, ", "),
			strings.Join(placeholders, ", "),
			strings.Join(defaultKeys, ", "),
			strings.Join(setters, ", "),
		),
		values...,
	)

	return err
}

func (r *Repo[T]) Delete(
	db IDB,
	ctx context.Context,
	suffix string,
	args ...any,
) error {
	_, err := db.ExecContext(ctx, fmt.Sprintf("DELETE FROM %s %s", r.table, suffix), args...)
	return err
}

func WrapParams(args ...any) []any {
	values := []any{}
	for i, v := range args {
		values = append(values, sql.Named(fmt.Sprintf("c%d", i+1), v))
	}
	return values
}

func query(db IDB, ctx context.Context, stmt string, args ...any) (*sql.Rows, error) {
	if len(args) > 0 {
		return db.QueryContext(ctx, stmt, args...)
	}

	return db.QueryContext(ctx, stmt)
}

func queryRow(db IDB, ctx context.Context, stmt string, args ...any) *sql.Row {
	if len(args) > 0 {
		return db.QueryRowContext(ctx, stmt, args...)
	}

	return db.QueryRowContext(ctx, stmt)
}

func exec(db IDB, ctx context.Context, stmt string, args ...any) error {
	_, err := db.ExecContext(ctx, stmt, args...)
	return err
}
