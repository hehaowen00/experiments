import pandas as pd
import numpy as np
import math
from collections import Counter
from sklearn.model_selection import train_test_split

def entropy(y):
    total = len(y)
    counts = Counter(y)
    ent = 0.0

    for count in counts.values():
        p = count / total
        ent -= p * math.log2(p)

    return ent

def tokenize(arr):
    lut = {}
    res = []

    for v in arr:
        if v not in lut:
            lut[v] = len(lut) + 1
        res.append(lut[v])

    return lut, res

def info_gain(y_parent, y_left, y_right):
    parent = entropy(y_parent)
    left = entropy(y_left)
    right = entropy(y_right)

    n = len(y_parent)
    n_left = len(y_left)
    n_right = len(y_right)
    weighted = (n_left/n) * left + (n_right/n) * right

    return parent - weighted

def gain_ratio(X, a):
    pass

def gini(y):
    counts = y.value_counts()
    probs = counts / len(y)
    return 1 - sum(p ** 2 for p in probs)

def gini_index(y_parent, y_left, y_right):
    parent = gini(y_parent)
    left = gini(y_left)
    right = gini(y_right)

    n = len(y_parent)
    n_left = len(y_left)
    n_right = len(y_right)

    if n_left == 0 or n_right == 0:
        return 0

    weighted = (n_left/n) * left + (n_right/n) * right
    return parent - weighted

class Node:
    def __init__(self, criterion, max_depth=None, min_sample_split=3, depth=0) -> None:
        self.left = None
        self.right = None
        self.feature = None
        self.value = None
        self.is_leaf = False
        self.prediction = None
        self.gain = None
        self.criterion = criterion
        self.max_depth = max_depth
        self.min_sample_split = min_sample_split
        self.depth = depth

    def fit(self, X, y):
        if len(set(y)) == 1:
            self.is_leaf = True
            self.prediction = y.iloc[0]
            return

        if len(X) < self.min_sample_split:
            self.is_leaf = True
            self.prediction = y.mode()[0]
            return

        if self.max_depth is not None and self.depth >= self.max_depth:
            self.is_leaf = True
            self.prediction = y.mode()[0]
            return

        if len(X.columns) == 0:
            self.is_leaf = True
            self.prediction = y.mode()[0]
            return

        if len(set(y)) == 1:
            self.is_leaf = True
            self.prediction = y.iloc[0]
            return

        if len(X.columns) == 0:
            self.is_leaf = True
            self.prediction = y.mode()[0]
            return
        
        best_gain = -math.inf
        best_feature = None
        best_threshold = None

        for feature in X.columns:
            # print(feature)
            values = sorted(X[feature].unique())
            possible_thresholds = [(v1+v2)/2 for v1, v2 in zip(values[:-1], values[1:])]
            # print('thesholds\n', feature, possible_thresholds)

            for threshold in possible_thresholds:
                left_mask = X[feature] <= threshold
                right_mask = X[feature] > threshold

                y_left = y[left_mask]
                y_right = y[right_mask]

                if len(y_left) == 0 or len(y_right) == 0:
                    continue
                
                gain = self.criterion(y, y_left, y_right)
                # print(feature, gain, best_gain)
                if gain > best_gain:
                    best_gain = gain
                    best_feature = feature
                    best_threshold = threshold

        if best_gain == 0 or best_feature is None:
            self.is_leaf = True
            self.prediction = y.mode()[0]
            return
        
        self.feature = best_feature
        self.value = best_threshold
        self.gain = best_gain

        left_mask = X[best_feature] <= best_threshold
        right_mask = X[best_feature] > best_threshold

        X_left, y_left = X[left_mask], y[left_mask]
        X_right, y_right = X[right_mask], y[right_mask]

        self.left = Node(self.criterion, max_depth=self.max_depth, min_sample_split=self.min_sample_split, depth=self.depth + 1)
        self.left.fit(X_left, y_left)

        self.right = Node(self.criterion, max_depth=self.max_depth, min_sample_split=self.min_sample_split, depth=self.depth + 1)
        self.right.fit(X_right, y_right)

    def predict_row(self, row):
        if self.is_leaf:
            return self.prediction

        if row[self.feature] <= self.value:
            return self.left.predict_row(row)
        else:
            return self.right.predict_row(row)
    
class DecisionTreeClassifier:
    def __init__(self, criterion: str = 'information', max_depth = 20, min_sample_split=5) -> None:
        self.root = None
        self.max_depth = max_depth
        self.min_sample_split = min_sample_split

        lut = {
            'information': info_gain,
            'gini': gini_index,
        }
        self.criterion = lut[criterion]
        if self.criterion is None:
            raise Exception('criterion not found: ' + criterion)

    def fit(self, X, y):
        self.root = Node(self.criterion, self.max_depth, self.min_sample_split)
        self.root.fit(X, y)

    def predict(self, X):
        return X.apply(lambda row: self.root.predict_row(row), axis=1)

    def print(self, tree=None, indent=' '):
        if not tree:
            tree = self.root

        # if len(indent) > 20:
        #     raise Exception('wth')

        if tree.is_leaf:
            print(tree.prediction)
        else:
            print('X_' + str(tree.feature), '<=', tree.value, '?', tree.gain)
            print('%sleft:' % (indent), end='')
            self.print(tree.left, indent + ' ')
            print('%sright:' % (indent), end='')
            self.print(tree.right, indent + ' ')

if __name__ == '__main__':
    samples = ['c1', 'c2', 'c3', 'c4', 'nc1', 'nc2', 'nc3']
    classification = ['c', 'c', 'c', 'c', 'nc', 'nc', 'nc']
    m1 = [1,1,1,0,0,0,1]
    m2 = [1,1,0,1,0,1,1]
    m2 = [1,0,1,1,0,0,0]
    m3 = [0,1,1,0,0,0,0]

    df = pd.DataFrame({
        'id': samples,
        'm1': m1,
        'm2': m2,
        'm3': m3,
        'classification': classification,
    })
    print(df)

    X = df[['m1', 'm2', 'm3']]
    y = df['classification']

    # lut, y0 = tokenize(df['classification'])
    # print(X)
    # print(list(y), lut, y0)

    # x_train, x_test, y_train, y_test = train_test_split(X, y, random_state=42)
    x_train = X
    y_train = y
    
    # print(len(x_train),  len(y_train))
    # print(x_test, y_test)

    # ent = info_gain(df[['m1', 'm2', 'm3']], df['classification'], 'm1')
    # print(ent)

    # ent = info_gain(df[['m1', 'm2', 'm3']], df['classification'], 'm2')
    # print(ent)

    # ent = info_gain(df[['m1', 'm2', 'm3']], df['classification'], 'm3')
    # print(ent)

    tree = DecisionTreeClassifier('information', max_depth=10)
    tree.fit(x_train, y_train)
    res = tree.predict(X)

    print('x_test\n', res)
    print('y_test\n', y)