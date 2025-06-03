#ifndef MAINWINDOW_H
#define MAINWINDOW_H

#include <QMainWindow>
#include <QSqlDatabase>
#include <QSql>
#include <QSqlTableModel>

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
public slots:
    void newTab();
    void newTab2(int index);
    void tabMoved(int, int);
    void tabClose(int);
    void closeCurrentTab();

private:
    Ui::MainWindow *ui;
    Ui::MainWindow *dialog;
    int count = 0;
};

#endif // MAINWINDOW_H
