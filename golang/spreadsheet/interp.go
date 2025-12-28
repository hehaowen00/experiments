package main

import (
	"fmt"
	"math"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"
)

const (
	E  = "E"
	PI = "PI"

	ABS = "ABS"
	POW = "POW"
	LOG = "LOG"
	MOD = "MOD"

	SUM = "SUM"

	SIN = "SIN"
	COS = "COS"
	TAN = "TAN"

	MEAN   = "MEAN"
	MEDIAN = "MEDIAN"
	MODE   = "MODE"
	VAR    = "VAR"
	STDEV  = "STDEV"
	MAX    = "MAX"
	MIN    = "MIN"
	RANK   = "RANK"

	ROUND = "ROUND"
	CEIL  = "CEIL"
	FLOOR = "FLOOR"

	RAND     = "RAND"
	CORR     = "CORR"
	BETA     = "BETA"
	BETAINV  = "BETA.INV"
	BINOM    = "BINOM"
	BINOMINV = "BINOM.INV"
	CHI      = "CHI"
	CHIINV   = "CHI.INV"
	GAMMA    = "GAMMA"
	GAMMAINV = "GAMMA.INV"
	LOGDIST  = "LOG.DIST"
	LOGINV   = "LOG.INV"
	NORM     = "NORM"
	NORMINV  = "NORM.INV"
	POISSON  = "POISSON"
	PERMUT   = "PERMUT"

	NOW   = "NOW"
	DAY   = "DAY"
	MONTH = "MONTH"
	YEAR  = "YEAR"

	GROUPBY = "GROUPBY"
	VLOOKUP = "VLOOKUP"
	XLOOKUP = "XLOOKUP"
)

func (sh *Sheet) evalExpr(expr Expr) (Value, error) {
	switch e := expr.(type) {
	case *Number:
		return Value{value: e.Value}, nil

	case *StringLit:
		return Value{value: e.Value}, nil

	case *Cell:
		val := sh.data[e.Ref]
		if val == nil {
			return Value{}, nil
		}

		if f, err := strconv.ParseFloat(val.String(), 64); err == nil {
			return Value{value: f}, nil
		}

		return Value{value: val.String()}, nil
	case *BinaryExpr:
		left, err := sh.evalExpr(e.Left)
		if err != nil {
			return Value{}, err
		}

		right, err := sh.evalExpr(e.Right)
		if err != nil {
			return Value{}, err
		}

		lf, err := left.AsFloat()
		if err != nil {
			return Value{}, fmt.Errorf("left operand is not numeric")
		}

		rf, err := right.AsFloat()
		if err != nil {
			return Value{}, fmt.Errorf("right operand is not numeric")
		}

		switch e.Op {
		case "+":
			v := Value{
				value: lf + rf,
			}
			return v, nil
		case "-":
			return Value{value: lf - rf}, nil
		case "*":
			return Value{value: lf * rf}, nil
		case "/":
			if rf == 0 {
				return Value{}, fmt.Errorf("division by zero")
			}
			return Value{value: lf / rf}, nil
		case "<":
			if lf < rf {
				return Value{value: 1.0}, nil
			}
			return Value{value: 0.0}, nil
		case ">":
			fmt.Println(lf, rf)
			if lf > rf {
				return Value{value: 1.0}, nil
			}
			return Value{value: 0.0}, nil
		case "==":
			fmt.Println(lf, rf)
			if lf == rf {
				return Value{value: 1.0}, nil
			}
			return Value{value: 0.0}, nil
		case "!=":
			if lf != rf {
				return Value{value: 1.0}, nil
			}
			return Value{value: 0.0}, nil
		default:
			return Value{}, fmt.Errorf("unsupported binary op: %s", e.Op)
		}

	case *Range:
		var vals []Value

		cells := expandRange(e.Start, e.End)

		for _, ref := range cells {
			v, _ := sh.evalExpr(&Cell{Ref: ref})
			vals = append(vals, v)
		}

		sum := 0.0
		for _, v := range vals {
			if vf, ok := v.value.(float64); ok {
				sum += vf
			}
		}

		return Value{value: sum}, nil

	case *FuncCall:
		var args []Value
		for _, a := range e.Args {
			if r, ok := a.(*Range); ok {
				for _, ref := range expandRange(r.Start, r.End) {
					v, _ := sh.evalExpr(&Cell{Ref: ref})
					args = append(args, v)
				}
			} else {
				v, err := sh.evalExpr(a)
				if err != nil {
					return Value{}, err
				}
				args = append(args, v)
			}
		}

		switch strings.ToUpper(e.Name) {

		case E:
			return Value{value: math.E}, nil

		case PI:
			return Value{value: math.Pi}, nil

		case ABS:
			f0, err := args[0].AsFloat()
			if err != nil {
				return Value{}, err
			}

			return Value{value: math.Abs(f0)}, nil

		case SIN:
			f0, err := args[0].AsFloat()
			if err != nil {
				return Value{}, err
			}

			return Value{value: math.Sin(f0)}, nil

		case COS:
			f0, err := args[0].AsFloat()
			if err != nil {
				return Value{}, err
			}

			return Value{value: math.Cos(f0)}, nil

		case TAN:
			f0, err := args[0].AsFloat()
			if err != nil {
				return Value{}, err
			}

			return Value{value: math.Tan(f0)}, nil

		case ROUND:
			f0, err := args[0].AsFloat()
			if err != nil {
				return Value{}, err
			}

			return Value{value: math.Round(f0)}, nil

		case CEIL:
			f0, err := args[0].AsFloat()
			if err != nil {
				return Value{}, err
			}

			return Value{value: math.Ceil(f0)}, nil

		case FLOOR:
			f0, err := args[0].AsFloat()
			if err != nil {
				return Value{}, err
			}

			return Value{value: math.Floor(f0)}, nil

		case MOD:
			f0, err := args[0].AsFloat()
			if err != nil {
				return Value{}, fmt.Errorf("expected float64")
			}
			f1, err := args[0].AsFloat()
			if err != nil {
				return Value{}, fmt.Errorf("expected float64")
			}
			res := math.Mod(f0, f1)

			return Value{
				value: res,
			}, nil

		case NOW:
			return Value{value: time.Now().Unix()}, nil

		case SUM:
			sum := 0.0
			for _, v := range args {
				if vf, ok := v.value.(float64); ok {
					sum += vf
				}
			}
			return Value{value: sum}, nil

		case MEAN:
			sum := 0.0
			count := 0.0

			for _, v := range args {
				if vf, ok := v.value.(float64); ok {
					sum += vf
					count += 1
				}
			}

			sum /= count

			return Value{value: sum}, nil

		case MEDIAN:
			return Value{}, ErrUnimplemented

		case VAR:
			return Value{}, ErrUnimplemented

		case RAND:
			return Value{value: rand.Float64()}, nil

		case NORM:
			if len(args) != 2 {
				return Value{}, fmt.Errorf("NORM(mu, sigma) expected 2 args")
			}

			v0, err := args[1].AsFloat()
			if err != nil {
				return Value{}, err
			}

			v1, err := args[0].AsFloat()
			if err != nil {
				return Value{}, err
			}

			return Value{
				value: rand.NormFloat64()*(v0) + (v1),
			}, nil

		case BINOMINV:
			return Value{}, ErrUnimplemented

		case VLOOKUP:
			return sh.evalVLookup(args, e.Args)

		case XLOOKUP:
			fallthrough

		default:
			return Value{}, fmt.Errorf("unknown function: %s", e.Name)
		}

	default:
		return Value{}, fmt.Errorf("unsupported expression type: %T", expr)
	}
}

