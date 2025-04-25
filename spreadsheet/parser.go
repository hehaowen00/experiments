package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type (
	Expr any

	Number struct {
		Value float64
	}

	StringLit struct {
		Value string
	}

	Cell struct {
		Ref string
	}

	BinaryExpr struct {
		Op    string
		Left  Expr
		Right Expr
	}

	FuncCall struct {
		Name string
		Args []Expr
	}

	Range struct {
		Start string
		End   string
	}
)

func ParseFormula(formula string) (Expr, []string, error) {
	formula = strings.TrimSpace(formula)
	if !strings.HasPrefix(formula, "=") {
		return nil, nil, fmt.Errorf("not a formula")
	}

	tokens := tokenize(formula[1:])
	parser := &Parser{
		tokens: tokens,
	}

	ast, err := parser.parseExpr()
	if err != nil {
		return nil, nil, err
	}

	deps := collectDeps(ast)

	return ast, deps, nil
}

var tokenPattern = regexp.MustCompile(`\s*(>=|<=|==|!=|>|<|[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*|[0-9.]+|[(),:+\-*/])\s*`)

func tokenize(s string) []string {
	var tokens []string

	matches := tokenPattern.FindAllStringSubmatch(s, -1)
	for _, match := range matches {
		tokens = append(tokens, strings.TrimSpace(match[1]))
	}

	return tokens
}

type Parser struct {
	tokens []string
	pos    int
}

func (p *Parser) next() string {
	if p.pos >= len(p.tokens) {
		return ""
	}
	tok := p.tokens[p.pos]
	p.pos++
	return tok
}

func (p *Parser) peek() string {
	if p.pos >= len(p.tokens) {
		return ""
	}
	return p.tokens[p.pos]
}

func (p *Parser) parseExpr() (Expr, error) {
	return p.parseBinary(0)
}

var precedence = map[string]int{
	"+":  1,
	"-":  1,
	"*":  2,
	"/":  2,
	">":  3,
	"<":  3,
	"<=": 3,
	">=": 3,
	"==": 3,
	"!=": 3,
}

func (p *Parser) parseBinary(minPrec int) (Expr, error) {
	left, err := p.parsePrimary()
	if err != nil {
		return nil, err
	}

	for {
		op := p.peek()
		if prec, ok := precedence[op]; ok && prec >= minPrec {
			p.next()
			right, err := p.parseBinary(prec + 1)
			if err != nil {
				return nil, err
			}
			fmt.Println("OP", op)
			left = &BinaryExpr{Op: op, Left: left, Right: right}
		} else {
			break
		}
	}

	return left, nil
}

func (p *Parser) parsePrimary() (Expr, error) {
	tok := p.next()

	if num, err := strconv.ParseFloat(tok, 64); err == nil {
		return &Number{Value: num}, nil
	}

	if p.peek() == "(" {
		p.next()
		var args []Expr
		for {
			if p.peek() == ")" {
				p.next()
				break
			}
			arg, err := p.parseExpr()
			if err != nil {
				return nil, err
			}
			args = append(args, arg)
			if p.peek() == "," {
				p.next()
			}
		}
		return &FuncCall{Name: tok, Args: args}, nil
	}

	if p.peek() == ":" {
		start := tok
		p.next()
		end := p.next()
		return &Range{Start: start, End: end}, nil
	}

	c := &Cell{
		Ref: tok,
	}

	return c, nil
}

func collectDeps(expr Expr) []string {
	var deps []string
	seen := make(map[string]bool)
	var visit func(Expr)

	visit = func(e Expr) {
		switch v := e.(type) {
		case *Cell:
			if !seen[v.Ref] {
				deps = append(deps, v.Ref)
				seen[v.Ref] = true
			}
		case *BinaryExpr:
			visit(v.Left)
			visit(v.Right)
		case *FuncCall:
			for _, arg := range v.Args {
				visit(arg)
			}
		case *Range:
			c1x, c1y, err1 := cellToCoord(v.Start)
			c2x, c2y, err2 := cellToCoord(v.End)
			if err1 != nil || err2 != nil {
				return
			}
			for x := min(c1x, c2x); x <= max(c1x, c2x); x++ {
				for y := min(c1y, c2y); y <= max(c1y, c2y); y++ {
					cell := coordToCell(x, y)
					if !seen[cell] {
						deps = append(deps, cell)
						seen[cell] = true
					}
				}
			}
		}
	}

	visit(expr)

	return deps
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func cellToCoord(cell string) (col int, row int, err error) {
	re := regexp.MustCompile(`^([A-Za-z]+)([0-9]+)$`)

	matches := re.FindStringSubmatch(cell)
	if len(matches) != 3 {
		return 0, 0, fmt.Errorf("invalid cell ref: %s", cell)
	}

	colStr, rowStr := matches[1], matches[2]

	col = 0
	for i := range len(colStr) {
		col = col*26 + int(colStr[i]-'A'+1)
	}

	row, _ = strconv.Atoi(rowStr)

	return col - 1, row - 1, nil
}

func coordToCell(col int, row int) string {
	label := ""

	col += 1
	for col > 0 {
		col -= 1
		label = string(rune('A'+(col%26))) + label
		col /= 26
	}

	return fmt.Sprintf("%s%d", label, row+1)
}
