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
    this->maxSize = size;
}

QVariant SQLProxyModel::data(const QModelIndex &index, int role) const
{
    QVariant value = QSortFilterProxyModel::data(index, role);

    if (role == Qt::DisplayRole && (value.type() == QVariant::String || value.type() == QVariant::ByteArray)) {
        QString strValue = value.toString();
        if (strValue.size() >= this->maxSize) {
            return QString("[BLOB]");
        }
    }

    if (role == Qt::FontRole) {
        QVariant value = sourceModel()->data(mapToSource(index), Qt::DisplayRole);
        if (value.toString().size() >= this->maxSize) {
            QFont italicFont;
            italicFont.setItalic(true);
            return italicFont;
        }
    }

    if (role == Qt::ForegroundRole) {
        // QVariant displayValue = QSortFilterProxyModel::data(index, Qt::DisplayRole);
        // qDebug() << "is blob" << displayValue.toString();
        QVariant dataValue = QSortFilterProxyModel::data(index, Qt::DisplayRole);
        auto length = dataValue.toString().length();
        if (length >= this->maxSize) {
            return QBrush(QColor(150, 0, 0));
        }
    }

    return value;
}
