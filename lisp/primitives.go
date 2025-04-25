package lisp

import (
	"fmt"
	"math"
	"reflect"
)

func apply(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	lhs := args[0]
	rhs := args[1]

	fn := lhs
	fnArgs := rhs.Children

	scope := wrapFrame(frame)

	if fn.Type == NODE_FUNC {
		params := fn.Children[0].Children
		body := fn.Children[1]

		if len(params) != len(fnArgs) {
			return nil, fmt.Errorf("expected %d arguments, got %d", len(params), len(fnArgs))
		}

		for i, param := range params {
			paramName, _ := param.Str()
			scope.define(paramName, args[i])
		}

		return Eval(body, scope)
	}

	node := &ASTNode{
		Type: NODE_LIST,
	}
	node.Children = append(node.Children, lhs)
	node.Children = append(node.Children, rhs.Children...)

	return Eval(node, frame)
}

func cond(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	for _, c := range args {
		test := c.Children[0]
		expr := c.Children[1]

		res, err := Eval(test, frame)
		if err != nil {
			return res, err
		}

		v, ok := res.Bool()

		if ok && v == SYM_TRUE_VAL {
			res, err := Eval(expr, frame)
			return res, err
		}
	}

	return NewASTSym(SYM_NIL), nil
}

func def(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	var err error

	lhs := args[0]
	if lhs.Type != NODE_SYM {
		return NewASTError(), TypeError
	}

	rhs := args[1]

	rhs, err = Eval(rhs, frame)
	if err != nil {
		return rhs, err
	}

	name, _ := lhs.Str()
	frame.define(name, rhs)

	return NewASTStr("ok"), nil
}

func lambda(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	params := args[0]
	body := args[1]

	return &ASTNode{
		Type: NODE_FUNC,
		Children: []*ASTNode{
			params, body,
		},
	}, nil
}

func mapf(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	f, err := Eval(args[0], frame)
	if err != nil {
		return f, err
	}

	list, err := Eval(args[1], frame)
	if err != nil {
		return list, err
	}

	acc := []*ASTNode{}

	for _, c := range list.Children {
		res, err := Eval(NewASTList(f, c), frame)
		if err != nil {
			return res, err
		}

		acc = append(acc, res)
	}

	return NewASTList(acc...), nil
}

func repeated(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	return nil, nil
}

func add(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	floatComponent := 0.0
	intComponent := 0
	used := false

	var err error

	for _, c := range args {
		c, err = Eval(c, frame)
		if err != nil {
			return c, err
		}

		if c.Type == NODE_INT {
			v, _ := c.Int()
			intComponent += v
		} else if c.Type == NODE_FLOAT {
			v, _ := c.Float()
			floatComponent += v
			used = true
		} else {
			return NewASTError(c), TypeError
		}
	}

	if used {
		return NewASTFloat(float64(intComponent) + floatComponent), nil
	}

	return NewASTInt(intComponent), nil
}

func sub(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	a := 0.0
	b := 0.0
	a1 := 0
	b1 := 0
	used := false

	lhs := args[0]
	rhs := args[1]

	var err error

	lhs, err = Eval(lhs, frame)
	if err != nil {
		return lhs, err
	}

	rhs, err = Eval(rhs, frame)
	if err != nil {
		return rhs, err
	}

	if lhs.Type == NODE_FLOAT {
		a, _ = lhs.Float()
		used = true
	} else if lhs.Type == NODE_INT {
		v, _ := lhs.Int()
		a1 = v
		a = float64(v)
	}

	if rhs.Type == NODE_FLOAT {
		b, _ = rhs.Float()
		used = true
	} else if rhs.Type == NODE_INT {
		v, _ := rhs.Int()
		b1 = v
		b = float64(v)
	}

	if used {
		return NewASTFloat(a - b), nil
	}

	return NewASTInt(a1 - b1), nil
}

func mul(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	a := 0.0
	b := 0.0
	a1 := 0
	b1 := 0
	used := false

	lhs := args[0]
	rhs := args[1]

	var err error

	lhs, err = Eval(lhs, frame)
	if err != nil {
		return lhs, err
	}

	rhs, err = Eval(rhs, frame)
	if err != nil {
		return rhs, err
	}

	if lhs.Type == NODE_FLOAT {
		a, _ = lhs.Float()
		used = true
	} else if lhs.Type == NODE_INT {
		v, _ := lhs.Int()
		a1 = v
		a = float64(v)
	}

	if rhs.Type == NODE_FLOAT {
		b, _ = rhs.Float()
		used = true
	} else if rhs.Type == NODE_INT {
		v, _ := rhs.Int()
		b1 = v
		b = float64(v)
	}

	if used {
		return NewASTFloat(a * b), nil
	}

	return NewASTInt(a1 * b1), nil
}

