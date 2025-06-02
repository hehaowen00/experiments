#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include "utils.h"

#include <QMainWindow>
#include <QSqlDatabase>
#include <QSql>
#include <QSqlTableModel>
#include "dbviewer.h"

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
    // void loadTable(QString);
    // void addConnection(bool);
    // void loadDatabase(QString);
    // void loadTables(QString);
    // void applyFilter(bool);
    // void runQuery(bool);
    // void dataChanged(const QModelIndex&, const QModelIndex&, QList<int>);
    // void saveChanges(bool);
    // void discardChanges(bool);
    // void handleCellEdit(QModelIndex);
    // void hideDataView(bool);
public slots:
    void newTab();
    void newTab2(int index);

private:
    // void disableUI();
    // void enableUI();

    // void loadSettings();
    // void saveSettings();

    Ui::MainWindow *ui;
    Ui::MainWindow *dialog;

    QSqlDatabase db;
    QStringList tables;
    QSqlTableModel *m = nullptr, *temp = nullptr;
    QVector<DatabaseConnection> *conns;

    bool dbOpen = false;
    bool isEnabled = false;
    QString driver;

    int count = 0;
};

#endif // MAINWINDOW_H
