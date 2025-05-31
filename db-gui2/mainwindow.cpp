#include "mainwindow.h"
#include "ui_mainwindow.h"
#include <QFileDialog>
#include <QSqlDatabase>
#include <QSqlTableModel>
#include <QSqlQuery>
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

    connect(ui->addButton, SIGNAL(clicked(bool)), this, SLOT(addConnection(bool)));
    connect(ui->comboBox, SIGNAL(currentTextChanged(QString)), this, SLOT(loadTable(QString)));
}

void MainWindow::addConnection(bool) {
    auto dlg = new ConnectionDialog(this);
    if (dlg->exec() == QDialog::Accepted) {
        auto state = dlg->getState();
        qDebug() << state.Driver << state.Name << state.Path << state.Host;
        this->conns->push_back(state);
    }
}

void MainWindow::showOpenDB() {
    if (this->m != nullptr) {
        this->m->clear();
        this->db.close();
    }

    QString fileName = QFileDialog::getOpenFileName(
        this,
        tr("Open SQLite Database"),
        QDir().homePath(),
        tr("SQLite Databases (*.db *.sqlite);;All Files (*)")
    );

    this->setWindowTitle(QString("Database GUI: " + fileName));

    if (!fileName.isEmpty()) {
        ui->comboBox->clear();

        qDebug() << "Selected file:" << fileName;
        this->db = QSqlDatabase::addDatabase("QSQLITE");
        db.setDatabaseName(fileName);
        db.open();

        auto tables = db.tables(QSql::AllTables);
        tables.sort();
        qDebug() << "tables" << tables;

        for (const QString& table: tables) {
            ui->comboBox->addItem(table);
        }

        this->loadTable(tables.first());
    }}

void MainWindow::loadTable(QString currentTextChanged) {
    qDebug() << "load table" << currentTextChanged;

    QSqlQuery query = QSqlQuery(this->db);

    QString sql = QString("SELECT COUNT(*) FROM \"%1\"").arg(currentTextChanged);
    if (query.exec(sql) && query.next()) {
        query.value(0).toInt();
        ui->label->setText(QString("%1 Rows").arg(query.value(0).toInt()));
    }

    QSqlTableModel *m = new QSqlTableModel(this, this->db);
    m->setTable(currentTextChanged);
    m->select();

    SQLProxyModel *p = new SQLProxyModel(this);
    p->setSourceModel(m);

    ui->tableView->setModel(p);
    ui->tableView->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeMode::ResizeToContents);
}

void MainWindow::quit() {
}

MainWindow::~MainWindow() {
    if (this->db.isOpen()) {
        this->db.close();
    }
    delete ui;
}