func div(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	a := 0.0
	b := 0.0
	a1 := 0
	b1 := 0
	used := false

	var err error

	lhs := args[0]
	rhs := args[1]

	lhs, err = Eval(lhs, frame)
	if err != nil {
		return lhs, err
	}

	rhs, err = Eval(rhs, frame)
	if err != nil {
		return rhs, err
	}

	if lhs.Type == NODE_FLOAT {
		a, _ = lhs.Float()
		used = true
	} else if lhs.Type == NODE_INT {
		v, _ := lhs.Int()
		a1 = v
		a = float64(v)
	}

	if rhs.Type == NODE_FLOAT {
		b, _ = rhs.Float()
		used = true
	} else if rhs.Type == NODE_INT {
		v, _ := rhs.Int()
		b1 = v
		b = float64(v)
	}

	if used {
		return NewASTFloat(a / b), nil
	}

	return NewASTInt(a1 / b1), nil
}

func mod(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	a := 0.0
	b := 0.0
	a1 := 0
	b1 := 0
	used := false

	var err error

	lhs := args[0]
	rhs := args[1]

	lhs, err = Eval(lhs, frame)
	if err != nil {
		return lhs, err
	}

	rhs, err = Eval(rhs, frame)
	if err != nil {
		return rhs, err
	}

	if lhs.Type == NODE_FLOAT {
		a, _ = lhs.Float()
		used = true
	} else if lhs.Type == NODE_INT {
		v, _ := lhs.Int()
		a1 = v
		a = float64(v)
	}

	if rhs.Type == NODE_FLOAT {
		b, _ = rhs.Float()
		used = true
	} else if rhs.Type == NODE_INT {
		v, _ := rhs.Int()
		b1 = v
		b = float64(v)
	}

	if used {
		return NewASTFloat(math.Mod(a, b)), nil
	}

	return NewASTInt(a1 % b1), nil
}

// func round(args []*ASTNode, frame *Frame) (*ASTNode, error) {
// }
//
// func floor(args []*ASTNode, frame *Frame) (*ASTNode, error) {
// }
//
// func ceil(args []*ASTNode, frame *Frame) (*ASTNode, error) {
// }

func float(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	var err error

	a := args[0]

	a, err = Eval(a, frame)
	if err != nil {
		return a, err
	}

	if a.Type == NODE_FLOAT {
		return a, nil
	}

	a0, ok := a.Int()
	if !ok {
		return NewASTError(a), TypeError
	}

	return NewASTFloat(float64(a0)), nil
}

func ceil(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	val, err := Eval(args[0], frame)
	if err != nil {
		return val, err
	}

	valFloat, ok := val.Float()
	if !ok {
		return NewASTError(), TypeError
	}

	return NewASTInt(int(math.Ceil(valFloat))), nil
}

func floor(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	val, err := Eval(args[0], frame)
	if err != nil {
		return val, err
	}

	valFloat, ok := val.Float()
	if !ok {
		return NewASTError(), TypeError
	}

	return NewASTInt(int(math.Floor(valFloat))), nil
}

func round(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	val, err := Eval(args[0], frame)
	if err != nil {
		return val, err
	}

	valFloat, ok := val.Float()
	if !ok {
		return NewASTError(), TypeError
	}

	return NewASTInt(int(math.Round(valFloat))), nil
}

func cos(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	val, err := Eval(args[0], frame)
	if err != nil {
		return val, err
	}

	valFloat, ok := val.Float()
	if !ok {
		return NewASTError(), TypeError
	}

	return NewASTFloat(math.Cos(valFloat)), nil
}

func sin(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	val, err := Eval(args[0], frame)
	if err != nil {
		return val, err
	}

	valFloat, ok := val.Float()
	if !ok {
		return NewASTError(), TypeError
	}

	return NewASTFloat(math.Sin(valFloat)), nil
}

func sqrt(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	val, err := Eval(args[0], frame)
	if err != nil {
		return val, err
	}

	valFloat, ok := val.Float()
	if !ok {
		return NewASTError(), TypeError
	}

	return NewASTFloat(math.Sqrt(valFloat)), nil
}

