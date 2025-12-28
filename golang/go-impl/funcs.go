package go_impl

import (
	"iter"
)

func LShift[T any](slice []T, start, count int) {
	if len(slice) == 0 || start+count > len(slice) {
		return
	}

	for i := range count {
		slice[start+i] = slice[start+i+1]
	}
}

func Zip[L any, R any](ls []L, rs []R) iter.Seq2[L, R] {
	if len(ls) != len(rs) {
		panic("out of bounds")
	}

	return func(yield func(l L, r R) bool) {
		for i := range ls {
			yield(ls[i], rs[i])
		}
	}
}
