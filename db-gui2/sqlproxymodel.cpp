#include "sqlproxymodel.h"
#include <QDebug>
#include <QFont>
#include <QColor>
#include <QBrush>


SQLProxyModel::SQLProxyModel(QObject *parent)
    : QSortFilterProxyModel(parent)
{
}

void SQLProxyModel::setMaxSize(int size)
{
    maxSize = size;
}

QVariant SQLProxyModel::data(const QModelIndex &index, int role) const
{
    QVariant value = QSortFilterProxyModel::data(index, role);

    if (role == Qt::DisplayRole && (value.type() == QVariant::String || value.type() == QVariant::ByteArray)) {
        QString strValue = value.toString();
        if (strValue.size() >= maxSize) {
            return QString("[BLOB]");
        }
        if (strValue == QString("[BLOB]")) {
        }
    }

    if (role == Qt::FontRole) {
        QVariant value = sourceModel()->data(mapToSource(index), Qt::DisplayRole);
        if (value.toString().size() >= maxSize) {
            QFont italicFont;
            italicFont.setItalic(true);
            return italicFont;
        }
        if (value.toString() == QString("[BLOB]")) {
            QFont italicFont;
            italicFont.setItalic(true);
            return italicFont;
        }
    }

    if (role == Qt::ForegroundRole) {
        QVariant dataValue = QSortFilterProxyModel::data(index, Qt::DisplayRole);
        if (dataValue.toString() == QString("[BLOB]")) {
            return QBrush(QColor(152, 161, 174));  // faded gray
        }
        if (dataValue.toString().length() >= maxSize) {
            return QBrush(QColor(152, 161, 174));  // faded gray
        }
    }

    return value;
}

bool SQLProxyModel::canFetchMore(const QModelIndex &parent) const
{
    if (!sourceModel())
        return false;

    return sourceModel()->canFetchMore(mapToSource(parent));
}

void SQLProxyModel::fetchMore(const QModelIndex &parent)
{
    if (!sourceModel())
        return;

    sourceModel()->fetchMore(mapToSource(parent));
}
