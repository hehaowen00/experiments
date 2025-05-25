import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from sklearn.preprocessing import LabelEncoder
from tree import DecisionTreeClassifier

if __name__ == '__main__':
    titanic_train_data = pd.read_csv('../datasets/titanic/train.csv')
    titanic_test_data = pd.read_csv('../datasets/titanic/test.csv')

    enc = LabelEncoder()
    titanic_train_data['Sex'] = enc.fit_transform(titanic_train_data['Sex'])
    titanic_train_data['Embarked'] = enc.fit_transform(titanic_train_data['Embarked'])
    titanic_train_data['Ticket'] = enc.fit_transform(titanic_train_data['Ticket'])
    titanic_train_data['Cabin'] = enc.fit_transform(titanic_train_data['Cabin'])
    titanic_train_data['Age'] = titanic_train_data['Age'].dropna()

    titanic_test_data['Sex'] = enc.fit_transform(titanic_test_data['Sex'])
    titanic_test_data['Embarked'] = enc.fit_transform(titanic_test_data['Embarked'])
    titanic_test_data['Ticket'] = enc.fit_transform(titanic_test_data['Ticket'])
    titanic_test_data['Cabin'] = enc.fit_transform(titanic_test_data['Cabin'])
    titanic_test_data['Age'] = titanic_test_data['Age'].dropna()

    train_cols = ['SibSp', 'Sex', 'Parch', 'Fare', 'Pclass', 'Embarked', 'Ticket']
    X = titanic_train_data[train_cols]
    y = titanic_train_data

    # x_train, x_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
    tree = DecisionTreeClassifier('gini', max_depth=10, min_sample_split=5)
    tree.fit(X, y['Survived'])

    x_test = titanic_test_data[train_cols]
    res = tree.predict(x_test)
    output = pd.DataFrame({
        'PassengerId': titanic_test_data['PassengerId'],
        'Survived': res
    })

    print(output.head())
    print(output['Survived'].value_counts())
    output.reset_index()
    output.to_csv('submission.csv', index=False)