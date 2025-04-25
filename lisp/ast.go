package lisp

import (
	"errors"
	"fmt"
)

const (
	NODE_INT   int8 = 1
	NODE_FLOAT int8 = 2
	NODE_STR   int8 = 3
	NODE_LIST  int8 = 4
	NODE_SYM   int8 = 5
	NODE_ERR   int8 = 6
	NODE_BOOL  int8 = 7
	NODE_FUNC  int8 = 8
	NODE_PRIM  int8 = 9

	SYM_TRUE  = "#t"
	SYM_FALSE = "#f"
	SYM_NIL   = "#nil"

	SYM_TRUE_VAL  int8 = 1
	SYM_FALSE_VAL int8 = 0
	SYM_NIL_VAL   int8 = -1
)

var (
	SYM_TABLE = map[int8]string{
		NODE_INT:   "int",
		NODE_FLOAT: "float",
		NODE_STR:   "str",
		NODE_LIST:  "list",
		NODE_SYM:   "sym",
		NODE_ERR:   "err",
		NODE_BOOL:  "bool",
		NODE_FUNC:  "func",
		NODE_PRIM:  "primitive",
	}
	BOOL_TABLE = map[int8]string{
		SYM_TRUE_VAL:  SYM_TRUE,
		SYM_FALSE_VAL: SYM_FALSE,
		SYM_NIL_VAL:   SYM_NIL,
	}
)

type ASTNode struct {
	Value    any
	Type     int8
	Children []*ASTNode
}

func (n *ASTNode) Clone() *ASTNode {
	if n == nil {
		return nil
	}

	clone := &ASTNode{
		Value:    n.Value,
		Type:     n.Type,
		Children: make([]*ASTNode, len(n.Children)),
	}

	for i, child := range n.Children {
		clone.Children[i] = child.Clone()
	}

	return clone
}

func (n *ASTNode) Str() (v string, ok bool) {
	v, ok = n.Value.(string)
	return
}

func (n *ASTNode) Float() (v float64, ok bool) {
	v, ok = n.Value.(float64)
	return
}

func (n *ASTNode) Int() (v int, ok bool) {
	v, ok = n.Value.(int)
	return
}

func (n *ASTNode) Sym() (v string, ok bool) {
	v, ok = n.Value.(string)
	return
}

func (n *ASTNode) Bool() (v int8, ok bool) {
	v, ok = n.Value.(int8)
	return
}

func (n *ASTNode) List() []*ASTNode {
	return n.Children
}

type Primitive = func(args []*ASTNode, frame *Frame) (*ASTNode, error)

func (n *ASTNode) Func() Primitive {
	return n.Value.(Primitive)
}

func NewASTPrimitive(name string, f Primitive) *ASTNode {
	return &ASTNode{
		Type:     NODE_PRIM,
		Value:    f,
		Children: []*ASTNode{NewASTStr(name)},
	}
}

func NewASTBool(v int8) *ASTNode {
	return &ASTNode{
		Type:  NODE_BOOL,
		Value: v,
	}
}

func NewASTInt(v int) *ASTNode {
	return &ASTNode{
		Type:  NODE_INT,
		Value: v,
	}
}

func NewASTFloat(v float64) *ASTNode {
	return &ASTNode{
		Type:  NODE_FLOAT,
		Value: v,
	}
}

func MapBoolToAST(val bool) *ASTNode {
	var s int8

	if val {
		s = SYM_TRUE_VAL
	} else {
		s = SYM_FALSE_VAL
	}

	return &ASTNode{
		Type:  NODE_BOOL,
		Value: s,
	}
}

func NewASTStr(s string) *ASTNode {
	return &ASTNode{
		Type:  NODE_STR,
		Value: s,
	}
}

func NewASTError(sym ...*ASTNode) *ASTNode {
	return &ASTNode{
		Type:     NODE_LIST,
		Children: sym,
	}
}

func NewASTList(nodes ...*ASTNode) *ASTNode {
	return &ASTNode{
		Type:     NODE_LIST,
		Children: nodes,
	}
}

func NewASTSym(val string) *ASTNode {
	return &ASTNode{
		Type:  NODE_SYM,
		Value: val,
	}
}

var (
	TypeError      = errors.New("invalid type")
	SymbolNotFound = errors.New("symbol not found")
)

func ErrNumberArgs(expected, got int) error {
	return fmt.Errorf("expected %d arguments, got %d", expected, got)
}

func HasFloat(nodes []*ASTNode) bool {
	for _, n := range nodes {
		if n.Type == NODE_FLOAT {
			return true
		}
	}
	return false
}

func IsAllInt(nodes []*ASTNode) bool {
	for _, n := range nodes {
		if n.Type != NODE_INT {
			return false
		}
	}
	return true
}
