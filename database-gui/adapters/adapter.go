package adapters

import "context"

type Adapter interface {
	LoadTable(name string) (Columns, Data)
	Close(ctx context.Context) error
}

type Columns struct {
	data map[string]string
}

type Data struct {
	data [][]any
}
