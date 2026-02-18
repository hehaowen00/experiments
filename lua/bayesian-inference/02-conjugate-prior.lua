-- conjugate priors and updating
--
-- given a prior distribution x likelihood
-- posterior should be in the same family of distributions for the prior
--
-- p(theta|x) = p(x|theta) * p(theta)
--
-- for coin, x ~ binomial(n, theta)
-- conjugate prior for binomial should be a beta distribution
-- beta random variable
--
-- theta ~ beta(alpha, beta)

local array = require("array")
local math = require("math")
local predicate = require("predicate")

function likelihood(theta, data)
	local heads = data.cumsum(function(data)
		return data == 1
	end)

	local tails = data.cumsum(function(data)
		return data == 0
	end)

	return theta ^ heads + (1 - theta) ^ tails
end

function update(prior_alpha, prior_beta, data)
	local heads = data:cumsum(data)
	local tails = data:cumsum(data)

	local posterior_alpha = prior_alpha + heads
	local posterior_beta = prior_beta + tails

	return posterior_alpha, posterior_beta
end

local data = array.array({ 1, 0, 1, 1, 0, 1, 0, 0 })

local prior_alpha = 1
local prior_beta = 1

local alphas = { prior_alpha }
local betas = { prior_beta }

for i = 1, #data do
	prior_alpha, prior_beta = update(prior_alpha, prior_beta, array.array({ data[i] }))
	print(i, data[i], "a", prior_alpha, "b", prior_beta)
end

print(data:mean(), data:min(), data:max())
print(array.random(10):string())

local result = data:filter(predicate.equals(1))
print(result:string())