func (sh *Sheet) evalVLookup(
	args []Value,
	rawArgs []Expr,
) (Value, error) {
	if len(args) < 3 {
		return Value{}, fmt.Errorf("VLOOKUP requires at least 3 arguments")
	}

	lookupVal := args[0]

	tableRange, ok := rawArgs[1].(*Range)
	if !ok {
		return Value{}, fmt.Errorf("VLOOKUP expects a range as second argument")
	}

	colIndex := int(rawArgs[2].(*Number).Value)

	exactMatch := true
	if len(args) > 3 {
		exactMatch = !args[3].IsZero()
	}

	rows := expandRangeToGrid(tableRange.Start, tableRange.End)

	for _, row := range rows {
		if len(row) < colIndex || colIndex < 1 {
			continue
		}

		cellVal := sh.getCellValue(row[0])
		if cellVal == nil {
			continue
		}

		if (exactMatch && lookupVal.Equals(*cellVal)) ||
			(!exactMatch && lookupVal.CoercedEquals(*cellVal)) {
			targetCell := row[colIndex-1]

			result := sh.getCellValue(targetCell)
			if result == nil {
				return Value{}, nil
			}

			return *result, nil
		}
	}

	return Value{}, fmt.Errorf("VLOOKUP: value not found")
}

func expandRangeToGrid(start, end string) [][]string {
	startX, startY, _ := cellToCoord(start)
	endX, endY, _ := cellToCoord(end)

	var rows [][]string
	for y := min(startY, endY); y <= max(startY, endY); y++ {
		var row []string
		for x := min(startX, endX); x <= max(startX, endX); x++ {
			row = append(row, coordToCell(x, y))
		}
		rows = append(rows, row)
	}

	return rows
}

func (sh *Sheet) getCellValue(ref string) *Value {
	cell := sh.data[ref]
	if cell == nil {
		return nil
	}

	v := cell.Value()
	return &Value{value: v}
}

func expandRange(start, end string) []string {
	c1x, c1y, _ := cellToCoord(start)
	c2x, c2y, _ := cellToCoord(end)

	var result []string
	for x := min(c1x, c2x); x <= max(c1x, c2x); x++ {
		for y := min(c1y, c2y); y <= max(c1y, c2y); y++ {
			result = append(result, coordToCell(x, y))
		}
	}

	return result
}
