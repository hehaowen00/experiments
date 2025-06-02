#include "dbviewer.h"
#include "connectiondialog.h"
#include "sqlproxymodel.h"
#include "ui_dbviewer.h"

#include <QDir>
#include <QFile>
#include <QMessageBox>
#include <QTimer>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlTableModel>
#include <QSqlQuery>
#include <QSqlRecord>
#include <QSqlIndex>

DBViewer::DBViewer(QWidget *parent)
    : QWidget(parent)
    , ui(new Ui::DBViewer)
{
    ui->setupUi(this);

    conns = new QVector<DatabaseConnection>();
    loadSettings();

    ui->tableView->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeMode::ResizeToContents);

    auto sp = ui->tabWidget->sizePolicy();
    sp.setRetainSizeWhenHidden(true);

    ui->dataViewWidget->hide();
    ui->tabWidget->setSizePolicy(sp);
    ui->tabWidget->setCurrentIndex(1);
    ui->tabWidget->hide();
    ui->databasesList->setVisible(false);

    setWindowTitle(QString("Database GUI"));
    showMaximized();
    disableUI();

    QFont headerFont;
    headerFont.setPointSize(13);

    ui->tableView->horizontalHeader()->setFont(headerFont);
    ui->tableView->verticalHeader()->setFont(headerFont);
    ui->queryTableView->horizontalHeader()->setFont(headerFont);
    ui->queryTableView->verticalHeader()->setFont(headerFont);

    connect(ui->addButton, SIGNAL(clicked(bool)), this, SLOT(addConnection(bool)));
    connect(ui->tablesList, SIGNAL(currentTextChanged(QString)), this, SLOT(loadTable(QString)));
    connect(ui->databasesList, SIGNAL(currentTextChanged(QString)), this, SLOT(loadTables(QString)));
    connect(ui->connectionsList, SIGNAL(currentTextChanged(QString)), this, SLOT(loadDatabase(QString)));
    // connect(ui->runQueryButton, SIGNAL(clicked(bool)), this, SLOT(runQuery(bool)));
    connect(ui->saveButton, SIGNAL(clicked(bool)), this, SLOT(saveChanges(bool)));
    connect(ui->filterButton, SIGNAL(clicked(bool)), this, SLOT(applyFilter(bool)));
    connect(ui->tableView, SIGNAL(doubleClicked(QModelIndex)), this, SLOT(handleCellEdit(QModelIndex)));
    connect(ui->hideDataViewButton, SIGNAL(clicked(bool)), this, SLOT(hideDataView(bool)));
}

DBViewer::~DBViewer()
{
    delete ui;
}

void DBViewer::addConnection(bool)
{
    auto dlg = new ConnectionDialog(this);
    if (dlg->exec() == QDialog::Accepted) {
        auto state = dlg->getState();
        conns->push_back(state);
        saveSettings();
        ui->connectionsList->addItem(state.Name);
    }
}


void DBViewer::loadDatabase(QString connection)
{
    if (dbOpen) {
        db.close();
        if (m) {
            m->deleteLater();
            m = nullptr;
        }
        if (temp) {
            temp->deleteLater();
            temp = nullptr;
        }
        dbOpen = false;
    }

    QTimer::singleShot(100, this, [this, connection]() {
        if (ui->connectionsList->currentIndex() == 0 && connection == "Select Connection") {
            ui->tablesList->clear();
            ui->tableView->setModel(nullptr);
            ui->saveButton->setEnabled(false);
            ui->discardButton->setEnabled(false);
            return;
        }

        for (auto it = conns->begin(); it != conns->end(); ++it) {
            if (it->Name != connection) {
                continue;
            }
            ui->tablesList->clear();
            ui->databasesList->clear();

            if (it->Driver == "SQLite") {
                db = QSqlDatabase::addDatabase("QSQLITE");
                db.setDatabaseName(it->Path);
                if (!db.open()) {
                    auto err = db.lastError().text();
                    qDebug() << err;

                    QMessageBox msg;
                    msg.setText(db.lastError().text());
                    msg.exec();
                    return;
                }
                dbOpen = true;
                driver = it->Driver;
                ui->databasesList->hide();

                auto tables = db.tables(QSql::Tables);
                tables.sort();

                for (const QString& table: tables) {
                    ui->tablesList->addItem(table);
                }

                loadTable(tables.first());
            } else if (it->Driver == "PostgreSQL") {
                db = QSqlDatabase::addDatabase("QPSQL");
                db.setHostName(it->Host);
                db.setUserName(it->Username);
                db.setPassword(it->Password);
                db.setDatabaseName("postgres");
                db.setPort(it->Port.toInt());

                if (!db.open()) {
                    auto err = db.lastError().text();
                    qDebug() << err;

                    QMessageBox msg;
                    msg.setText(err);
                    msg.exec();
                    return;
                }
                ui->databasesList->show();

                QSqlQuery query(db);
                ui->databasesList->addItem("Select Database");
                if (query.exec("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname ASC")) {
                    while (query.next()) {
                        QString dbName = query.value(0).toString();
                        ui->databasesList->addItem(dbName);
                    }
                } else {
                    QMessageBox msg;
                    msg.setText(query.lastError().text());
                    msg.exec();
                }

                driver = it->Driver;
            }

            if (!isEnabled) {
                enableUI();
            }

            break;
        }
    });
}


