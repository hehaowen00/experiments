import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from sklearn.preprocessing import LabelEncoder
from tree import DecisionTreeClassifier

'''
entropy = sum(C, i=1, -p_i * log2(p_i))

a decision tree splits the records using attribute selection measures
1. information gain
2. gain ratio
3. gini index

information gain
info(d) = -sum(m, i=1, Pi*log2*Pi) where Pi is the probability of i belonging in class Ci

gain ratio
splitinfo_a(D) = -sum(v, j=1, |Dj|/|D| * log2(|Dj|/|D|))

gini index
gini(D) = 1-sum(m, j=1, Pi^2)
gini_a(D) = |D1|/|D| * Gini(D1) + |D2|/|D| * Gini(D2)
'''

if __name__ == '__main__':
    iris_data = pd.read_csv('../datasets/iris/Iris.csv')
    print(iris_data)

    cols = ['SepalLengthCm', 'SepalWidthCm', 'PetalLengthCm', 'PetalWidthCm']
    x_train, x_test, y_train, y_test = train_test_split(iris_data[cols], iris_data['Species'], test_size=0.3, random_state=42)

    tree = DecisionTreeClassifier()
    tree.fit(x_train, y_train)
    res = tree.predict(x_test)

    print(accuracy_score(y_test, res))
    tree.print()

    titanic_train_data = pd.read_csv('../datasets/titanic/train.csv')
    titanic_test_data = pd.read_csv('../datasets/titanic/test.csv')

    enc = LabelEncoder()
    titanic_train_data['Sex'] = enc.fit_transform(titanic_train_data['Sex'])
    titanic_train_data['Embarked'] = enc.fit_transform(titanic_train_data['Embarked'])
    titanic_train_data['Ticket'] = enc.fit_transform(titanic_train_data['Ticket'])
    titanic_train_data['Cabin'] = enc.fit_transform(titanic_train_data['Cabin'])

    train_cols = ['SibSp', 'Sex', 'Parch', 'Fare', 'Pclass', 'Embarked', 'Ticket']
    X = titanic_train_data[train_cols]
    y = titanic_train_data['Survived']

    x_train, x_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
    tree = DecisionTreeClassifier()
    tree.fit(x_train, y_train)

    res = tree.predict(x_test)
    print(accuracy_score(y_test, res))
    print(x_test)
    tree.print()