package stats

import "math"

// ( k + n - 1 )
// ( n - 1 )
func BinomialCoeff(n, k float64) float64 {
	return float64(Factorial(int64(n)) / (Factorial(int64(k)) * Factorial(int64(n)-int64(k))))
}

func Factorial(n int64) int64 {
	switch {
	case n <= 0:
		return 1
	case n <= 2:
		return n
	default:
		return n * Factorial(n-1)
	}
}

// from perf/internal/stats/beta.go

func Lgamma(x float64) float64 {
	y, _ := math.Lgamma(x)
	return y
}

// Regularized Incomplete Beta Function
func IncompleteBeta(x, a, b float64) float64 {
	// Based on Numerical Recipes in C, section 6.4. This uses the
	// continued fraction definition of I:
	//
	//  (xᵃ*(1-x)ᵇ)/(a*B(a,b)) * (1/(1+(d₁/(1+(d₂/(1+...))))))
	//
	// where B(a,b) is the beta function and
	//
	//  d_{2m+1} = -(a+m)(a+b+m)x/((a+2m)(a+2m+1))
	//  d_{2m}   = m(b-m)x/((a+2m-1)(a+2m))
	if x < 0 || x > 1 {
		return math.NaN()
	}
	bt := 0.0
	if 0 < x && x < 1 {
		// Compute the coefficient before the continued
		// fraction.
		bt = math.Exp(Lgamma(a+b) - Lgamma(a) - Lgamma(b) +
			a*math.Log(x) + b*math.Log(1-x))
	}
	if x < (a+1)/(a+b+2) {
		// Compute continued fraction directly.
		return bt * betacf(x, a, b) / a
	} else {
		// Compute continued fraction after symmetry transform.
		return 1 - bt*betacf(1-x, b, a)/b
	}
}

// betacf is the continued fraction component of the regularized
// incomplete beta function Iₓ(a, b).
func betacf(x, a, b float64) float64 {
	const maxIterations = 200
	const epsilon = 3e-14

	raiseZero := func(z float64) float64 {
		if math.Abs(z) < math.SmallestNonzeroFloat64 {
			return math.SmallestNonzeroFloat64
		}
		return z
	}

	c := 1.0
	d := 1 / raiseZero(1-(a+b)*x/(a+1))
	h := d
	for m := 1; m <= maxIterations; m++ {
		mf := float64(m)

		// Even step of the recurrence.
		numer := mf * (b - mf) * x / ((a + 2*mf - 1) * (a + 2*mf))
		d = 1 / raiseZero(1+numer*d)
		c = raiseZero(1 + numer/c)
		h *= d * c

		// Odd step of the recurrence.
		numer = -(a + mf) * (a + b + mf) * x / ((a + 2*mf) * (a + 2*mf + 1))
		d = 1 / raiseZero(1+numer*d)
		c = raiseZero(1 + numer/c)
		hfac := d * c
		h *= hfac

		if math.Abs(hfac-1) < epsilon {
			return h
		}
	}
	panic("betainc: a or b too big; failed to converge")
}
