import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from sklearn.preprocessing import LabelEncoder
from tree import DecisionTreeClassifier

if __name__ == '__main__':
    titanic_train_data = pd.read_csv('../datasets/titanic/train.csv')
    # titanic_test_data = pd.read_csv('../datasets/titanic/test.csv')

    enc = LabelEncoder()
    titanic_train_data['Sex'] = enc.fit_transform(titanic_train_data['Sex'])
    titanic_train_data['Embarked'] = enc.fit_transform(titanic_train_data['Embarked'])
    titanic_train_data['Ticket'] = enc.fit_transform(titanic_train_data['Ticket'])
    titanic_train_data['Cabin'] = enc.fit_transform(titanic_train_data['Cabin'])
    titanic_train_data['Age'] = titanic_train_data['Age'].dropna()

    train_cols = ['SibSp', 'Sex', 'Parch', 'Fare', 'Pclass', 'Embarked', 'Ticket']
    X = titanic_train_data[train_cols]
    y = titanic_train_data['Survived']

    x_train, x_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
    tree = DecisionTreeClassifier()
    tree.fit(x_train, y_train)

    res = tree.predict(x_test)
    print(accuracy_score(y_test, res))
    tree.print()