from sklearn.ensemble import VotingClassifier, RandomForestClassifier
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
from sklearn.preprocessing import LabelEncoder
# from tree import DecisionTreeClassifier
# from forest import RandomForestClassifier
from xgboost import XGBClassifier
from sklearn.linear_model import LogisticRegression


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

def get_title(name):
    if "." in name:
        return name.split(",")[1].split(".")[0].strip()
    else:
        return "Unknown"

def title_map(title):
    if title in ["Mr"]:
        return 1
    elif title in ["Master"]:
        return 3
    elif title in ["Ms", "Mlle", "Miss"]:
        return 4
    elif title in ["Mme","Mrs"]:
        return 5
    else:
        return 2

def encode_data(data, save=False):
    enc = LabelEncoder()
    data['NameLength'] = data['Name'].apply(lambda n: len(n))
    data['FamilySize'] = data['SibSp'] + data['Parch']
    data['Title'] = data['Name'].apply(lambda n: n.split(',')[1].split('.')[0].strip())
    data['Age'] = data['Age'].fillna(
        data.groupby('Title')['Age'].transform('mean')
    )
    data["title"] = data["Name"].apply(get_title).apply(title_map)
    data['FareTest'] = data['Fare'] > data['Fare'].mean()
    data['FamilyName'] = data['Name'].apply(lambda n: n.split(',')[0])
    data['CabinCat'] = data['Cabin'].apply(lambda x: str(x)[0])
    data["Deck"] = data["Cabin"].str.slice(0,1)
    data["Room"] = data["Cabin"].str.slice(1,5).str.extract("([0-9]+)", expand=False).astype("float")
    data["Room"] = data["Room"].fillna(0)
    data['IsChild'] = data['Age'] <= 14

    data[['TicketCategory', 'TicketNumber']] = data['Ticket'].str.extract(r'^(.*\D)?\s*(\d+)?$')
    data['TicketCategory'] = data['TicketCategory'].str.strip()
    data['TicketCategory'].replace('', np.nan, inplace=True)
    data['TicketNumber'].replace('', np.nan, inplace=True)
    data['TicketNumber'] = data['TicketNumber'].astype(float)

    data = one_hot(data, ['Sex'], drop_col=False)
    data = one_hot(data, ['Title'], drop_col=False)
    data = one_hot(data, ['Deck'], drop_col=True)
    data = one_hot(data, ['Embarked'], drop_col=True)

    if save:
        data.to_csv('parsed.csv')

    data['CabinCat'] = enc.fit_transform(data['CabinCat'])
    data['Title'] = enc.fit_transform(data['Title'])
    data['TicketCategory'] = enc.fit_transform(data['TicketCategory'])
    # data['Sex'] = enc.fit_transform(data['Sex'])
    data['Male'] = data['Sex'] == 'male'
    data['Female'] = data['Sex'] == 'female'
    # data['Embarked'] = enc.fit_transform(data['Embarked'])

    return data

if __name__ == '__main__':
    train_data = pd.read_csv('../datasets/titanic/train.csv')
    test_data = pd.read_csv('../datasets/titanic/test.csv')
    train_data = encode_data(train_data, save=True)
    test_data  = encode_data(test_data)

    # print(train_data.head())
    # print(train_data.info())
    # print(train_data['TicketNumber'].head())

    # print(train_data['Title'].head())
    # train_data['Deck'] = enc.fit_transform(train_data['Deck'])

    decks = [col for col in test_data.columns if col.startswith('Deck_')]
    titles = [col for col in test_data.columns if col.startswith('Title_')]
    titles.remove('Title_Dona')
    embarked = [col for col in test_data.columns if col.startswith('Embarked_')]
    # ages = [col for col in test_data.columns if col.startswith('Age_categories_')]

    train_cols = ['SibSp', 'Parch', 'Fare', 'Pclass', 'TicketCategory',
                   'TicketNumber', 'CabinCat', 'Room', 'Title', 'IsChild', 'FareTest', 'title', 'Male', 'Female',
    ]
    train_cols.extend(titles)
    train_cols.extend(decks)
    train_cols.extend(embarked)
    # train_cols.extend(ages)
    print(train_cols)
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
    # rf = RandomForestClassifier(n_estimators=100)
    # rf.fit(x_train, y_train)
    # res = rf.predict(x_test)
    # print(accuracy_score(y_test, res))

    # m = XGBClassifier(objective='binary:logistic', n_estimators=1500, learning_rate=0.44)
    xgb = XGBClassifier(use_label_encoder=False, eval_metric='logloss', n_estimators=1500, random_state=42)
    rf = RandomForestClassifier()
    # lr = LogisticRegression(max_iter=1000)
    # xgb.fit(X, y)
    # xgb.fit(x_train, y_train)

    # fi = xgb.get_booster().get_score(importance_type='gain')
    # print(fi)

    ensemble = VotingClassifier(
        estimators=[('xgb', xgb), ('rf', rf),],
        voting='hard',
    )
    ensemble.fit(x_train, y_train)

    x_test = test_data[train_cols]
    # res = xgb.predict(x_test)
    res = ensemble.predict(x_test)

    output = pd.DataFrame({
        'PassengerId': test_data['PassengerId'],
        'Survived': res,
    })

    test_data['Survived'] = pd.Series(res)
    test_data.to_csv('test.csv')

    solution = pd.read_csv('../datasets/titanic/solution.csv')
    print(solution['Survived'].value_counts())

    merged = output.merge(solution, on='PassengerId', suffixes=('_df1', '_df2'))
    diff_scores = merged[merged['Survived_df1'] != merged['Survived_df2']]
    diff_scores.to_csv('diff.csv')
    print((len(solution) - len(diff_scores)) / len(solution))

    print(output.head())
    print(output['Survived'].value_counts())
    output.reset_index()
    output.to_csv('submission.csv', index=False)