package main

import (
	"fmt"
	"io"
	"os"
)

func zeros[T any](length int) []T {
	return make([]T, length)
}

func repeat[T any](length int, value T) []T {
	arr := zeros[T](length)
	for i := range arr {
		arr[i] = value
	}
	return arr
}

func linspace(start, end float64, length int) []float64 {
	arr := []float64{}
	if start > end {
		temp := start
		start = end
		end = temp
	}

	step := (end - start) / float64(length)

	arr = append(arr, start)
	curr := start
	for curr != end {
		arr = append(arr, curr+step)
		curr = curr + step
	}

	return arr
}

type MCMC struct {
	h          []float64
	omega      []float64
	likelihood []float64
}

func mcmc(
	iterations int,
	hStep float64,
	omegaMStep float64,
) MCMC {
	chain := MCMC{
		h:          zeros[float64](iterations),
		omega:      zeros[float64](iterations),
		likelihood: zeros[float64](iterations),
	}

	return chain
}

func main() {
	f, err := os.OpenFile("data.txt", os.O_RDONLY, 0777)
	if err != nil {
		panic(err)
	}

	data, err := io.ReadAll(f)
	if err != nil {
		panic(err)
	}

	fmt.Println(string(data))

	fmt.Println(linspace(0, 5, 10))
}
