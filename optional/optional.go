package optional

import "log"

type Optional[T any] struct {
	val *T
}

func Some[T any](val T) Optional[T] {
	return Optional[T]{
		val: &val,
	}
}

func None[T any]() Optional[T] {
	return Optional[T]{
		val: nil,
	}
}

func (o *Optional[T]) Unwrap() T {
	if o.val == nil {
		panic("option is nil")
	}

	return *o.val
}

func (o *Optional[T]) Valid() bool {
	return o.val == nil
}

func MatchOpt[T any](opt Optional[T], some func(T), none func()) {
	if opt.Valid() {
		some(*opt.val)
	} else {
		none()
	}
}

func Test() {
	MatchOpt(
		Some(1),
		func(i int) {
			log.Println(i)
		},
		func() {
		},
	)
}
