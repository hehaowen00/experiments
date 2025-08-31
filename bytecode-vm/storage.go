package main

type Storage struct {
}

type Table struct {
	name    string
	data    [][]any
	fields  []string
	types   []TypeDef
	indexes map[string][]int
}

type TypeDef struct {
	BaseType byte
	IsSlice  bool
}

type Schema struct {
	TableName string
	types     []TypeDef
}
