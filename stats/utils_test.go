package stats

import "testing"

func TestFactorial(t *testing.T) {
	value := Factorial(10)
	if value != 3628800 {
		t.Log(value)
		t.FailNow()
	}
}

func TestNBinom(t *testing.T) {
	mu := 22.8125
	variance := 49.3625

	dist := NBinom{
		N: mu,
		P: mu / variance,
	}

	t.Log(1 / (1 - dist.CDF(15)))
	t.Log(1 / (1 - dist.CDF(20)))
	t.Log(1 / (1 - dist.CDF(25)))
	t.Log(1 / (1 - dist.CDF(30)))
	t.Log(1 / (1 - dist.CDF(35)))
}
