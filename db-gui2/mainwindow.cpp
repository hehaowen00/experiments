#include "dbviewer.h"
#include "mainwindow.h"
#include "ui_mainwindow.h"

#include <QFileDialog>
#include <QSqlDatabase>
#include <QSqlTableModel>
#include <QSqlQuery>
#include <QAbstractItemModel>
#include <QSqlError>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QSqlRecord>
#include <QSqlField>
#include <QMessageBox>
#include <QSqlQueryModel>
#include <QTimer>
#include <QPlainTextDocumentLayout>
#include <QSqlIndex>
#include <QSqlResult>
#include <QToolButton>
#include <QTabBar>
#include <QLabel>

using namespace std;

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
{
    ui->setupUi(this);

    setWindowTitle(QString("Database GUI"));
    showMaximized();

    ui->tabWidget->removeTab(0);
    auto dbView = new DBViewer();
    dbView->name = QString("%1").arg(this->count);
    ui->tabWidget->addTab(dbView, "Untitled 1");
    ui->tabWidget->show();
    count = 1;

    // add new tab button
    QToolButton *tb = new QToolButton();
    tb->setText("+");
    ui->tabWidget->addTab(new QLabel(""), QString("+"));
    ui->tabWidget->tabBar()->setTabButton(1, QTabBar::LeftSide, nullptr);

    connect(ui->tabWidget->tabBar(), &QTabBar::tabMoved, this, &MainWindow::tabMoved);
    connect(ui->tabWidget->tabBar(), SIGNAL(&QTabBar::tabBarClicked(int)), this,  SLOT(newTab2(int)));
    connect(ui->tabWidget->tabBar(), &QTabBar::tabBarClicked, this, &MainWindow::newTab2);
    connect(ui->actionAdd_Connection, SIGNAL(triggered()), this, SLOT());
    connect(ui->actionNew_Tab, SIGNAL(triggered()), this, SLOT(newTab()));
    connect(ui->actionClose_Tab, SIGNAL(triggered()), this, SLOT(closeCurrentTab()));
    connect(ui->tabWidget, &QTabWidget::tabCloseRequested, this, &MainWindow::tabClose);
}

void MainWindow::newTab2(int index)
{
    qDebug() << "new tab 2" << index;
    if (index == ui->tabWidget->count() - 1) {
        this->newTab();
    }
}

MainWindow::~MainWindow()
{
    delete ui;
}

void MainWindow::newTab()
{
    count++;
    auto tabIndex = ui->tabWidget->count();
    auto dbView = new DBViewer(ui->tabWidget);
    dbView->name = QString("%1").arg(count);
    if (tabIndex == 0) {
        tabIndex = 0;
    } else {
        tabIndex -= 1;
    }
    int index = ui->tabWidget->insertTab(tabIndex, dbView, QString("Untitled %1").arg(count));
    ui->tabWidget->show();
    ui->tabWidget->setCurrentIndex(tabIndex);
}

void MainWindow::tabMoved(int from, int to)
{
    auto last = ui->tabWidget->count();
    if (from == last - 1 && to != last-1)
    {
        ui->tabWidget->tabBar()->moveTab(to, from);
    }
}

void MainWindow::tabClose(int index)
{
    ui->tabWidget->widget(index)->deleteLater();
    ui->tabWidget->removeTab(index);
    if (ui->tabWidget->count() > 1) {
        ui->tabWidget->setCurrentIndex(index-1);
    }
}


void MainWindow::closeCurrentTab()
{
    int index = ui->tabWidget->currentIndex();
    if (index == ui->tabWidget->count() - 1) {
        return;
    }
    ui->tabWidget->widget(index)->deleteLater();
    ui->tabWidget->removeTab(index);
    if (ui->tabWidget->count() > 1) {
        ui->tabWidget->setCurrentIndex(index-1);
    }
}
