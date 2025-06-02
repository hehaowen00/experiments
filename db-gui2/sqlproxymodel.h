#ifndef SQLPROXYMODEL_H
#define SQLPROXYMODEL_H

#include <QSortFilterProxyModel>

class SQLProxyModel: public QSortFilterProxyModel
{
public:
    explicit SQLProxyModel(QObject *parent = nullptr);
    void setMaxSize(int size);
    QVariant data(const QModelIndex &index, int role = Qt::DisplayRole) const override;
    bool canFetchMore(const QModelIndex &parent) const override;
    void fetchMore(const QModelIndex &parent) override;
private:
    int maxSize = 1024;
};

#endif // SQLPROXYMODEL_H
