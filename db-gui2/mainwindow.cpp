#include "mainwindow.h"
#include "ui_mainwindow.h"
#include <QFileDialog>
#include <QSqlDatabase>
#include <QSqlTableModel>
#include <QSqlQuery>
#include <QAbstractItemModel>
#include "sqlproxymodel.h"
#include "connectiondialog.h"

using namespace std;

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , ui(new Ui::MainWindow)
{
    ui->setupUi(this);
    ui->tableView->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeMode::ResizeToContents);

    this->conns = new QVector<DatabaseConnection>();
    this->setWindowTitle(QString("Database GUI"));
    this->showMaximized();
    this->disableUI();
    ui->tabWidget->setCurrentIndex(1);
    ui->databasesList->setVisible(false);

    QFont headerFont;
    headerFont.setPointSize(13);
    ui->tableView->horizontalHeader()->setFont(headerFont);
    ui->tableView->verticalHeader()->setFont(headerFont);

    connect(ui->addButton, SIGNAL(clicked(bool)), this, SLOT(addConnection(bool)));
    connect(ui->tablesList, SIGNAL(currentTextChanged(QString)), this, SLOT(loadTable(QString)));
    connect(ui->databasesList, SIGNAL(currentTextChanged(QString)), this, SLOT(loadTables(QString)));
    connect(ui->connectionsList, SIGNAL(currentTextChanged(QString)), this, SLOT(loadDatabase(QString)));
    connect(ui->runQueryButton, SIGNAL(clicked(bool)), this, SLOT(runQuery(bool)));
    connect(ui->saveButton, SIGNAL(clicked(bool)), this, SLOT(saveChanges(bool)));
    connect(ui->filterButton, SIGNAL(clicked(bool)), this, SLOT(applyFilter(bool)));
}

void MainWindow::addConnection(bool)
{
    auto dlg = new ConnectionDialog(this);
    if (dlg->exec() == QDialog::Accepted) {
        auto state = dlg->getState();
        // qDebug() << state.Driver << state.Name << state.Path << state.Host;
        this->conns->push_back(state);
        ui->connectionsList->addItem(state.Name);
    }
}

void MainWindow::loadDatabase(QString connection)
{
    if (this->dbOpen) {
        this->db.close();
    }

    if (ui->connectionsList->currentIndex() == 0 && connection == "Select Connection") {
        // ui->tableList->clear();
        ui->tablesList->clear();
        ui->tableView->setModel(nullptr);
        ui->saveButton->setEnabled(false);
        ui->discardButton->setEnabled(false);
        return;
    }

    for (auto it = this->conns->begin(); it != this->conns->end(); ++it) {
        if (it->Name != connection) {
            continue;
        }

        // qDebug() << "loading db" << it->Driver << it->Path;

        if (it->Driver == "SQLite") {
            // qDebug() << 1;
            db = QSqlDatabase::addDatabase("QSQLITE");
            db.setDatabaseName(it->Path);
            db.open();
            // qDebug() << 2;
            this->dbOpen = true;
            this->driver = it->Driver;
            ui->databasesList->hide();

            auto tables = db.tables(QSql::Tables);
            tables.sort();

            // ui->tableList->clear();
            ui->tablesList->clear();
            for (const QString& table: tables) {
                // ui->tableList->addItem(table);
                ui->tablesList->addItem(table);
            }

            this->loadTable(tables.first());
        } else if (it->Driver == "PostgreSQL") {
            // auto drivers = QSqlDatabase::drivers();

            // for (const QString & driver: drivers) {
            //     qDebug() << driver;
            // }

            db = QSqlDatabase::addDatabase("QPSQL");
            db.setHostName(it->Host);
            db.setUserName(it->Username);
            db.setPassword(it->Password);
            db.setPort(it->Port.toInt());
            if (!db.open()) {
            }
            ui->databasesList->show();

            QSqlQuery query(db);
            if (query.exec("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname ASC")) {
                while (query.next()) {
                    QString dbName = query.value(0).toString();
                    ui->tablesList->addItem(dbName);
                }
            } else {
            }

            this->driver = it->Driver;
        }

        if (!this->isEnabled) {
            this->enableUI();
        }

        break;
    }
}

void MainWindow::loadTables(QString currentTextChanged)
{
    db.setDatabaseName(currentTextChanged);
    db.open();

    auto tables = db.tables(QSql::Tables);
    tables.sort();

    ui->tablesList->clear();
    for (const QString& table: tables) {
        ui->tablesList->addItem(table);
    }
    // this->loadTable(tables.first());
}

