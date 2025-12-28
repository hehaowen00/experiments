package amsr

import (
	"fmt"
	"maps"
	"math"
)

func ToOdds(prices []float64) []float64 {
	res := make([]float64, len(prices))
	for i := range prices {
		res[i] = 1 / prices[i]
	}
	return res
}

func TotalShares(shares map[int64]float64) float64 {
	total := 0.0
	for _, v := range shares {
		total += v
	}
	return total
}

type LMSR []entry

type entry struct {
	outcome int64
	price   float64
	staked  float64
}

func (lmsr *LMSR) AddEntry(outcomeID int64, price float64, staked float64) {
	*lmsr = append(*lmsr, entry{
		outcome: outcomeID,
		price:   price,
		staked:  staked,
	})
}

type LmsrResults struct {
	B    float64
	Odds map[int64]float64
}

func (lmsr LMSR) Discover(maxBetStake float64) LmsrResults {
	outcomes := map[int64]float64{}

	for _, order := range lmsr {
		outcomes[order.outcome] += order.staked / order.price
	}

	// log.Println(outcomes)

	b := maxBetStake / math.Log(float64(len(outcomes)))

	denom := 0.0

	for id, shares := range outcomes {
		_ = id
		denom += math.Pow(math.E, shares/b)
	}

	odds := map[int64]float64{}

	for id, shares := range outcomes {
		odds[id] = 1 / (math.Pow(math.E, shares/b) / denom)
	}

	return LmsrResults{
		B:    b,
		Odds: odds,
	}
}

type LMSROptions struct {
	BInitial  float64
	Alpha     float64
	MarginPct float64
	Outcomes  map[int64]float64
}

// Liquidity Sensitive LMSR
// Automatically adjusts prices in response to trading activity
type LSLMSR struct {
	bInitial      float64
	alpha         float64
	marginPct     float64
	shares        map[int64]float64
	initialShares map[int64]float64
	numOutcomes   int
}

// bInitial: initial number of shares in the market
// alpha: scaling factor for liquidity based on total shares
// marginPct: total market percentage
// initialOdds: map of all outcomes and initial prices
func NewLSLMSR(opts LMSROptions) (*LSLMSR, error) {
	if opts.BInitial <= 0 || opts.Alpha < 0 {
		return nil, fmt.Errorf("bInitial must be positive, alpha must be non-negative")
	}
	if len(opts.Outcomes) <= 1 {
		return nil, fmt.Errorf("number of outcomes must be greater than 1")
	}
	if opts.MarginPct <= 0 {
		return nil, fmt.Errorf("marginPct must be positive")
	}
	if opts.MarginPct < 1.0 {
		fmt.Printf("margin pct <= 1.0, arbitrage is possible")
	}

	sumOdds := 0.0
	for _, odds := range opts.Outcomes {
		if odds <= 0 {
			return nil, fmt.Errorf("initial odds must be positive for log calculation: %f", odds)
		}
		sumOdds += odds
	}
	if math.Abs(sumOdds-1.0) > 1e-9 { // Allow for floating point inaccuracies
		return nil, fmt.Errorf("initial odds must sum to 1.0, but got %f", sumOdds)
	}

	l := &LSLMSR{
		bInitial:      opts.BInitial,
		alpha:         opts.Alpha,
		marginPct:     opts.MarginPct,
		shares:        make(map[int64]float64),
		initialShares: map[int64]float64{},
	}

	for i := range opts.Outcomes {
		l.shares[i] = l.bInitial * math.Log(opts.Outcomes[i])
	}

	maps.Copy(l.initialShares, l.shares)
	l.numOutcomes = len(l.shares)

	return l, nil
}

// b(q) = b_initial + alpha * sum(|q_j|)
func (m *LSLMSR) CalculateB() float64 {
	sumAbsShares := 0.0
	for _, q := range m.shares {
		sumAbsShares += math.Abs(q)
	}
	return m.bInitial + m.alpha*sumAbsShares
}

// C(q) = b(q) * log(sum(exp(q_j / b(q))))
func (m *LSLMSR) Cost() float64 {
	currentB := m.CalculateB()
	sumExp := 0.0
	for _, q := range m.shares {
		sumExp += math.Exp(q / currentB)
	}
	if sumExp <= 0 {
		return math.Inf(1)
	}
	return currentB * math.Log(sumExp)
}

// P_i(q)_quoted = (exp(q_i / b(q)) / sum(exp(q_j / b(q)))) * marginPct
func (m *LSLMSR) GetPrice(outcomeID int64) (float64, error) {
	if outcomeID < 0 {
		return 0, fmt.Errorf("outcome index out of bounds")
	}

	currentB := m.CalculateB()
	sumExp := 0.0
	for _, q := range m.shares {
		sumExp += math.Exp(q / currentB)
	}

	if sumExp == 0 {
		return 0, fmt.Errorf("division by zero: sum of exponentials is zero")
	}

	rawPrice := math.Exp(m.shares[outcomeID]/currentB) / sumExp
	return rawPrice * m.marginPct, nil
}

// GetPrices calculates the current marginal prices for all outcomes, scaled by marginPct.
func (m *LSLMSR) GetPrices() ([]float64, error) {
	prices := make([]float64, m.numOutcomes)
	currentB := m.CalculateB()

	sumExp := 0.0
	for _, q := range m.shares {
		sumExp += math.Exp(q / currentB)
	}

	if sumExp == 0 {
		return nil, fmt.Errorf("division by zero: sum of exponentials is zero")
	}

	for i := range m.shares {
		rawPrice := math.Exp(m.shares[i]/currentB) / sumExp
		prices[i] = rawPrice * m.marginPct
	}

	return prices, nil
}

func (m *LSLMSR) Trade(outcomeID int64, stake float64) (float64, error) {
	if outcomeID < 0 {
		return 0, fmt.Errorf("outcome index out of bounds")
	}

	price, err := m.GetPrice(outcomeID)
	if err != nil {
		return 0.0, err
	}
	amount := stake / price

	costBefore := m.Cost()
	m.shares[outcomeID] += amount

	costAfter := m.Cost()
	lmsrTradeCost := costAfter - costBefore

	var actualTradeCost float64
	if amount > 0 {
		actualTradeCost = lmsrTradeCost * m.marginPct
	} else if amount < 0 {
		actualTradeCost = lmsrTradeCost / m.marginPct
	} else {
		actualTradeCost = 0
	}

	return actualTradeCost, nil
}

func (m *LSLMSR) GetShares() map[int64]float64 {
	currentShares := make(map[int64]float64, m.numOutcomes)
	maps.Copy(currentShares, m.shares)
	return currentShares
}
