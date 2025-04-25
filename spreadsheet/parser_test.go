package main

import (
	"fmt"
	"testing"
)

func TestParser(t *testing.T) {
	formula := "=POW(SUM(A1:B3,A5,A6*2),2)"
	ast, deps, err := ParseFormula(formula)
	if err != nil {
		fmt.Println("Parse error:", err)
	} else {
		fmt.Printf("AST: %#v\n", ast)
		fmt.Printf("Dependencies: %v\n", deps)
	}
}