void DBViewer::loadTables(QString currentTextChanged)
{
    if (ui->databasesList->currentIndex() == 0) {
        return;
    }

    db.setDatabaseName(currentTextChanged);
    db.open();

    auto tables = db.tables(QSql::Tables);
    tables.sort();

    ui->tablesList->clear();
    for (const QString& table: tables) {
        ui->tablesList->addItem(table);
    }
}

void DBViewer::loadTable(QString currentTextChanged)
{
    ui->tabWidget->show();
    ui->filterInput->setText("");
    ui->tabWidget->setCurrentIndex(1);
    auto filterText = ui->filterInput->text();

    QTimer::singleShot(100, [this, currentTextChanged, filterText]() {
        auto dataQueryString = QString("SELECT ");

        QSqlQuery q(db);
        q.exec(QString("SELECT * FROM %1 LIMIT 1").arg(currentTextChanged));

        if (q.next()) {
            QSqlRecord rec = q.record();

            for (int i = 0; i < rec.count(); ++i) {
                QString colName = rec.fieldName(i);
                QVariant value = q.value(i);

                auto testing = QString(value.metaType().name());
                auto vByteArray = QString("QByteArray");
                auto vString = QString("QString");
                bool testByteA = (testing == vByteArray);
                bool testString = (testing == vString);

                if (testString)
                {
                    auto testQuery = QString("SELECT AVG(length(%1)) FROM ( SELECT cast(%1 AS text) as %1 FROM %2 WHERE %1 IS NOT NULL LIMIT 10 ) AS tmp").arg(colName, currentTextChanged);
                    QSqlQuery tempQ(db);
                    tempQ.prepare(testQuery);

                    bool sizeLimitReached = false;
                    if (tempQ.exec(testQuery) && tempQ.next()) {
                        double avgLength = tempQ.value(0).toDouble();
                        sizeLimitReached = avgLength > 1024;
                    } else {
                        auto err = tempQ.lastError().text();
                        if (err != "") {
                            return;
                        }

                        QMessageBox msg;
                        msg.setText(err);
                        msg.exec();
                        return;
                    }
                    tempQ.clear();

                    if (sizeLimitReached) {
                        dataQueryString.append(QString("'[BLOB]' as %1").arg(colName));
                        if (i < rec.count() -1) {
                            dataQueryString.append(",");
                        }
                    } else {
                        dataQueryString.append(colName);
                        if (i < rec.count() -1) {
                            dataQueryString.append(",");
                        }
                    }
                } else if (testByteA) {
                    auto testQuery = QString("SELECT AVG(length(%1)) FROM ( SELECT cast(%1 AS text) as %1 FROM %2 WHERE %1 IS NOT NULL LIMIT 10 ) AS tmp").arg(colName, currentTextChanged);
                    QSqlQuery tempQ(db);
                    bool sizeLimitReached = false;
                    if (tempQ.exec(testQuery) && tempQ.next()) {
                        double avgLength = tempQ.value(0).toDouble();
                        sizeLimitReached = avgLength > 1024;
                    } else {
                        auto err = tempQ.lastError().text();
                        if (err != "") {
                            return;
                        }

                        QMessageBox msg;
                        msg.setText(err);
                        msg.exec();
                        return;
                    }
                    tempQ.clear();

                    if (sizeLimitReached) {
                        dataQueryString.append(QString("'[BLOB]' as %1").arg(colName));
                        if (i < rec.count() -1) {
                            dataQueryString.append(",");
                        }
                    } else {
                        dataQueryString.append(colName);
                        if (i < rec.count() -1) {
                            dataQueryString.append(",");
                        }
                    }
                } else {
                    dataQueryString.append(colName);
                    if (i < rec.count() -1) {
                        dataQueryString.append(",");
                    }
                }
                dataQueryString.append(" ");
            }
        }

        dataQueryString.append(QString(" FROM %1").arg(currentTextChanged));

        QSqlQuery query = QSqlQuery(db);

        int rowCount = 0;
        QString sql = QString("SELECT COUNT(*) FROM \"%1\"").arg(currentTextChanged);
        if (query.exec(sql) && query.next()) {
            rowCount = query.value(0).toInt();
            ui->rowCountLabel->setText(QString("%1 Rows").arg(rowCount));
        }
        auto v = query.lastError();

        qDebug() << dataQueryString;
        m = new QSqlTableModel(this, db);
        m->setQuery(dataQueryString);
        m->setFilter(filterText);
        m->select();
        m->setEditStrategy(QSqlTableModel::OnManualSubmit);

        connect(m, SIGNAL(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)), this, SLOT(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)));

        SQLProxyModel *p = new SQLProxyModel(this);
        p->setSourceModel(m);

        ui->tableView->setSortingEnabled(true);
        ui->tableView->setModel(p);
        ui->tableView->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeMode::ResizeToContents);
        ui->saveButton->setEnabled(false);
        ui->discardButton->setEnabled(false);
    });
}

