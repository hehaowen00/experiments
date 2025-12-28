package main

import (
	"fmt"
	"strconv"
)

type Value struct {
	value any
}

func ParseValue(s string) Value {
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return Value{
			value: f,
		}
	}

	return Value{
		value: s,
	}
}

func (v Value) IsNumber() bool {
	_, ok := v.value.(float64)
	return ok
}

func (v Value) IsString() bool {
	_, ok := v.value.(string)
	return ok
}

func (v Value) AsInt() (int64, error) {
	i, ok := v.value.(float64)
	if ok {
		return int64(i), nil
	}

	return 0, fmt.Errorf("value is not a number")
}

func (v Value) IsZero() bool {
	f, ok := v.value.(float64)
	if ok && f == 0.0 {
		return true
	}

	s, ok := v.value.(string)
	if ok && s == "" {
		return true
	}

	return ok
}

func (v Value) AsFloat() (float64, error) {
	switch vx := v.value.(type) {
	case int64:
		return float64(vx), nil
	case float64:
		return vx, nil
	default:
		return 0, fmt.Errorf("value is not a number")
	}
}

func (v Value) AsString() string {
	if vs, ok := v.value.(string); ok {
		return vs
	}

	if v.value != nil {
		return fmt.Sprintf("%v", v.value)
	}

	return ""
}

func (v Value) Equals(other Value) bool {
	return fmt.Sprint(v.value) == fmt.Sprint(other.value)
}

func (v Value) CoercedEquals(other Value) bool {
	return fmt.Sprint(v.value) == fmt.Sprint(other.value)

	// vf, err1 := v.AsFloat()
	// of, err2 := other.AsFloat()
	// if err1 == nil && err2 == nil {
	// 	return vf == of
	// }

	// return v.AsString() == other.AsString()
}
