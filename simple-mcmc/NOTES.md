# simple-mcmc

Source: [MCMC](https://carlessanchezalonso.github.io/2020/mcmc/)


find probability of our model parameters given the data

want to estimate the posterior probability distribution function of each parameter
in our model M given data D, p(theta|M,D)

bayes theorem relates the posterior distribution to the likelihood L(D|theta,M)
computed from the model and a prior distribution pi(theta|M)

p(theta|M,D) = L(D|theta,M) / p(D,M)

denominator is called evidence

## procedure and sampling

1. for a given point in parameter space, generate a prediction

2. compute probability of the data given that model

3. given some prior, use bayes theorem to get the posterior at that point in
parameter space

4. go to another point in parameter space

## MCMC

is a random walk through parameter space such that the density of points is
proportional to the posterior probability

1. start at a random point in parameter space theta\_old, (L\_pi)old

Metropolis Hastings

## Real Data

model H(z) = H\_0 * sqrt(theta\_m * (1+ z)^3 + (1 + omega\_m))
