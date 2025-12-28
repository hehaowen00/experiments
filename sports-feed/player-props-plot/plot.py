import matplotlib.pyplot as plt

plt.figure()

# indiana pacers vs new york knicks

# jalen brunson
scores = [20, 25, 30, 35, 40]
prices = [1.1, 1.42, 2.15, 3.9, 8.75]
plt.scatter(scores, prices, label='Jalen Brunson', color='blue')

# karl anthony towns
scores = [15, 20, 25, 30, 35]
prices = [1.11, 1.5, 2.5, 5.25, 12.5]
plt.scatter(scores, prices, label='Karl Anthony Towns', color='orange')

# pascal siakam
scores = [10, 15, 20, 25, 30]
prices = [1.04, 1.31, 2.12, 4.4, 11]
plt.scatter(scores, prices, label='Pascal Siakam', color='green')

# tyrese haliburton
scores = [10, 15, 20, 25, 30]
prices = [1.06, 1.35, 2.15, 4.5, 11]
plt.scatter(scores, prices, label='Tyrese Haliburton', color='red')

# mikhail bridges
scores = [10, 15, 20, 25]
prices = [1.08, 1.55, 2.95, 7]
plt.scatter(scores, prices, label='Mikhail Bridges', color='purple')

plt.show()