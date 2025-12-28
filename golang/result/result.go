package result

import (
	"errors"
	"log"
)

type Result[T any] struct {
	value T
	err   error
}

func Wrap[T any](value T, err error) Result[T] {
	return Result[T]{
		value: value,
		err:   err,
	}
}

func (r Result[T]) Valid() bool {
	return r.err == nil
}

func (r Result[T]) Value() T {
	return r.value
}

func (r Result[T]) Err() error {
	return r.err
}

func (r Result[T]) Unwrap() (T, error) {
	return r.value, r.err
}

func IfElse[T any](
	condition bool,
	a func() Result[T],
	b func() Result[T],
) Result[T] {
	if condition {
		return a()
	}
	return b()
}

func Match[T any](res Result[T], a func(T), b func(error)) {
	if res.Valid() {
		a(res.value)
	} else {
		b(res.err)
	}
}

func Test() {
	shouldUseA := false

	res := IfElse(
		shouldUseA,
		func() Result[string] {
			return Wrap("", nil)
		},
		func() Result[string] {
			return Wrap("", errors.New(""))
		})

	Match(
		res,
		func(s string) {
			log.Println(s)
		},
		func(err error) {
			log.Println(err)
		},
	)

}
