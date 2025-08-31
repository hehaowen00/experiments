package main

import (
	"fmt"
)

func Accumulate(rows [][]string, prog Program) ([]any, error) {
	out := make([]any, 0)
	vm := NewVM(prog)

	for _, row := range rows {
		ok, err := vm.execute(row)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, row)
		}
	}

	return out, nil
}

func main() {
	c := NewCompiler(nil)
	c.Field("Name", TYPE_STRING)
	c.Field("Age", TYPE_INT)
	c.Field("Gender", TYPE_BOOL)
	c.Field("City", TYPE_STRING)
	prog := c.Program()

	data := [][]string{
		{"Alice", "30", "true", "Sydney"},
		{"Bob", "22", "false", "Melbourne"},
		{"Charlie", "35", "false", "Brisbane"},
	}

	vm := NewVM(Program{})
	vm.LoadProgram(prog)
	vm.execute(nil)

	fmt.Println(prog)
	for _, row := range data {
		fmt.Println(row)
	}

	copyProgram := prog

	cAge := NewCompiler(&copyProgram)
	cAge.PushIndexed(1).PushConst(int64(25)).Gt().Halt()

	resAge, _ := Accumulate(data, cAge.Program())
	fmt.Println("Filtered Age > 25:")
	for _, r := range resAge {
		fmt.Println(r)
	}

	cCity := NewCompiler(&prog)
	cCity.PushConst("Mel").PushIndexed(3).Substr(3).Eq().Halt()

	resCity, _ := Accumulate(data, cCity.Program())
	fmt.Println("Filtered City prefix 'Mel':", len(resCity))
	for _, r := range resCity {
		fmt.Println(r)
	}

	cGender := NewCompiler(&prog)
	cGender.PushConst("Gender").LoadField().PushConst(true).Eq().Halt()

	resGender, _ := Accumulate(data, cGender.Program())
	fmt.Println("Filtered Gender is Female", len(resGender))
	for _, r := range resGender {
		fmt.Println(r)
	}
}
