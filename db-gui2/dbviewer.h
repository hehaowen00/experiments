#ifndef DBVIEWER_H
#define DBVIEWER_H

#include "sqlproxymodel.h"
#include "utils.h"

#include <QSqlDatabase>
#include <QSqlTableModel>
#include <QWidget>

namespace Ui {
class DBViewer;
}

class DBViewer : public QWidget
{
    Q_OBJECT

public:
    explicit DBViewer(QWidget *parent = nullptr);
    ~DBViewer();

    QString name;

private slots:
    void addConnection(bool);
    void loadDatabase(QString);
    void loadTables(QString);
    void loadTable(QString);
    void applyFilter(bool);
    // void runQuery(bool);
    void dataChanged(const QModelIndex&, const QModelIndex&, QList<int>);
    void saveChanges(bool);
    void discardChanges(bool);
    void handleCellEdit(QModelIndex);
    void hideDataView(bool);
    void submitFilter();

private:
    Ui::DBViewer *ui;

    void disableUI();
    void enableUI();

    void loadSettings();
    void saveSettings();

    QStringList tables;
    QSqlTableModel *m = nullptr;
    SQLProxyModel *proxy = nullptr;
    QVector<DatabaseConnection> *conns;
    DatabaseConnection currentConn;

    bool dbOpen = false;
    bool isEnabled = false;
};

#endif // DBVIEWER_H
