package main

import (
	"fmt"
	"strconv"
)

type VM struct {
	prog   Program
	stack  []any
	pc     int
	stores map[string]*DataStore
}

type DataStore struct {
	name    string
	data    [][]any
	fields  []string
	types   []int
	indexes map[string][]int
}

func NewVM(p Program) *VM {
	return &VM{
		prog:   p,
		stack:  make([]any, 0, 64),
		pc:     0,
		stores: map[string]*DataStore{},
	}
}

func (vm *VM) LoadProgram(p Program) {
	vm.prog = p
	vm.pc = 0
	vm.stack = make([]any, 0, 64)
}

func (vm *VM) push(v any) {
	vm.stack = append(vm.stack, v)
}

func (vm *VM) pop() any {
	v := vm.stack[len(vm.stack)-1]
	vm.stack = vm.stack[:len(vm.stack)-1]
	return v
}

func parseByType(s string, typ int) any {
	switch typ {
	case TYPE_INT:
		val, _ := strconv.ParseInt(s, 10, 64)
		return val
	case TYPE_FLOAT:
		val, _ := strconv.ParseFloat(s, 64)
		return val
	case TYPE_STRING:
		return s
	case TYPE_BOOL:
		return s == "true"
	default:
		return s
	}
}

func (vm *VM) execute(row []string) (bool, error) {
	vm.pc = 0
	vm.stack = vm.stack[:0]
	p := vm.prog

	typedRow := make([]any, len(row))
	for i, s := range row {
		typedRow[i] = parseByType(s, p.Types[i])
	}

	for vm.pc < len(p.Instrs) {
		ins := p.Instrs[vm.pc]
		fmt.Println("instr", vm.pc, ins.Op)

		switch ins.Op {
		case OP_NOP:
			vm.pc++
		case OP_PUSH_CONST:
			vm.push(p.Consts[ins.A])
			vm.pc++
		case OP_LOAD_FIELD:
			a := vm.pop()
			for i, v := range vm.prog.Fields {
				if v == a {
					vm.push(typedRow[i])
					break
				}
			}
			vm.pc++
		case OP_PUSH_INDEXED:
			vm.push(typedRow[ins.A])
			vm.pc++
		case OP_EQ, OP_NEQ, OP_LT, OP_GT:
			b := vm.pop()
			a := vm.pop()
			vm.push(compare(a, b, ins.Op))
			vm.pc++
		case OP_LTE:
		case OP_GTE:
		case OP_AND:
			b := vm.pop().(bool)
			a := vm.pop().(bool)
			vm.push(a && b)
			vm.pc++
		case OP_OR:
			b := vm.pop().(bool)
			a := vm.pop().(bool)
			vm.push(a || b)
			vm.pc++
		case OP_NOT:
			a := vm.pop().(bool)
			vm.push(!a)
			vm.pc++
		case OP_SUBSTR_EQ:
			prefixLen := ins.A
			prefix := vm.pop().(string)
			val := vm.pop().(string)
			if len(val) < prefixLen || len(prefix) < prefixLen {
				vm.push(false)
			} else {
				vm.push(val[:prefixLen] == prefix[:prefixLen])
			}
			vm.pc++
		case OP_NEW_DATASTORE:
			name := vm.pop().(string)
			if name == "" {
				vm.pc++
				continue
			}
			vm.stores[name] = &DataStore{
				name: name,
			}
			vm.pc++
		case OP_RETURN:
			return ins.A != 0, nil
		case OP_HALT:
			if len(vm.stack) > 0 {
				if b, ok := vm.pop().(bool); ok {
					return b, nil
				}
			}
			return false, nil
		default:
			return false, fmt.Errorf("unknown opcode %v", ins.Op)
		}
	}
	if len(vm.stack) > 0 {
		if b, ok := vm.pop().(bool); ok {
			return b, nil
		}
	}
	return false, nil
}

func compare(a, b any, op OpCode) bool {
	ab, aok := a.(bool)
	bb, bok := b.(bool)

	if aok && bok {
		switch op {
		case OP_EQ:
			return ab == bb
		case OP_NEQ:
			return ab != bb
		case OP_LT:
			return !ab && bb
		case OP_GT:
			return ab && !bb
		default:
			panic("unsupported")
		}
	}

	af, aok := toFloat64(a)
	bf, bok := toFloat64(b)
	if aok && bok {
		switch op {
		case OP_EQ:
			return af == bf
		case OP_NEQ:
			return af != bf
		case OP_LT:
			return af < bf
		case OP_GT:
			return af > bf
		}
	}

	aStr := fmt.Sprintf("%v", a)
	bStr := fmt.Sprintf("%v", b)
	switch op {
	case OP_EQ:
		return aStr == bStr
	case OP_NEQ:
		return aStr != bStr
	case OP_LT:
		return aStr < bStr
	case OP_GT:
		return aStr > bStr
	}
	return false
}

func toFloat64(v any) (float64, bool) {
	switch t := v.(type) {
	case int:
		return float64(t), true
	case float32:
		return float64(t), true
	case float64:
		return t, true
	default:
		return 0, false
	}
}
