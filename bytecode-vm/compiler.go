package main

type Instruction struct {
	Op OpCode
	A  int
}

type Program struct {
	Instrs []Instruction
	Consts []any
	Fields []string
	Types  []byte
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
		prog: Program{},
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

func (c *Compiler) Field(name string, typ byte) int {
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

func (c *Compiler) Substr(prefixLen int) *Compiler {
	c.emit(OP_STR_SUBSTR, prefixLen)
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
	c.emit(OP_CREATE_TABLE, 0)
	return c
}

func (c *Compiler) Program() Program {
	return c.prog
}
