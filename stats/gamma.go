package stats

type Gamma struct {
	Lambda float64
}

func (dist *Gamma) Rand() float64 {
	return 0.0
}

func (dist *Gamma) PDF(x float64) float64 {
	return 0.0
}

func (dist *Gamma) CDF(x float64) float64 {
	return 0.0
}
