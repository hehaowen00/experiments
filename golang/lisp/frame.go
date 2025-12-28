package lisp

import (
	"fmt"
	"slices"
	"strings"
)

type Frame struct {
	primitives map[string]func(args []*ASTNode, frame *Frame) (*ASTNode, error)
	data       []*entry
	parent     *Frame
}

type entry struct {
	name  string
	value *ASTNode
}

func (f *Frame) Format(indentLevel int) string {
	var builder strings.Builder
	indent := strings.Repeat("  ", indentLevel)

	builder.WriteString(fmt.Sprintf("%sFrame {\n", indent))

	for _, e := range f.data {
		builder.WriteString(fmt.Sprintf("%s  %s: %v\n", indent, e.name, e.value))
	}

	if f.parent != nil {
		builder.WriteString(f.parent.Format(indentLevel + 1))
	}

	builder.WriteString(fmt.Sprintf("%s}\n", indent))
	return builder.String()
}

func NewFrame() *Frame {
	return &Frame{
		primitives: primitives(),
	}
}

func wrapFrame(parent *Frame) *Frame {
	return &Frame{
		primitives: parent.primitives,
		data:       nil,
		parent:     parent,
	}
}

func (f *Frame) define(name string, value *ASTNode) {
	e := &entry{
		name:  name,
		value: value,
	}

	if len(f.data) == 0 {
		f.data = append(f.data, e)
		return
	}

	i, ok := slices.BinarySearchFunc(f.data, e, func(lhs, rhs *entry) int {
		return strings.Compare(lhs.name, rhs.name)
	})
	if ok {
		f.data[i] = e
	} else {
		f.data = slices.Insert(f.data, i, e)
	}
}

func (f *Frame) set(name string, value *ASTNode) {
	e := &entry{
		name:  name,
		value: value,
	}

	i, ok := slices.BinarySearchFunc(f.data, e, func(lhs, rhs *entry) int {
		return strings.Compare(lhs.name, rhs.name)
	})

	if ok {
		f.data[i] = e
	} else if f.parent != nil {
		f.parent.set(name, value)
	}
}

func (f *Frame) get(name string) (*ASTNode, bool) {
	e := &entry{
		name: name,
	}

	i, ok := slices.BinarySearchFunc(f.data, e, func(lhs, rhs *entry) int {
		return strings.Compare(lhs.name, rhs.name)
	})

	if ok {
		return f.data[i].value, ok
	}

	if f.parent != nil {
		return f.parent.get(name)
	}

	return nil, false
}
