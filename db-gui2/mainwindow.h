#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QSqlDatabase>
#include <QSql>
#include <QSqlTableModel>
#include "connectiondialog.h"

QT_BEGIN_NAMESPACE
namespace Ui {
class MainWindow;
}
QT_END_NAMESPACE

class MainWindow : public QMainWindow
{
    Q_OBJECT

public:
    MainWindow(QWidget *parent = nullptr);
    ~MainWindow();

private slots:
    void loadTable(QString);
    void quit();
    void addConnection(bool);
    void loadDatabase(QString);
    void loadTables(QString);
    void applyFilter(bool);
    void runQuery(bool);
    void dataChanged(const QModelIndex&, const QModelIndex&, QList<int>);
    void saveChanges(bool);
    void discardChanges(bool);

private:
    void disableUI();
    void enableUI();

    Ui::MainWindow *ui;
    Ui::MainWindow *dialog;

    QSqlDatabase db;
    QStringList tables;
    QSqlTableModel *m = nullptr;
    QVector<DatabaseConnection> *conns;

    bool dbOpen = false;
    bool isEnabled = false;
    QString driver;
};

#endif // MAINWINDOW_H
