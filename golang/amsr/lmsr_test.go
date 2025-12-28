package amsr_test

import (
	"fmt"
	"math"
	"sportscenter/internal/amsr"
	"testing"
)

func TestLMSR_50(t *testing.T) {
	lmsr := amsr.LMSR{}
	lmsr.AddEntry(1, 1.6, 50)
	lmsr.AddEntry(2, 2, 70)

	results := lmsr.Discover(50.0)
	t.Log(results)
}

func TestLMSR_100(t *testing.T) {
	lmsr := amsr.LMSR{}
	lmsr.AddEntry(1, 1.6, 50)
	lmsr.AddEntry(2, 2, 70)

	results := lmsr.Discover(100.0)
	t.Log(results)
}

func TestLMSR_1000(t *testing.T) {
	lmsr := amsr.LMSR{}
	lmsr.AddEntry(1, 1.6, 50)
	lmsr.AddEntry(2, 2, 70)

	results := lmsr.Discover(1000.0)
	t.Log(results)
}

func TestLMSR_50_0(t *testing.T) {
	lmsr := amsr.LMSR{}
	lmsr.AddEntry(1, 1.6, 50)
	lmsr.AddEntry(2, 2, 0)

	results := lmsr.Discover(50.0)
	t.Log(results)
}

func TestLMSR_100_0(t *testing.T) {
	lmsr := amsr.LMSR{}
	lmsr.AddEntry(1, 1.6, 50)
	lmsr.AddEntry(2, 2, 0)

	results := lmsr.Discover(100.0)
	t.Log(results)
}

func TestLMSR_1000_0(t *testing.T) {
	lmsr := amsr.LMSR{}
	lmsr.AddEntry(1, 1.6, 50)
	lmsr.AddEntry(2, 2, 0)

	results := lmsr.Discover(1000.0)
	t.Log(results)
}

func TestLMSRSettings(t *testing.T) {
	o1 := 1.6
	o2 := 2.0

	p1 := 1 / o1
	p2 := 1 / o2

	total := p1 + p2

	t.Log(total)

	p1 /= total
	p2 /= total

	ratio := p1 / p2

	b0 := math.Log(ratio) * 100

	qA := (b0 / 2)
	qB := -(b0 / 2)

	lmsr := amsr.LMSR{}
	lmsr.AddEntry(1, 1.6, 1.6*qA)
	lmsr.AddEntry(2, 2, 2*qB)

	results := lmsr.Discover(100.0)
	t.Log(results)
}

func TestLSLMSR(t *testing.T) {
	sumSlice := func(s []float64) float64 {
		total := 0.0
		for _, v := range s {
			total += v
		}
		return total
	}

	market, err := amsr.NewLSLMSR(
		amsr.LMSROptions{
			BInitial:  4000.0,
			Alpha:     0.2,
			MarginPct: 1.15,
			Outcomes: map[int64]float64{
				0: 0.3,
				1: 0.2,
				2: 0.13,
				3: 0.37,
			},
		})
	if err != nil {
		fmt.Println("Error creating market:", err)
		return
	}

	t.Logf("initial b (b_initial): %.2f\n", market.CalculateB())
	initialPrices, _ := market.GetPrices()
	t.Logf("initial prices: %.4f %.4f %.4f\n", initialPrices, amsr.ToOdds(initialPrices), sumSlice(initialPrices))
	t.Logf("initial shares: %v %v\n", market.GetShares(), amsr.TotalShares(market.GetShares()))
	t.Logf("initial cost: %.4f\n", market.Cost())

	fmt.Println()
	amt := 1.0
	cost, err := market.Trade(1, amt)
	t.Logf("bought $%.2f in outcome 1 - %.2f\n", amt, cost)
	market.Trade(1, 1)
	fmt.Println()

	t.Logf("new b (b_initial): %.2f\n", market.CalculateB())
	initialPrices, _ = market.GetPrices()
	t.Logf("new prices: %.4f %.4f %.4f\n", initialPrices, amsr.ToOdds(initialPrices), sumSlice(initialPrices))
	t.Logf("new shares: %v %v\n", market.GetShares(), amsr.TotalShares(market.GetShares()))
	t.Logf("new cost: %.4f\n", market.Cost())

	fmt.Println()
	amt = 3000.0
	cost, err = market.Trade(3, amt)
	t.Logf("bought $%.2f in outcome 3 - %.2f\n", amt, cost)
	fmt.Println()

	t.Logf("new b (b_initial): %.2f\n", market.CalculateB())
	initialPrices, _ = market.GetPrices()
	t.Logf("new prices: %.4f %.4f %.4f\n", initialPrices, amsr.ToOdds(initialPrices), sumSlice(initialPrices))
	t.Logf("new shares: %v %v\n", market.GetShares(), amsr.TotalShares(market.GetShares()))
	t.Logf("new cost: %.4f\n", market.Cost())

	// reframed := amsrs.LinearReframe(initialPrices, 1.0)
	// t.Log(initialPrices, reframed)
}
