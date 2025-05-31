#include "sqlproxymodel.h"
#include <QDebug>

SQLProxyModel::SQLProxyModel(QObject *parent)
    : QSortFilterProxyModel(parent)
{
}

void SQLProxyModel::setMaxSize(int size)
{
    this->maxSize = size;
}

QVariant SQLProxyModel::data(const QModelIndex &index, int role) const
{
    QVariant value = QSortFilterProxyModel::data(index, role);

    if (role == Qt::DisplayRole && (value.type() == QVariant::String || value.type() == QVariant::ByteArray)) {
        QString strValue = value.toString();
        if (strValue.size() >= this->maxSize) {
            // return QString("[Data: %1 kb]").arg(strValue.size()/1024);
            return QString("[BLOB]");
        }
    }

    return value;
}
