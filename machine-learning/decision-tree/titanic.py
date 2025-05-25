import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from sklearn.preprocessing import LabelEncoder
from tree import DecisionTreeClassifier
from forest import RandomForestClassifier

if __name__ == '__main__':
    train_data = pd.read_csv('../datasets/titanic/train.csv')
    test_data = pd.read_csv('../datasets/titanic/test.csv')

    enc = LabelEncoder()
    train_data['Sex'] = enc.fit_transform(train_data['Sex'])
    train_data['Embarked'] = enc.fit_transform(train_data['Embarked'])
    train_data['Ticket'] = enc.fit_transform(train_data['Ticket'])
    train_data['Cabin'] = enc.fit_transform(train_data['Cabin'])
    train_data['Age'] = train_data['Age'].dropna()
    train_data['Age'] = train_data['Age'].fillna(train_data['Age'].median())
    train_data['Cabin_Cat'] = train_data['Cabin'].apply(lambda x: str(x)[0])
    train_data['Cabin_Cat'] = enc.fit_transform(train_data['Cabin_Cat'])

    test_data['Sex'] = enc.fit_transform(test_data['Sex'])
    test_data['Embarked'] = enc.fit_transform(test_data['Embarked'])
    test_data['Ticket'] = enc.fit_transform(test_data['Ticket'])
    test_data['Cabin'] = enc.fit_transform(test_data['Cabin'])
    test_data['Age'] = test_data['Age'].dropna()
    test_data['Age'] = test_data['Age'].fillna(test_data['Age'].median())
    test_data['Cabin_Cat'] = test_data['Cabin'].apply(lambda x: str(x)[0])
    test_data['Cabin_Cat'] = enc.fit_transform(test_data['Cabin_Cat'])

    train_cols = ['SibSp', 'Sex', 'Parch', 'Fare', 'Pclass', 'Embarked', 'Ticket', 'Cabin_Cat']
    X = train_data[train_cols]
    y = train_data['Survived']

    # x_train, x_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
    # tree = DecisionTreeClassifier('information', max_depth=10, min_sample_split=3)
    # tree.fit(x_train, y_train)
    # tree.fit(X, y['Survived'])

    # x_test = titanic_test_data[train_cols]
    # res = tree.predict(x_test)
    # print(accuracy_score(y_test, res))

    x_train = X
    y_train = y
    x_test = test_data[train_cols]

    rf = RandomForestClassifier(n_estimators=100)
    rf.fit(x_train, y_train)
    res = rf.predict(x_test)
    # print(accuracy_score(y_test, res))

    output = pd.DataFrame({
        'PassengerId': test_data['PassengerId'],
        'Survived': res
    })

    print(output.head())
    print(output['Survived'].value_counts())
    output.reset_index()
    output.to_csv('submission.csv', index=False)