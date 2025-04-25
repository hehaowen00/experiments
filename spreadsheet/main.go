package main

import (
	"fmt"
	"net/http"
)

func main() {
	sh := NewSheet()

	sh.Update("A1", "=1+2")
	sh.Update("A2", "=A1+3")
	sh.Update("B1", "=SUM(NORM(0,1),NORM(0,1))")
	sh.Update("A3", "=SUM(A1:A2)")
	sh.Update("D1", "=SUM(A1:B5)")
	sh.Update("C1", "hello")
	sh.Update("C2", "world")
	sh.Update("C3", "goodbye")
	sh.Update("E1", "=E()")
	sh.Update("E2", "=PI()")

	err := sh.Eval()
	if err != nil {
		panic(err)
	}

	for idx, cell := range sh.Cells() {
		fmt.Println(idx, cell)
	}

	for cell := range sh.Dirty() {
		fmt.Println("dirty", cell)
	}

	sh.Reset()

	sh.Update("A1", "Name")
	sh.Update("B1", "Score")
	sh.Update("A2", "Alice")
	sh.Update("A3", "Bob")
	sh.Update("A4", "Charlie")
	sh.Update("B2", "85")
	sh.Update("B3", "92")
	sh.Update("B4", "78")

	sh.Update("D1", "Charlie")
	sh.Update("D2", "=VLOOKUP(D1,A2:B4,2)")

	err = sh.Eval()
	if err != nil {
		panic(err)
	}

	for idx, cell := range sh.Cells() {
		fmt.Println(idx, cell)
	}

	for cell := range sh.Dirty() {
		fmt.Println("dirty", cell)
	}

	sh.Reset()

	sh.AppendColumn("A", []string{"1", "2", "3"})
	sh.Update("B1", "=NOW()")
	sh.Update("C1", "=1>2")
	sh.Update("C2", "=1<2")
	sh.Update("C3", "=RAND()")
	sh.Update("C4", "=ABS(C3)")
	sh.Eval()

	for idx, cell := range sh.Cells() {
		fmt.Println(idx, cell)
	}

	sh.Reset()

	sh.Update("A1", "=BINOM.INV()")
	sh.Update("B1", "=NOW()")
	sh.Eval()

	for idx, cell := range sh.Cells() {
		fmt.Println(idx, cell)
	}

	for cell := range sh.Dirty() {
		fmt.Println("dirty", cell)
	}

	sh.Eval()

	for idx, cell := range sh.Cells() {
		fmt.Println(idx, cell)
	}
	for cell := range sh.Dirty() {
		fmt.Println("dirty", cell)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {})
	http.ListenAndServe(":8080", mux)
}
