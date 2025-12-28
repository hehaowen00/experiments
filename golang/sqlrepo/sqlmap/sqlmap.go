package sqlmap

type Accessor[T any] func(*T) any

type SQLMap[T any] map[string]Accessor[T]

type IMapper[T any] interface {
	Mapper() SQLMap[T]
}