func pow(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	lhs, err := Eval(args[0], frame)
	if err != nil {
		return lhs, err
	}

	lhsFloat, ok := lhs.Float()
	if !ok {
		return NewASTError(), TypeError
	}

	rhs, err := Eval(args[0], frame)
	if err != nil {
		return lhs, err
	}

	rhsFloat, ok := rhs.Float()
	if !ok {
		return NewASTError(), TypeError
	}

	return NewASTFloat(math.Pow(lhsFloat, rhsFloat)), nil
}

func cons(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	var err error

	a := args[0]
	b := args[1]

	if len(args) > 3 {
		return NewASTError(args...), ErrNumberArgs(2, len(args)-1)
	}

	a, err = Eval(a, frame)
	if err != nil {
		return a, err
	}

	b, err = Eval(b, frame)
	if err != nil {
		return a, err
	}

	return NewASTList(a, b), nil
}

func car(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	var err error

	a := args[0]

	a, err = Eval(a, frame)
	if err != nil {
		return a, err
	}

	if len(a.Children) == 0 {
		return NewASTBool(SYM_NIL_VAL), nil
	}

	return NewASTList(a.Children[:len(a.Children)-1]...), nil
}

func cdr(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	var err error

	a := args[0]

	a, err = Eval(a, frame)
	if err != nil {
		return a, err
	}

	if len(a.Children) == 0 {
		return NewASTSym("#NIL"), nil
	}

	return a.Children[len(a.Children)-1], nil
}

func push(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	var err error

	a := args[0]
	b := args[1]

	a, err = Eval(a, frame)
	if err != nil {
		return a, err
	}

	if a.Type != NODE_LIST {
		return NewASTError(a), TypeError
	}

	b, err = Eval(b, frame)
	if err != nil {
		return b, err
	}

	a.Children = append(a.Children, b)

	return a, nil
}

func pop(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	var err error

	a := args[0]

	a, err = Eval(a, frame)
	if err != nil {
		return a, err
	}

	if a.Type != NODE_LIST {
		return NewASTError(a), TypeError
	}

	last := a.Children[len(a.Children)-1]
	a.Children = a.Children[len(a.Children)-1:]

	return last, nil
}

func nth(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	next, err := Eval(args[0], frame)
	if err != nil {
		return next, err
	}

	idx, err := Eval(args[1], frame)
	if err != nil {
		return idx, err
	}

	if next.Type == NODE_LIST && idx.Type == NODE_INT {
		i, _ := idx.Int()
		return next.Children[i], nil
	}

	return NewASTError(args...), TypeError
}

func set(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	list, err := Eval(args[0], frame)
	if err != nil {
		return list, err
	}

	idx, err := Eval(args[1], frame)
	if err != nil {
		return idx, err
	}

	idxVal, ok := idx.Int()
	if !ok {
		return NewASTError(idx), TypeError
	}

	val, err := Eval(args[2], frame)
	if err != nil {
		return val, err
	}

	list = list.Clone()

	list.Children[idxVal] = val.Clone()

	return list, nil
}

func eq(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	var err error

	a := args[0]
	b := args[1]

	a, err = Eval(a, frame)
	if err != nil {
		return a, err
	}

	b, err = Eval(b, frame)
	if err != nil {
		return b, err
	}

	check := compareASTNodes(a, b)
	return MapBoolToAST(check), nil
}

func lt(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	a := args[0]
	b := args[1]

	var err error

	a, err = Eval(a, frame)
	if err != nil {
		return a, err
	}

	b, err = Eval(b, frame)
	if err != nil {
		return b, err
	}

	if a.Type == NODE_INT && a.Type == b.Type {
		a, _ := a.Int()
		b, _ := b.Int()
		return MapBoolToAST(a < b), nil
	}

	if a.Type == NODE_FLOAT && a.Type == b.Type {
		a, _ := a.Float()
		b, _ := b.Float()
		return MapBoolToAST(a < b), nil
	}

	if a.Type == NODE_STR && a.Type == b.Type {
		a, _ := a.Str()
		b, _ := b.Str()
		return MapBoolToAST(a < b), nil
	}

	if a.Type == NODE_BOOL && a.Type == b.Type {
		a, _ := a.Str()
		b, _ := b.Str()
		return MapBoolToAST(a < b), nil
	}

	return NewASTError(a, b), TypeError
}

