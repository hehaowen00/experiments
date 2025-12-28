package main

import "os"

func main() {
	entries, err := os.ReadDir(".")
	if err != nil {
		panic(err)
	}

	for _, e := range entries {
		_ = e
	}
}
