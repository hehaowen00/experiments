#ifndef DBVIEWER_H
#define DBVIEWER_H

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

private:
    Ui::DBViewer *ui;

    void disableUI();
    void enableUI();

    void loadSettings();
    void saveSettings();

    QSqlDatabase db;
    QStringList tables;
    QSqlTableModel *m = nullptr, *temp = nullptr;
    QVector<DatabaseConnection> *conns;

    bool dbOpen = false;
    bool isEnabled = false;
    QString driver;
};

#endif // DBVIEWER_H