func gt(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	a := args[0]
	b := args[1]

	var err error

	a, err = Eval(a, frame)
	if err != nil {
		return a, err
	}

	b, err = Eval(b, frame)
	if err != nil {
		return b, err
	}

	if a.Type == NODE_INT && a.Type == b.Type {
		a, _ := a.Int()
		b, _ := b.Int()
		return MapBoolToAST(a > b), nil
	}

	if a.Type == NODE_FLOAT && a.Type == b.Type {
		a, _ := a.Float()
		b, _ := b.Float()
		return MapBoolToAST(a > b), nil
	}

	if a.Type == NODE_STR && a.Type == b.Type {
		a, _ := a.Str()
		b, _ := b.Str()
		return MapBoolToAST(a > b), nil
	}

	if a.Type == NODE_BOOL && a.Type == b.Type {
		a, _ := a.Bool()
		b, _ := b.Bool()
		return MapBoolToAST(a < b), nil
	}

	return NewASTError(a, b), TypeError
}

func compare(f func(a, b bool) bool) func(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	return func(args []*ASTNode, frame *Frame) (*ASTNode, error) {
		a, err := Eval(args[0], frame)
		if err != nil {
			return a, err
		}

		b, err := Eval(args[1], frame)
		if err != nil {
			return b, err
		}

		a0, ok := a.Bool()
		if !ok {
			return NewASTError(a), TypeError
		}

		b0, ok := b.Bool()
		if !ok {
			return NewASTError(b), TypeError
		}

		return MapBoolToAST(f(a0 == SYM_TRUE_VAL, b0 == SYM_TRUE_VAL)), nil
	}
}

func not(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	a, err := Eval(args[0], frame)
	if err != nil {
		return a, err
	}

	a0, ok := a.Bool()
	if !ok {
		return NewASTError(a), TypeError
	}

	return MapBoolToAST(!(a0 == SYM_TRUE_VAL)), nil
}

func even(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	next, err := Eval(args[0], frame)
	if err != nil {
		return next, err
	}

	if next.Type == NODE_LIST {
		val, err := Eval(next, frame)
		if err != nil {
			return val, err
		}
		next = val
	}

	if next.Type == NODE_FLOAT {
		v, _ := next.Float()
		rem := math.Mod(v, 2)
		return MapBoolToAST(rem == 0), nil
	}

	if next.Type == NODE_INT {
		v, _ := next.Int()
		return MapBoolToAST(v%2 == 0), nil
	}

	return NewASTError(next), TypeError
}

func odd(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	next, err := Eval(args[0], frame)
	if err != nil {
		return next, err
	}

	if next.Type == NODE_FLOAT {
		v, _ := next.Float()
		rem := math.Mod(v, 2)
		return MapBoolToAST(rem > 0), nil
	}

	if next.Type == NODE_INT {
		v, _ := next.Int()
		return MapBoolToAST(v%2 > 0), nil
	}

	return NewASTError(next), TypeError
}

func checkType(t int8) func(ast []*ASTNode, frame *Frame) (*ASTNode, error) {
	return func(ast []*ASTNode, frame *Frame) (*ASTNode, error) {
		next, err := Eval(ast[0], frame)
		if err != nil {
			return next, err
		}

		next, err = Eval(next, frame)
		if err != nil {
			return next, err
		}

		check := next.Type == t
		return MapBoolToAST(check), nil
	}
}

func empty(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	next, err := Eval(args[0], frame)
	if err != nil {
		return next, err
	}

	if next.Type == NODE_LIST {
		return MapBoolToAST(len(next.Children) == 0), nil
	}

	if next.Type == NODE_STR {
		s, _ := next.Str()
		return MapBoolToAST(len(s) == 0), nil
	}

	return NewASTError(args...), TypeError
}

func length(args []*ASTNode, frame *Frame) (*ASTNode, error) {
	next, err := Eval(args[0], frame)
	if err != nil {
		return next, err
	}

	if next.Type == NODE_LIST {
		val, err := Eval(next, frame)
		if err != nil {
			return val, err
		}
		next = val
	}

	if next.Type == NODE_LIST {
		return NewASTInt(len(next.Children)), nil
	}

	if next.Type == NODE_STR {
		s, _ := next.Str()
		return NewASTInt(len(s)), nil
	}

	return NewASTError(args...), TypeError
}

func compareASTNodes(a, b *ASTNode) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}

	if a.Type != b.Type {
		return false
	}

	if !reflect.DeepEqual(a.Value, b.Value) {
		return false
	}

	if a.Type == NODE_LIST {
		if len(a.Children) != len(b.Children) {
			return false
		}

		for i := 0; i < len(a.Children); i++ {
			if !compareASTNodes(a.Children[i], b.Children[i]) {
				return false
			}
		}
	}

	return true
}
