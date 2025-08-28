package main

type OpCode byte

const (
	OP_NOP OpCode = iota
	OP_PUSH_CONST
	OP_PUSH_INDEXED
	OP_LOAD_FIELD
	OP_ADD
	OP_SUB
	OP_MUL
	OP_DIV
	OP_MOD
	OP_EQ
	OP_NEQ
	OP_LT
	OP_LTE
	OP_GT
	OP_GTE
	OP_AND
	OP_OR
	OP_NOT
	OP_JMP_IF_FALSE
	OP_JMP
	OP_RETURN
	OP_HALT
	OP_SUBSTR_EQ
	OP_NEW_DATASTORE
	OP_LOAD_SCHEMA
	OP_LOAD_ROW
	OP_NEW_INDEX
)

const (
	TYPE_STRING = iota
	TYPE_INT
	TYPE_FLOAT
	TYPE_BOOL
	TYPE_JSON
	TYPE_BYTES
)

type Instruction struct {
	Op OpCode
	A  int
}

type Program struct {
	Instrs []Instruction
	Consts []any
	Fields []string
	Types  []int
}

type Compiler struct {
	prog Program
}

func NewCompiler(existingProg *Program) *Compiler {
	if existingProg != nil {
		return &Compiler{
			prog: *existingProg,
		}
	}

	return &Compiler{
		prog: Program{
			Instrs: []Instruction{},
			Consts: []any{},
			Fields: []string{},
			Types:  []int{},
		},
	}
}

func (c *Compiler) emit(op OpCode, a int) int {
	pc := len(c.prog.Instrs)
	c.prog.Instrs = append(c.prog.Instrs,
		Instruction{
			Op: op,
			A:  a,
		})
	return pc
}

func (c *Compiler) addConst(v any) int {
	c.prog.Consts = append(c.prog.Consts, v)
	return len(c.prog.Consts) - 1
}

func (c *Compiler) Field(name string, typ int) int {
	for i, f := range c.prog.Fields {
		if f == name {
			return i
		}
	}

	c.prog.Fields = append(c.prog.Fields, name)
	c.prog.Types = append(c.prog.Types, typ)

	return len(c.prog.Fields) - 1
}

func (c *Compiler) PushConst(v any) *Compiler {
	c.emit(OP_PUSH_CONST, c.addConst(v))
	return c
}

func (c *Compiler) PushIndexed(idx int) *Compiler {
	c.emit(OP_PUSH_INDEXED, idx)
	return c
}

func (c *Compiler) LoadField() *Compiler {
	c.emit(OP_LOAD_FIELD, 0)
	return c
}

func (c *Compiler) SubstrEq(prefixLen int) *Compiler {
	c.emit(OP_SUBSTR_EQ, prefixLen)
	return c
}

func (c *Compiler) Eq() *Compiler {
	c.emit(OP_EQ, 0)
	return c
}

func (c *Compiler) Neq() *Compiler {
	c.emit(OP_NEQ, 0)
	return c
}

func (c *Compiler) Lt() *Compiler {
	c.emit(OP_LT, 0)
	return c
}

func (c *Compiler) Gt() *Compiler {
	c.emit(OP_GT, 0)
	return c
}

func (c *Compiler) And() *Compiler {
	c.emit(OP_AND, 0)
	return c
}

func (c *Compiler) Or() *Compiler {
	c.emit(OP_OR, 0)
	return c
}

func (c *Compiler) Not() *Compiler {
	c.emit(OP_NOT, 0)
	return c
}

func (c *Compiler) Halt() *Compiler {
	c.emit(OP_HALT, 0)
	return c
}

func (c *Compiler) NewDataStore() *Compiler {
	c.emit(OP_NEW_DATASTORE, 0)
	return c
}

func (c *Compiler) Program() Program {
	return c.prog
}
