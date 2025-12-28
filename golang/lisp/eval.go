package lisp

import (
	"fmt"
	"math/rand"
	"os"
	"strings"
)

func Eval(ast *ASTNode, frame *Frame) (*ASTNode, error) {
	if ast == nil {
		return nil, nil
	}

	switch ast.Type {
	case NODE_SYM:
		s, ok := ast.Str()
		if !ok {
			return NewASTError(ast), TypeError
		}

		f, ok := frame.primitives[s]
		if ok {
			return NewASTPrimitive(s, f), nil
		}

		sym, ok := frame.get(s)
		if ok {
			return sym.Clone(), nil
		}

		return NewASTError(), TypeError
	case NODE_LIST:
		if len(ast.Children) == 0 {
			return ast, nil
		}

		first := ast.Children[0]

		if first.Type == NODE_SYM {
			sym, err := Eval(first, frame)
			if err != nil {
				return sym, err
			}

			if sym.Type == NODE_FUNC {
				lhs := sym
				rhs := ast.Children[1:]

				scope := wrapFrame(frame)
				body := lhs.Children[1]
				params := lhs.Children[0]

				if len(params.Children) != len(rhs) {
					return nil, ErrNumberArgs(len(params.Children), len(rhs))
				}

				for i, param := range params.Children {
					paramName, _ := param.Str()

					rhs, err := Eval(rhs[i], frame)
					if err != nil {
						return rhs, err
					}

					scope.define(paramName, rhs.Clone())
				}

				res, err := Eval(body, scope)
				return res, err
			} else if sym.Type == NODE_PRIM {
				return sym.Func()(ast.Children[1:], frame)
			}

			return sym, nil
		} else {
			for i, n := range ast.Children {
				res, err := Eval(n, frame)
				if err != nil {
					return res, err
				}

				ast.Children[i] = res
			}
		}

		return ast, nil
	default:
		return ast.Clone(), nil
	}
}

func primitives() map[string]Primitive {
	return map[string]Primitive{
		"quit": func(args []*ASTNode, frame *Frame) (*ASTNode, error) {
			return nil, nil
		},
		"quote": func(args []*ASTNode, frame *Frame) (*ASTNode, error) {
			return args[0], nil
		},
		"apply":  apply,
		"cond":   cond,
		"def":    def,
		"lambda": lambda,
		"map":    mapf,

		"+": add,
		"-": sub,
		"*": mul,
		"/": div,
		"%": mod,

		"float": float,
		"ceil":  ceil,
		"floor": floor,
		"round": round,

		"cos":  cos,
		"sin":  sin,
		"sqrt": sqrt,
		"pow":  pow,
		"rand": func(args []*ASTNode, frame *Frame) (*ASTNode, error) {
			return NewASTFloat(rand.Float64()), nil
		},

		"cons": cons,
		"car":  car,
		"cdr":  cdr,

		"push": push,
		"pop":  pop,
		"nth":  nth,
		"set":  set,

		"eq?": eq,
		"lt?": lt,
		"gt?": gt,
		"and": compare(func(a, b bool) bool {
			return a && b
		}),
		"or": compare(func(a, b bool) bool {
			return a || b
		}),
		"not": not,

		"even?": even,
		"odd?":  odd,

		"bool?":   checkType(NODE_BOOL),
		"int?":    checkType(NODE_INT),
		"float?":  checkType(NODE_FLOAT),
		"str?":    checkType(NODE_STR),
		"sym?":    checkType(NODE_SYM),
		"list?":   checkType(NODE_LIST),
		"empty?":  empty,
		"length?": length,

		"load": func(args []*ASTNode, frame *Frame) (*ASTNode, error) {
			if args[0].Type != NODE_STR {
				return NewASTError(), TypeError
			}

			filename, _ := args[0].Str()

			data, err := os.ReadFile("./" + filename)
			if err != nil {
				return NewASTError(), err
			}

			fmt.Println(string(data))

			for _, line := range strings.Split(string(data), "\n") {
				if string(line) == "" {
					continue
				}

				if line[0] == ';' {
					continue
				}

				ast, _, err := Parse(Tokenize(string(line)))
				if err != nil {
					fmt.Println("error:", err.Error())

					if strings.TrimSpace(string(line)) == "" {
						continue
					}

					continue
				}

				result, err := Eval(ast, frame)
				if err != nil {
					return NewASTError(), err
				}

				if result == nil {
					break
				}
			}

			return NewASTStr("ok"), nil
		},
		"dump": func(args []*ASTNode, frame *Frame) (*ASTNode, error) {
			nodes := []*ASTNode{}

			for _, v := range frame.data {
				nodes = append(nodes, NewASTList(NewASTSym(v.name), v.value))
			}

			return NewASTList(nodes...), nil
		},
		"eval": func(args []*ASTNode, frame *Frame) (*ASTNode, error) {
			r, err := Eval(args[0], frame)
			if err != nil {
				return r, err
			}

			return Eval(r, frame)
		},
	}
}
