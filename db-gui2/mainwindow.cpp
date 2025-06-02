#include "connectiondialog.h"
#include "dbviewer.h"
#include "mainwindow.h"
#include "sqlproxymodel.h"
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

    QToolButton *tb = new QToolButton();
    tb->setText("+");
    // Add empty, not enabled tab to tabWidget
    ui->tabWidget->addTab(new QLabel(""), QString("+"));
    ui->tabWidget->setTabEnabled(1, false);
    // Add tab button to current tab. Button will be enabled, but tab -- not
    // ui->tabWidget->tabBar()->setTabButton(1, QTabBar::RightSide, tb);
    // ui->tabWidget->tabBar()->setTabsClosable(false);
    ui->tabWidget->tabBar()->setTabButton(1, QTabBar::LeftSide, nullptr);
    connect(ui->tabWidget->tabBar(), SIGNAL(&QTabBar::tabBarClicked()), this,  SLOT(newTab2(bool)));
    connect(ui->tabWidget->tabBar(), &QTabBar::tabBarClicked, this, &MainWindow::newTab2);
}

void MainWindow::newTab2(int index)
{
    qDebug() << index;
    if (index == -1) {
        this->newTab();
    }
}

MainWindow::~MainWindow()
{
    delete ui;
}

void MainWindow::newTab()
{
    auto tabIndex = ui->tabWidget->count();
    auto dbView = new DBViewer();
    dbView->name = QString("%1").arg(this->count);
    ui->tabWidget->insertTab(tabIndex - 1, dbView, QString("Untitled %1").arg(tabIndex));
    ui->tabWidget->show();
    ui->tabWidget->setCurrentIndex(tabIndex - 2);
}
