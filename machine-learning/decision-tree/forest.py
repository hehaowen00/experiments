import numpy as np
import pandas as pd
from collections import Counter
from tree import DecisionTreeClassifier

class RandomForestClassifier:
    def __init__(self, n_estimators=10, max_features=None, max_depth=None, min_sample_split=2, criterion='information'):
        self.n_estimators = n_estimators
        self.max_features = max_features
        self.max_depth = max_depth
        self.min_sample_split = min_sample_split
        self.criterion = criterion
        self.trees = []

    def fit(self, X, y):
        n_samples, n_features = X.shape

        if self.max_features is None:
            self.max_features = int(np.sqrt(n_features))

        for _ in range(self.n_estimators):
            idxs = np.random.choice(n_samples, n_samples, replace=True)
            X_sample = X.iloc[idxs]
            y_sample = y.iloc[idxs]

            tree = DecisionTreeClassifier(criterion=self.criterion, 
                                          max_depth=self.max_depth, 
                                          min_sample_split=self.min_sample_split,
                                          max_features=5,
                                          )
            tree.fit(X_sample, y_sample)
            self.trees.append(tree)

    def predict(self, X):
        tree_preds = np.array([tree.predict(X) for tree in self.trees])

        final_preds = []
        for i in range(X.shape[0]):
            votes = tree_preds[:, i]
            most_common = Counter(votes).most_common(1)[0][0]
            final_preds.append(most_common)

        return pd.Series(final_preds)
