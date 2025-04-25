package repo

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"
)

type SQL interface {
	ID_() []string
	Cols() []string
}

type Repo[T SQL] struct {
	db      *sql.DB
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

func NewRepo[T Mapper[T]](conn *sql.DB, table string) *Repo[T] {
	var payload T

	ids := payload.ID_()
	cols := payload.Cols()
	interfaces := payload.Scan(&payload)

	if len(ids) >= len(cols) || len(cols) != len(interfaces) {
		panic("number of columns does not match number of params")
	}

	acc := []string{}
	setParams := []string{}
	idParams := []string{}

	for i, s := range payload.ID_() {
		_ = i
		idParams = append(idParams, fmt.Sprintf("%s = ?", s))
	}

	for i := range len(cols[len(idParams):]) {
		setParams = append(setParams, fmt.Sprintf("%s = ?", cols[i+len(idParams)]))
	}

	for i := range len(cols) {
		_ = i
		acc = append(acc, "?")
	}

	params := strings.Join(acc, ", ")
	setParamsStr := strings.Join(setParams, ", ")
	idParamsStr := strings.Join(idParams, ", ")

	return &Repo[T]{
		db: conn,
		stmts: []string{
			fmt.Sprintf("select %s from %s", strings.Join(cols, ", "), table),
			fmt.Sprintf("insert into %s (%s) values (%s)", table, strings.Join(payload.Cols(), ", "), params),
			fmt.Sprintf("update %s set %s where %s", table, setParamsStr, idParamsStr),
			fmt.Sprintf("delete from %s where %s", table, idParamsStr),
			fmt.Sprintf("insert into %s (%s) values (%s) on conflict (%s) do update set %s", table, strings.Join(payload.Cols(), ", "), params, strings.Join(ids, ", "), setParamsStr),
		},
		scanner: payload.Scan,
		id:      ids,
	}
}

func (repo *Repo[T]) Log() {
	s, _ := json.MarshalIndent(repo.stmts, "", "  ")
	log.Println(string(s))
}

func (repo *Repo[T]) Select(filter string, args ...any) ([]*T, error) {
	stmt := repo.stmts[0]
	if filter != "" {
		stmt = fmt.Sprintf("%s where %s", stmt, filter)
	}

	rows, err := repo.db.Query(stmt, args...)
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

func (repo *Repo[T]) Insert(resp T) error {
	_, err := repo.db.Exec(repo.stmts[1], repo.scanner(&resp)...)
	return err
}

func (repo *Repo[T]) Upsert(resp T) error {
	_, err := repo.db.Exec(repo.stmts[4], repo.scanner(&resp)...)
	return err
}

func (repo *Repo[T]) Update(resp T) error {
	_, err := repo.db.Exec(repo.stmts[2], repo.scanner(&resp)...)
	return err
}

func (repo *Repo[T]) Delete(resp T) error {
	_, err := repo.db.Exec(
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

	rows, err := repo.db.Query(stmt, args...)
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