void DBViewer::dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)
{
    ui->saveButton->setEnabled(true);
    ui->discardButton->setEnabled(true);
}

void DBViewer::applyFilter(bool) {
    auto table = ui->tablesList->currentItem()->text();
    auto filterText = ui->filterInput->text();

    auto query = QSqlQuery(db);
    QString sql = QString("SELECT COUNT(*) FROM \"%1\"").arg(table);
    if (filterText != "") {
        sql.append("WHERE ");
        sql.append(filterText);
    }

    int rowCount = 0;
    if (query.exec(sql) && query.next()) {
        rowCount = query.value(0).toInt();
        ui->rowCountLabel->setText(QString("%1 Rows").arg(rowCount));
    }

    m = new QSqlTableModel(this, db);
    m->setTable(table);
    m->setFilter(filterText);
    m->select();
    m->setEditStrategy(QSqlTableModel::OnManualSubmit);

    if (rowCount < 5000) {
        while (m->canFetchMore()) m->fetchMore();
    }

    connect(m, SIGNAL(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)), this, SLOT(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)));

    SQLProxyModel *p = new SQLProxyModel(this);
    p->setSourceModel(m);

    ui->tableView->setSortingEnabled(true);
    ui->tableView->setModel(p);
    ui->tableView->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeMode::ResizeToContents);
    ui->saveButton->setEnabled(false);
    ui->discardButton->setEnabled(false);
}

void DBViewer::saveChanges(bool)
{
    ui->saveButton->setEnabled(false);
    ui->discardButton->setEnabled(false);
    m->submitAll();
}

void DBViewer::discardChanges(bool)
{
    ui->saveButton->setEnabled(false);
    ui->discardButton->setEnabled(false);
    m->revertAll();
}

void DBViewer::disableUI() {
    ui->filterInput->setEnabled(false);
    ui->filterButton->setEnabled(false);
    ui->tabWidget->setEnabled(false);
}

void DBViewer::enableUI() {
    ui->filterInput->setEnabled(true);
    ui->filterButton->setEnabled(true);
    ui->tabWidget->setEnabled(true);
    ui->saveButton->setEnabled(false);
    ui->discardButton->setEnabled(false);
}


