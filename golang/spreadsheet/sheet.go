package main

import (
	"fmt"
	"iter"
	"strings"
	"unicode"
)

type CellValue struct {
	input string
	value any
}

func (cv *CellValue) String() string {
	if cv.value != nil {
		return fmt.Sprint(cv.value)
	}

	return cv.input
}

func (cv *CellValue) Value() any {
	if cv.value != nil {
		return cv.value
	}

	return cv.input
}

type Sheet struct {
	cols         []string
	rows         []int64
	data         map[string]*CellValue
	dependencies map[string][]string
	reverseDeps  map[string][]string
	formulas     map[string]Expr
	dirty        map[string]struct{}
}

func NewSheet() *Sheet {
	return &Sheet{
		data:         map[string]*CellValue{},
		dependencies: map[string][]string{},
		formulas:     map[string]Expr{},
		reverseDeps:  map[string][]string{},
		dirty:        map[string]struct{}{},
	}
}

func (sh *Sheet) Cols() iter.Seq2[int, string] {
	return func(yield func(int, string) bool) {
		cols := sh.cols
		for i := range cols {
			yield(i, cols[i])
		}
	}
}

func (sh *Sheet) Rows() iter.Seq2[int, int64] {
	return func(yield func(int, int64) bool) {
		rows := sh.rows
		for i := range rows {
			if !yield(i, rows[i]) {
				return
			}
		}
	}
}

func (sh *Sheet) Cells() iter.Seq2[string, string] {
	return func(yield func(string, string) bool) {
		for k, v := range sh.data {
			if v == nil {
				continue
			}

			vp := *v
			yield(k, vp.String())
		}
	}
}

func (sh *Sheet) Dirty() iter.Seq[string] {
	return func(yield func(string) bool) {
		for k := range sh.dirty {
			if !yield(k) {
				return
			}
		}
	}
}

func (sh *Sheet) AppendColumn(
	cell string,
	values []string,
) {
	cell = strings.TrimRightFunc(cell, func(r rune) bool {
		return unicode.IsDigit(r)
	})

	for i := range values {
		newCell := fmt.Sprintf("%s%d", cell, i+1)
		sh.Update(newCell, values[i])
	}
}

func (sh *Sheet) Update(cell string, value string) error {
	if value == "" {
		delete(sh.data, cell)
		delete(sh.reverseDeps, cell)
		delete(sh.dependencies, cell)
		sh.dirty[cell] = struct{}{}
		return nil
	}

	if !strings.HasPrefix(value, "=") {
		sh.data[cell] = &CellValue{
			input: value,
		}
		sh.dirty[cell] = struct{}{}
		return nil
	}

	expr, deps, err := ParseFormula(value)
	if err != nil {
		return err
	}

	for _, dep := range sh.dependencies[cell] {
		newRev := []string{}
		for _, rev := range sh.reverseDeps[dep] {
			if rev != cell {
				newRev = append(newRev, rev)
			}
		}
		sh.reverseDeps[dep] = newRev
	}

	for _, dep := range deps {
		sh.reverseDeps[dep] = append(sh.reverseDeps[dep], cell)
	}

	sh.data[cell] = &CellValue{
		input: value,
	}
	sh.formulas[cell] = expr
	sh.dirty[cell] = struct{}{}
	sh.dependencies[cell] = deps

	return nil
}

func (sh *Sheet) Eval() error {
	order, err := sh.TopoSort()
	if err != nil {
		return err
	}

	var markDirty func(cell string)
	visited := map[string]bool{}

	markDirty = func(cell string) {
		if visited[cell] {
			return
		}

		visited[cell] = true
		sh.dirty[cell] = struct{}{}

		for _, dep := range sh.reverseDeps[cell] {
			markDirty(dep)
		}
	}

	for cell := range sh.dirty {
		markDirty(cell)
	}

	clear(sh.dirty)

	for _, cell := range order {
		expr, ok := sh.formulas[cell]
		if !ok {
			continue
		}

		val, err := sh.evalExpr(expr)
		if err != nil {
			if sh.data[cell].value != INVALID {
				sh.data[cell].value = INVALID
				sh.dirty[cell] = struct{}{}
			}

			continue
		}

		prev := sh.data[cell].value
		sh.data[cell].value = val.value
		if prev != val.value {
			sh.dirty[cell] = struct{}{}
		}
	}

	return nil
}

func (sh *Sheet) Reset() {
	clear(sh.cols)
	clear(sh.rows)
	clear(sh.data)
	clear(sh.formulas)
	clear(sh.dirty)
	clear(sh.reverseDeps)
}

func (sh *Sheet) TopoSort() ([]string, error) {
	inDegree := map[string]int{}
	graph := map[string][]string{}

	for cell := range sh.formulas {
		if _, ok := inDegree[cell]; !ok {
			inDegree[cell] = 0
		}

		for _, dep := range sh.dependencies[cell] {
			graph[dep] = append(graph[dep], cell)

			if _, ok := inDegree[dep]; !ok {
				inDegree[dep] = 0
			}

			inDegree[cell]++
		}
	}

	var queue []string

	for cell, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, cell)
		}
	}

	var sorted []string

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		sorted = append(sorted, curr)

		for _, neighbor := range graph[curr] {
			inDegree[neighbor]--
			if inDegree[neighbor] == 0 {
				queue = append(queue, neighbor)
			}
		}
	}

	if len(sorted) != len(inDegree) {
		return nil, fmt.Errorf("cyclic dependency detected")
	}

	return sorted, nil
}