void MainWindow::loadTable(QString currentTextChanged)
{
    // qDebug() << "load table" << currentTextChanged;

    QSqlQuery query = QSqlQuery(this->db);

    auto filterText = ui->filterInput->text();
    int rowCount = 0;
    QString sql = QString("SELECT COUNT(*) FROM \"%1\"").arg(currentTextChanged);
    if (filterText != "") {
        sql.append("WHERE ");
        sql.append(filterText);
    }
    if (query.exec(sql) && query.next()) {
        rowCount = query.value(0).toInt();
        ui->rowCountLabel->setText(QString("%1 Rows").arg(rowCount));
    }

    m = new QSqlTableModel(this, this->db);
    m->setTable(currentTextChanged);
    m->setFilter(filterText);
    m->select();
    m->setEditStrategy(QSqlTableModel::OnManualSubmit);

    if (rowCount < 5000) {
        while (m->canFetchMore()) m->fetchMore();
    }

    connect(this->m, SIGNAL(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)), this, SLOT(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)));

    SQLProxyModel *p = new SQLProxyModel(this);
    p->setSourceModel(m);

    ui->tableView->setSortingEnabled(true);
    ui->tableView->setModel(p);
    ui->tableView->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeMode::ResizeToContents);
    ui->saveButton->setEnabled(false);
    ui->discardButton->setEnabled(false);
}

void MainWindow::dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)
{
    ui->saveButton->setEnabled(true);
    ui->discardButton->setEnabled(true);
}

void MainWindow::runQuery(bool)
{
    auto text = ui->queryEditor->toPlainText();

    QString countQueryStr = QString("SELECT COUNT(*) FROM (%1) AS subquery").arg(text);
    QSqlQuery countQuery(db);
    int rowCount;
    if (countQuery.exec(countQueryStr)) {
        if (countQuery.next()) {
            rowCount = countQuery.value(0).toInt();
        }
    }

    QSqlQuery query(db);
    query.exec(text);

    QSqlTableModel *m = new QSqlTableModel(this, this->db);
    m->setQuery(std::move(query));
    m->select();

    while (m->canFetchMore()) m->fetchMore();

    SQLProxyModel *p = new SQLProxyModel(this);
    p->setSourceModel(m);

    ui->queryTableView->setSortingEnabled(true);
    ui->queryTableView->setModel(p);
    ui->queryTableView->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeMode::ResizeToContents);
    ui->queryRowCountLabel->setText(QString("%1 Rows").arg(rowCount));
}

void MainWindow::applyFilter(bool) {
    auto table = ui->tablesList->currentItem()->text();
    auto filterText = ui->filterInput->text();

    QSqlQuery query = QSqlQuery(this->db);

    int rowCount = 0;
    QString sql = QString("SELECT COUNT(*) FROM \"%1\"").arg(table);
    if (filterText != "") {
        sql.append("WHERE ");
        sql.append(filterText);
    }
    if (query.exec(sql) && query.next()) {
        rowCount = query.value(0).toInt();
        ui->rowCountLabel->setText(QString("%1 Rows").arg(rowCount));
    }

    m = new QSqlTableModel(this, this->db);
    m->setTable(table);
    m->setFilter(filterText);
    m->select();
    m->setEditStrategy(QSqlTableModel::OnManualSubmit);

    if (rowCount < 5000) {
        while (m->canFetchMore()) m->fetchMore();
    }

    connect(this->m, SIGNAL(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)), this, SLOT(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)));

    SQLProxyModel *p = new SQLProxyModel(this);
    p->setSourceModel(m);

    ui->tableView->setSortingEnabled(true);
    ui->tableView->setModel(p);
    ui->tableView->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeMode::ResizeToContents);
    ui->saveButton->setEnabled(false);
    ui->discardButton->setEnabled(false);
}

void MainWindow::saveChanges(bool)
{
    this->m->submitAll();
}

void MainWindow::disableUI() {
    // ui->tablesList->setEnabled(false);
    ui->filterInput->setEnabled(false);
    ui->filterButton->setEnabled(false);
    ui->tabWidget->setEnabled(false);
}

void MainWindow::enableUI() {
    // ui->tablesList->setEnabled(true);
    ui->filterInput->setEnabled(true);
    ui->filterButton->setEnabled(true);
    ui->tabWidget->setEnabled(true);
    ui->saveButton->setEnabled(false);
    ui->discardButton->setEnabled(false);
}

void MainWindow::quit()
{
}

MainWindow::~MainWindow()
{
    if (this->db.isOpen()) {
        this->db.close();
    }
    delete ui;
}