void DBViewer::loadSettings()
{
    qDebug() << "loading connections settings";

    QString dirPath = QDir::homePath() + "/.database-app";
    QDir dir;

    if (!dir.exists(dirPath)) {
        dir.mkpath(dirPath);
    }

    if (QFile::exists(dirPath + "/connections.json")) {
    }

    QString filePath = QDir::homePath() + "/.database-app/connections.json";
    QFile file(filePath);

    if (file.open(QIODevice::ReadOnly)) {
        QByteArray jsonData = file.readAll();
        file.close();

        QJsonDocument doc = QJsonDocument::fromJson(jsonData);
        conns = deserializeConnections(doc);
    }

    for (auto it = conns->begin(); it != conns->end(); ++it)
    {
        qDebug() << it->Name;
        auto name = QString(it->Name);
        ui->connectionsList->addItem(name);
    }
}

void DBViewer::saveSettings()
{
    QString dirPath = QDir::homePath() + "/.database-app";
    QDir dir;

    if (!dir.exists(dirPath)) {
        dir.mkpath(dirPath);
    }

    QJsonDocument doc = serializeConnections(*conns);

    QFile file(dirPath + "/connections.json");
    if (file.open(QIODevice::WriteOnly)) {
        file.write(doc.toJson(QJsonDocument::Indented));
        file.close();
    }
}

void DBViewer::handleCellEdit(QModelIndex index)
{
    if (!index.isValid()) return;

    ui->dataViewWidget->show();

    QString colName = m->headerData(index.column(), Qt::Horizontal).toString();
    int rowId = m->data(m->index(index.row(), 0)).toInt();

    auto data = m->data(index, Qt::DisplayRole).toString();
    if (QString::compare(data, "[BLOB]") != 0) {
        ui->dataViewTable->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOn);
        ui->dataViewTable->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOn);
        ui->dataViewTable->document()->setPlainText(data);
        ui->dataViewTable->update();
        ui->dataViewTable->setFocus();
        ui->dataViewTable->selectAll();
        return;
    }

    auto pk2 = db.primaryIndex(ui->tablesList->currentItem()->text());
    for (int i = 0; i < pk2.count(); ++i)
    {
        qDebug() << pk2.fieldName(i);
    }

    auto row = index.row();
    QVariantMap primaryKeyValues;

    for (int i = 0; i < pk2.count(); ++i)
    {
        QString pkName = pk2.fieldName(i);
        int colIndex = m->record().indexOf(pkName);
        if (colIndex != -1)
        {
            QVariant value = m->data(m->index(row, colIndex));
            primaryKeyValues[pkName] = value;
        }
        else
        {
            qDebug() << "Primary key column" << pkName << "not found in model";
        }
    }

    auto lookupQuery = QString("SELECT %1 FROM %2 WHERE ").arg(colName, ui->tablesList->currentItem()->text());
    auto count = 0;
    for (auto it = primaryKeyValues.begin(); it != primaryKeyValues.end(); ++it)
    {
        ++count;

        QString condition;
        if (it.value().isNull())
        {
            condition = QString("%1 IS NULL").arg(it.key());
        }
        else if (it.value().type() == QVariant::String ||
                 it.value().type() == QVariant::DateTime ||
                 it.value().type() == QVariant::Date)
        {
            condition = QString("%1 = '%2'").arg(it.key(), it.value().toString().replace("'", "''"));
        }
        else
        {
            condition = QString("%1 = %2").arg(it.key()).arg(it.value().toString());
        }

        lookupQuery.append(condition);

        if (count == primaryKeyValues.count()) {
            break;
        }

        lookupQuery.append(" AND ");
    }

    qDebug() << lookupQuery;
    QSqlQuery q(db);
    q.prepare(lookupQuery);
    q.bindValue(":id", rowId);
    if (q.exec() && q.next()) {
        QByteArray blobData = q.value(0).toByteArray();
        auto data = QString(blobData);
        ui->dataViewTable->document()->setPlainText(data);
        ui->dataViewTable->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOn);
        ui->dataViewTable->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOn);
        ui->dataViewTable->update();
        ui->dataViewTable->setFocus();
        ui->dataViewTable->selectAll();
    } else {
        QMessageBox msg;
        msg.setText(q.lastError().text());
        msg.exec();
    }
}

void DBViewer::hideDataView(bool) {
    ui->dataViewWidget->hide();
}
