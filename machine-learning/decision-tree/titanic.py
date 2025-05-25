import pandas as pd
import numpy as np
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

def encode_data(data, save=False):
    enc = LabelEncoder()
    data['NameLength'] = data['Name'].apply(lambda n: len(n))
    data['FamilySize'] = data['SibSp'] + data['Parch']
    data['Title'] = data['Name'].apply(lambda n: n.split(',')[1].split('.')[0].strip())
    data['Age'] = data['Age'].fillna(
        data.groupby('Title')['Age'].transform('median')
    )
    data['FamilyName'] = data['Name'].apply(lambda n: n.split(',')[0])
    data['CabinCat'] = data['Cabin'].apply(lambda x: str(x)[0])
    data["Deck"] = data["Cabin"].str.slice(0,1)
    data["Room"] = data["Cabin"].str.slice(1,5).str.extract("([0-9]+)", expand=False).astype("float")
    data["Room"] = data["Room"].fillna(0)

    data[['TicketCategory', 'TicketNumber']] = data['Ticket'].str.extract(r'^(.*\D)?\s*(\d+)?$')
    data['TicketCategory'] = data['TicketCategory'].str.strip()
    data['TicketCategory'].replace('', np.nan, inplace=True)
    data['TicketNumber'].replace('', np.nan, inplace=True)
    data['TicketNumber'] = data['TicketNumber'].astype(float)

    data = one_hot(data, ['Deck'], drop_col=True)

    if save:
        data.to_csv('parsed.csv')

    data['CabinCat'] = enc.fit_transform(data['CabinCat'])
    data['Title'] = enc.fit_transform(data['Title'])
    data['TicketCategory'] = enc.fit_transform(data['TicketCategory'])
    data['Sex'] = enc.fit_transform(data['Sex'])
    data['Embarked'] = enc.fit_transform(data['Embarked'])

    return data

if __name__ == '__main__':
    train_data = pd.read_csv('../datasets/titanic/train.csv')
    test_data = pd.read_csv('../datasets/titanic/test.csv')
    train_data = encode_data(train_data, save=True)
    test_data  = encode_data(test_data)
    print(train_data.head())
    print(train_data.info())
    print(train_data['TicketNumber'].head())

    # print(train_data['Title'].head())
    # train_data['Deck'] = enc.fit_transform(train_data['Deck'])

    decks = [col for col in test_data.columns if col.startswith('Deck_')]
    train_cols = ['SibSp', 'Sex', 'Parch', 'Fare', 'Pclass', 'Embarked', 'TicketCategory', 'TicketNumber', 'CabinCat', 'Room', 'Title']
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

    # x_train = X
    # y_train = y
    # x_test = test_data[train_cols]

    # rf = RandomForestClassifier(n_estimators=100)
    # rf.fit(x_train, y_train)
    # res = rf.predict(x_test)
    # print(accuracy_score(y_test, res))

    m = XGBClassifier(n_estimators=1000)
    m.fit(x_train, y_train)
    res = m.predict(x_test)
    print(accuracy_score(y_test, res))
    print(pd.Series(res).value_counts())

    x_test = test_data[train_cols]
    res = m.predict(x_test)

    output = pd.DataFrame({
        'PassengerId': test_data['PassengerId'],
        'Survived': res,
    })

    print(output.head())
    print(output['Survived'].value_counts())
    output.reset_index()
    output.to_csv('submission.csv', index=False)