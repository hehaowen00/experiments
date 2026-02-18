-- bayesian inference
--
-- let x = data
-- let theta = model parameters
--
-- posterior = p(theta | x)
-- likelihood = p (x | theta)
-- prior = p(theta)
--
-- bayes = (likelihood * prior) / p(x)
--
-- balance data and prior beliefs
-- frequentist view given data is incorrect for small sample sizes
-- e.g. 3 flips of a coin beings heads, means all predictions of model is heads
--
-- distribution for theta
--
-- p_k + 1(theta|x) = (p_k(x|theta) * p_k(theta)) / p_k(x)
--
-- drawbacks:
-- prior choice is important
-- beta and binomial priors are very simple
-- curse of dimensionality

local math = require("math")
local os = require("os")

local P_H1 = 0.5
local P_H2 = 0.5

function likelihood(data, hypothesis)
	if hypothesis == "H1" then
		return 0.5
	elseif hypothesis == "H2" then
		if data == 1 then
			return 0.7
		else
			return 0.3
		end
	end
end

function update(prior_h1, prior_h2, data)
	local likelihood_h1 = likelihood(data, "H1")
	local likelihood_h2 = likelihood(data, "H2")

	local p_data = (likelihood_h1 * prior_h1) + (likelihood_h2 * prior_h2)

	local posterior_h1 = (likelihood_h1 * prior_h1) / p_data
	local posterior_h2 = (likelihood_h2 * prior_h2) / p_data

	return posterior_h1, posterior_h2
end

-- entry point

local p1_posterior = P_H1
local p2_posterior = P_H2

math.randomseed(os.time())
math.random()
math.random()
math.random()

for i = 1, 100 do
	local sample = math.random(2) - 1
	p1_posterior, p2_posterior = update(p1_posterior, p2_posterior, sample)

	if i % 10 == 0 then
		print("after flip", i, p1_posterior, p2_posterior)
	end
end
