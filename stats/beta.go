package stats

type Beta struct {
	Lambda float64
}

func (dist *Beta) Rand() float64 {
	return 0.0
}

func (dist *Beta) PDF(x float64) float64 {
	return 0.0
}

func (dist *Beta) CDF(x float64) float64 {
	return 0.0
}
