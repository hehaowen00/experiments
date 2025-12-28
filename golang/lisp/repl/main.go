package main

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"strings"

	"lisp"
)

func main() {
	log.SetFlags(log.Lshortfile | log.Ltime)

	rdr := bufio.NewReader(os.Stdin)
	frame := lisp.NewFrame()

	for {
		fmt.Print("> ")
		line, _, err := rdr.ReadLine()
		if err != nil {
			log.Println(err)
			continue
		}

		if line[0] == ';' {
			continue
		}

		ast, _, err := lisp.Parse(lisp.Tokenize(string(line)))
		if err != nil {
			fmt.Println("error:", err.Error())

			if strings.TrimSpace(string(line)) == "" {
				return
			}

			continue
		}

		fmt.Println("\nAST:")
		lisp.FmtAST(os.Stdin, ast, "")
		fmt.Println()

		result, err := lisp.Eval(ast, frame)
		if err != nil {
			log.Println(err)
			lisp.FmtAST(os.Stdout, result, "")
			fmt.Println("\n")
			continue
		}

		if result == nil {
			break
		}

		lisp.FmtAST(os.Stdin, result, "")
		fmt.Println("")
	}
}
