package repo

import (
	"context"
	"fmt"
	"log"
	"slices"
	"strings"

	"github.com/jackc/pgconn"
	"github.com/jackc/pgx/v4"
	"github.com/jackc/pgx/v4/pgxpool"
)

type DBInterface interface {
	// QueryContext(ctx context.Context, stmt string, args ...any) (*sql.Rows, error)
	// QueryRowContext(ctx context.Context, stmt string, args ...any) *sql.Row
	// ExecContext(ctx context.Context, stmt string, args ...any) (sql.Result, error)

	Query(c context.Context, stmt string, args ...any) (pgx.Rows, error)
	QueryRow(c context.Context, stmt string, args ...any) pgx.Row
	Exec(c context.Context, stmt string, args ...any) (pgconn.CommandTag, error)
}

type Accessor[T any] func(*T) any

type SQLMap[T any] map[string]Accessor[T]

type IMapper[T any] interface {
	Mapper() SQLMap[T]
}

type SQLRepo[T any] struct {
	db        *pgxpool.Pool
	table     string
	pks       []string
	keys      []string
	accessors []Accessor[T]
}

func NewSQLRepo[T IMapper[T]](
	table string,
	pks []string,
) *SQLRepo[T] {
	var empty T
	mapper := empty.Mapper()

	if len(pks) == 0 {
		panic("missing primary keys")
	}

	if len(mapper) == 0 {
		panic("invalid mapper returned - no entries")
	}

	keys := []string{}
	accessors := []Accessor[T]{}

	for k, v := range mapper {
		keys = append(keys, k)
		accessors = append(accessors, v)
	}

	return &SQLRepo[T]{
		table:     table,
		keys:      keys,
		pks:       pks,
		accessors: accessors,
	}
}

func (r *SQLRepo[T]) SetDB(pool *pgxpool.Pool) {
	r.db = pool
}

func (r *SQLRepo[T]) DB() *pgxpool.Pool {
	if (r.db) == nil {
		panic("error - nil pointer for SQLRepo DB()")
	}

	return r.db
}

func (r *SQLRepo[T]) Count(db DBInterface, stmt string, args ...any) (int, error) {
	params := WrapParams(args...)
	count := 0

	err := db.QueryRow(context.Background(), fmt.Sprintf("SELECT COUNT(*) FROM %s %s", r.table, stmt), params...).Scan(&count)
	if err != nil {
		return 0, err
	}

	return count, nil
}

func (r *SQLRepo[T]) Select(
	db DBInterface,
	suffix string,
	args ...any,
) ([]*T, error) {
	params := WrapParams(args...)

	joinKeys := slices.Clone(r.keys)
	for i := range joinKeys {
		joinKeys[i] = string(r.table[0]) + "." + joinKeys[i]
	}

	sql := fmt.Sprintf("SELECT %s FROM %s %s %s", strings.Join(r.keys, ", "), r.table, string(r.table[0]), suffix)
	log.Println(sql)

	rows, err := query(
		db,
		sql,
		params...,
	)
	if err != nil {
		return nil, fmt.Errorf("query error - %w", err)
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
			return nil, fmt.Errorf("scan error - %w", err)
		}

		res = append(res, &item)
	}

	return res, nil
}

// This function is designed to be used for joins
// The table the repo is mapped to uses the first letter of the table name
// e.g. table name = matches, sql is select <cols> from matches m
func (r *SQLRepo[T]) SelectJoin(
	db DBInterface,
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

func (r *SQLRepo[T]) SelectOne(
	db DBInterface,
	suffix string,
	args ...any,
) (*T, error) {
	var res T
	params := WrapParams(args...)

	dest := []any{}
	for _, f := range r.accessors {
		dest = append(dest, f(&res))
	}

	err := queryRow(
		db,
		fmt.Sprintf("SELECT %s FROM %s %s LIMIT 1", strings.Join(r.keys, ", "), r.table, suffix), params...).Scan(dest...)
	if err != nil {
		return nil, err
	}

	return &res, nil
}

func (r *SQLRepo[T]) Insert(
	db DBInterface,
	item *T,
	suffix ...string,
) error {
	values := []any{}
	placeholders := []string{}

	for i, f := range r.accessors {
		values = append(values, f(item))
		placeholders = append(placeholders, fmt.Sprintf("$%d", i+1))
	}

	suffixS := ""
	if len(suffix) == 1 {
		suffixS = suffix[0]
	}

	_, err := db.Exec(
		context.Background(),
		fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) %s", r.table, strings.Join(r.keys, ", "), strings.Join(placeholders, ", "), suffixS),
		values...,
	)

	return err
}

func (r *SQLRepo[T]) Update(
	db DBInterface,
	stmt string,
	args ...any,
) error {
	values := WrapParams(args...)
	// placeholders := []string{}
	// setters := []string{}
	// pks := []string{}

	// for i, f := range r.accessors {
	// 	values = append(values, f(item))
	// 	placeholders = append(placeholders, strconv.Itoa(i))
	// }

	// for i, k := range r.keys {
	// 	if slices.Contains(r.pks, k) {
	// 		pks = append(pks, fmt.Sprintf("%s = $c%d", k, i+1))
	// 	}
	// 	setters = append(setters, fmt.Sprintf("%s = $c%d", k, i+1))
	// }
	//
	// _, err := db.Exec(fmt.Sprintf("UPDATE %s SET %s WHERE %s", r.table, strings.Join(setters, ", "), strings.Join(pks, ", ")), values...)

	_, err := db.Exec(context.Background(), fmt.Sprintf("UPDATE %s %s", r.table, stmt), values...)

	return err
}

func (r *SQLRepo[T]) Upsert(
	db DBInterface,
	item *T,
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
		values = append(values, f(item))
		placeholders = append(placeholders, fmt.Sprintf("$%d", i+1))
	}

	setters := []string{}
	for i, k := range r.keys {
		if slices.Contains(r.pks, k) {
			continue
		}

		if slices.Contains(ignored, k) {
			continue
		}

		setters = append(setters, fmt.Sprintf("%s = $%d", k, i+1))
	}

	stmt :=
		fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s",
			r.table,
			strings.Join(r.keys, ", "),
			strings.Join(placeholders, ", "),
			strings.Join(defaultKeys, ", "),
			strings.Join(setters, ", "),
		)

	// log.Println("stmt", stmt)

	err := exec(
		db,
		stmt,
		values...,
	)

	return err
}

func (r *SQLRepo[T]) Delete(
	db DBInterface,
	suffix string,
	args ...any,
) error {
	_, err := db.Exec(context.Background(), fmt.Sprintf("DELETE FROM %s %s", r.table, suffix), args...)
	return err
}

func WrapParams(args ...any) []any {
	return args
}

func query(db DBInterface, stmt string, args ...any) (pgx.Rows, error) {
	if len(args) > 0 {
		return db.Query(
			context.Background(),
			stmt,
			args...,
		)
	}
	return db.Query(
		context.Background(),
		stmt,
	)
}

func queryRow(db DBInterface, stmt string, args ...any) pgx.Row {
	if len(args) > 0 {
		return db.QueryRow(context.Background(), stmt, args...)
	}

	return db.QueryRow(context.Background(), stmt)
}
func exec(db DBInterface, stmt string, args ...any) error {
	// log.Println(stmt)
	_, err := db.Exec(context.Background(), stmt, args...)
	return err
}
