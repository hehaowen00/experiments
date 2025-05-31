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
    void showOpenDB();
    void quit();
    void addConnection(bool);

private:
    Ui::MainWindow *ui;
    Ui::MainWindow *dialog;

    QSqlDatabase db;
    QStringList tables;
    QSqlTableModel *m = nullptr;
    QVector<DatabaseConnection> *conns;
};

#endif // MAINWINDOW_H
