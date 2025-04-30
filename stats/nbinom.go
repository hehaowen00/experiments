package stats

// Negative Binomial Distribution
type NBinom struct {
	N float64
	P float64
}

// negative binomial parameterizations
//
// mu = mean
// n = number of successes
// p = probability of a single success
//
// mean number of failures mu to achieve n successes
//
// p = n / (n + mu)
//
// or
//
// p = mu / var
// n = mu^2 / ( var - mu )

func (dist *NBinom) Rand() float64 {
	return 0.0
}

func (dist *NBinom) PDF(x float64) float64 {
	return 0.0
}

func (dist *NBinom) CDF(x float64) float64 {
	if x < 0 {
		return 0.0
	}

	return mathBetaInc(dist.P, dist.N, x+1)
}
