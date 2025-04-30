package stats

type Poisson struct {
	Lambda float64
}

func (dist *Poisson) Rand() float64 {
	return 0.0
}

func (dist *Poisson) PDF(x float64) float64 {
	return 0.0
}

func (dist *Poisson) CDF(x float64) float64 {
	return 0.0
}
