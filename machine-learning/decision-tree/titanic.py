import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from sklearn.preprocessing import LabelEncoder
from tree import DecisionTreeClassifier
from forest import RandomForestClassifier
from sklearn.metrics import mean_squared_error
from xgboost import XGBClassifier

def one_hot_column(df, label, drop_col=False):
    one_hot = pd.get_dummies(df[label], prefix=label)
    if drop_col:
        df = df.drop(label, axis=1)
    df = df.join(one_hot)
    return df


def one_hot(df, labels, drop_col=False):
    for label in labels:
        df = one_hot_column(df, label, drop_col)
    return df

def encode_data(data):
    enc = LabelEncoder()
    data['Sex'] = enc.fit_transform(data['Sex'])
    data['Embarked'] = enc.fit_transform(data['Embarked'])
    # data['Ticket'] = enc.fit_transform(data['Ticket'])
    # data['Cabin'] = enc.fit_transform(data['Cabin'])
    data['Age'] = data['Age'].dropna()
    data['Age'] = data['Age'].fillna(data['Age'].median())
    data['Cabin_Cat'] = data['Cabin'].apply(lambda x: str(x)[0])
    data['Cabin_Cat'] = enc.fit_transform(data['Cabin_Cat'])
    data["Deck"] = data["Cabin"].str.slice(0,1)
    data["Room"] = data["Cabin"].str.slice(1,5).str.extract("([0-9]+)", expand=False).astype("float")
    data["Room"] = data["Room"].fillna(data["Room"].mean())
    data[['TicketCategory', 'TicketNumber']] = data['Ticket'].str.extract(r'([A-Za-z./\d]+)?\s*(\d+)$')
    data['TicketCategory'] = enc.fit_transform(data['TicketCategory'])
    data['TicketNumber'] = data['TicketNumber'].astype(float)
    data = one_hot(data, ['Deck'], drop_col=True)
    return data

if __name__ == '__main__':
    train_data = pd.read_csv('../datasets/titanic/train.csv')
    test_data = pd.read_csv('../datasets/titanic/test.csv')
    train_data = encode_data(train_data)
    test_data  = encode_data(test_data)
    print(train_data.head())
    print(train_data.info())
    print(train_data['TicketNumber'].head())

    # train_data['Deck'] = enc.fit_transform(train_data['Deck'])

    decks = [col for col in test_data.columns if col.startswith('Deck_')]
    train_cols = ['SibSp', 'Sex', 'Parch', 'Fare', 'Pclass', 'Embarked', 'TicketCategory', 'TicketNumber', 'Cabin_Cat', 'Room']
    train_cols.extend(decks)
    X = train_data[train_cols]
    y = train_data['Survived']

    x_train, x_test, y_train, y_test = train_test_split(X, y, test_size=0.3, random_state=42)
    # tree = DecisionTreeClassifier('information', max_depth=10, min_sample_split=3)
    # tree.fit(x_train, y_train)
    # tree.fit(X, y['Survived'])

    # x_test = titanic_test_data[train_cols]
    # res = tree.predict(x_test)
    # print(accuracy_score(y_test, res))

    x_train = X
    y_train = y
    x_test = test_data[train_cols]

    m = XGBClassifier(n_estimators=100)
    m.fit(x_train, y_train)
    res = m.predict(x_test)
    # print(accuracy_score(y_test, res))


    # rf = RandomForestClassifier(n_estimators=100)
    # rf.fit(x_train, y_train)
    # res = rf.predict(x_test)
    # print(accuracy_score(y_test, res))

    output = pd.DataFrame({
        'PassengerId': test_data['PassengerId'],
        'Survived': res
    })

    print(output.head())
    print(output['Survived'].value_counts())
    output.reset_index()
    output.to_csv('submission.csv', index=False)