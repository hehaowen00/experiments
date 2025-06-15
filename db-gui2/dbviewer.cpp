#include "dbviewer.h"
#include "querytab.h"
#include "connectiondialog.h"
#include "sqlproxymodel.h"
#include "ui_dbviewer.h"
#include "metadataview.h"

#include <QDir>
#include <QFile>
#include <QMessageBox>
#include <QTimer>
#include <QListWidgetItem>
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
    auto metadata = new MetadataView(this);
    ui->information->layout()->addWidget(metadata);

    setWindowTitle(QString("Database GUI"));
    showMaximized();
    disableUI();

    // QFont headerFont;
    // headerFont.setPointSize(13);

    // ui->tableView->horizontalHeader()->setFont(headerFont);
    // ui->tableView->verticalHeader()->setFont(headerFont);

    auto queryTab = new QueryTab(this);
    ui->consoleTabWidget->addTab(queryTab, "SQL 1");

    connect(ui->addButton, SIGNAL(clicked(bool)), this, SLOT(addConnection(bool)));
    connect(ui->tablesList, SIGNAL(itemClicked(QListWidgetItem*)), this, SLOT(loadTable(QListWidgetItem*)));
    connect(ui->databasesList, SIGNAL(currentTextChanged(QString)), this, SLOT(loadTables(QString)));
    connect(ui->connectionsList, SIGNAL(currentTextChanged(QString)), this, SLOT(loadDatabase(QString)));
    connect(ui->saveButton, SIGNAL(clicked(bool)), this, SLOT(saveChanges(bool)));
    connect(ui->filterButton, SIGNAL(clicked(bool)), this, SLOT(applyFilter(bool)));
    connect(ui->tableView, SIGNAL(doubleClicked(QModelIndex)), this, SLOT(handleCellEdit(QModelIndex)));
    connect(ui->hideDataViewButton, SIGNAL(clicked(bool)), this, SLOT(hideDataView(bool)));
    connect(ui->filterInput, SIGNAL(returnPressed()), this, SLOT(submitFilter()));
}

DBViewer::~DBViewer()
{
    QSqlDatabase::database(name + "_table_conn").close();
    QSqlDatabase::removeDatabase(name + "_table_conn");
    ui->tableView->setModel(nullptr);
    conns->clear();
    free(conns);
    delete ui;
}

void DBViewer::submitFilter() {
    applyFilter(true);
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
    if (ui->connectionsList->currentIndex() == 0 && connection == "Select Connection") {
        ui->tablesList->clear();
        ui->tableView->setModel(nullptr);
        ui->saveButton->setEnabled(false);
        ui->discardButton->setEnabled(false);
        ui->tablesList->clear();
        ui->databasesList->clear();
        return;
    }

    QTimer::singleShot(50, [this, connection]() {
        ui->dataViewWidget->hide();
        ui->filterInput->setText("");
        ui->tabWidget->hide();
        ui->tablesList->clear();
        ui->tabWidget->show();

        for (auto it = conns->begin(); it != conns->end(); ++it) {
            auto test = (QString("[%2] %1").arg(it->Name, it->Driver));
            if (test != connection) {
                continue;
            }

            if (it->Driver == "SQLite") {
                auto db = QSqlDatabase::addDatabase("QSQLITE", name);
                db.setDatabaseName(it->Path);

                if (!db.open()) {
                    // ui->connectionsList->setCurrentIndex(lastConnection);

                    // auto err = db.lastError().text();
                    // qDebug() << err;

                    QMessageBox msg;
                    msg.setText(db.lastError().text());
                    msg.exec();
                    return;
                }
                dbOpen = true;
                ui->databasesList->hide();

                auto tables = db.tables(QSql::Tables);
                tables.sort();

                for (const QString& table: tables) {
                    ui->tablesList->addItem(table);
                }
            } else if (it->Driver == "PostgreSQL") {
                auto db = QSqlDatabase::addDatabase("QPSQL", name);
                db.setHostName(it->Host);
                db.setUserName(it->Username);
                db.setPassword(it->Password);
                db.setDatabaseName("postgres");
                db.setPort(it->Port.toInt());

                if (!db.open()) {
                    // ui->connectionsList->setCurrentIndex(lastConnection);

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
                query.finish();
            }

            if (!isEnabled) {
                enableUI();
            }

            QWidget *parentWidget = this->parentWidget();
            while (parentWidget && !qobject_cast<QTabWidget*>(parentWidget)) {
                parentWidget = parentWidget->parentWidget();
            }

            QTabWidget *tabWidget = qobject_cast<QTabWidget*>(parentWidget);
            if (tabWidget) {
                int index = tabWidget->indexOf(this);
                if (index != -1) {
                    tabWidget->setTabText(index, it->Name);
                }
            }

            currentConn.Driver= it->Driver;
            currentConn.Name = it->Name;

            if (currentConn.Driver == "SQLite") {
                currentConn.Path= it->Path;
            } else if (currentConn.Driver == "PostgreSQL") {
                currentConn.Username = it->Username;
                currentConn.Password = it->Password;
                currentConn.Host = it->Host;
                currentConn.Port= it->Port;
                currentConn.Database= it->Database;
            }

            break;
        }
    });
}


void DBViewer::loadTables(QString currentTextChanged)
{
    QTimer::singleShot(50, [this, currentTextChanged]() {
        // ui->dataViewWidget->hide();
        ui->tablesList->clear();

        if (ui->databasesList->currentIndex() == 0) {
            return;
        }

        auto db = QSqlDatabase::database(name);
        db.setDatabaseName(currentTextChanged);
        db.open();

        auto tables = db.tables(QSql::Tables);
        tables.sort();

        ui->tablesList->clear();
        for (const QString& table: tables) {
            ui->tablesList->addItem(table);
        }
    });
}

void DBViewer::loadTable(QListWidgetItem *item)
{
    QTimer::singleShot(100, [this, item]() {
        auto currentTextChanged = item->text();
        qDebug() << "current text changed load table" << currentTextChanged << ui->tablesList->currentIndex().row();
        ui->dataViewWidget->hide();
        ui->tableView->scrollToTop();
        ui->tabWidget->show();
        ui->filterInput->setText("");
        ui->tabWidget->setCurrentIndex(1);

        if (currentTextChanged == "") {
            return;
        }

        auto filterText = ui->filterInput->text();

        QSqlDatabase db;
        qDebug() << currentConn.Driver;
        if (currentConn.Driver == "SQLite") {
            db = QSqlDatabase::addDatabase("QSQLITE");
            db.setDatabaseName(currentConn.Path);
        } else if (currentConn.Driver != "") {
            db = QSqlDatabase::addDatabase("QPSQL");
            db.setHostName(currentConn.Host);
            db.setUserName(currentConn.Username);
            db.setPassword(currentConn.Password);
            db.setDatabaseName(ui->databasesList->currentText());
            db.setPort(currentConn.Port.toInt());
        } else {
            qDebug() << "unknown driver" << currentConn.Driver;
            return;
        }

        if (!db.open()) {
            qDebug() << db.lastError().text();
        }

        auto dataQueryString = QString("SELECT ");

        QSqlQuery q(db);
        q.exec(QString("SELECT * FROM %1 LIMIT 1").arg(currentTextChanged));

        if (q.next()) {
            QSqlRecord rec = q.record();

            qDebug() << "db viewer name" << this->name;
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
        q.finish();

        QSqlQuery query = QSqlQuery(db);

        int rowCount = 0;
        QString sql = QString("SELECT COUNT(*) FROM \"%1\"").arg(currentTextChanged);
        if (query.exec(sql) && query.next()) {
            rowCount = query.value(0).toInt();
            ui->rowCountLabel->setText(QString("%1 Rows").arg(rowCount));
        }

        auto v = query.lastError().text();
        qDebug() << v;
        query.finish();
        qDebug() << dataQueryString;

        // QSqlDatabase::removeDatabase(name + "tabconn 2");
        QSqlDatabase db0;
        if (currentConn.Driver == "SQLite") {
            db0 = QSqlDatabase::addDatabase("QSQLITE", name + "_table_conn");
            db0.setDatabaseName(currentConn.Path);
            db0.open();
        } else {
            db0 = QSqlDatabase::addDatabase("QPSQL", name + "_table_conn");
            db0.setHostName(currentConn.Host);
            db0.setUserName(currentConn.Username);
            db0.setPassword(currentConn.Password);
            db0.setDatabaseName(ui->databasesList->currentText());
            db0.setPort(currentConn.Port.toInt());
            db0.open();
        }

        m = new QSqlTableModel(this, db0);
        m->setQuery(dataQueryString);
        m->setFilter(filterText);
        m->select();
        m->setEditStrategy(QSqlTableModel::OnManualSubmit);

        connect(m, SIGNAL(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)), this, SLOT(dataChanged(const QModelIndex&, const QModelIndex&, QList<int>)));

        proxy = new SQLProxyModel(this);
        proxy->setSourceModel(m);

        ui->tableView->setSortingEnabled(true);
        ui->tableView->setModel(proxy);
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

    auto temp = QSqlDatabase::database(name);
    auto query = QSqlQuery(temp);
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

    QSqlDatabase db;
    if (currentConn.Driver == "SQLite") {
        db = QSqlDatabase::addDatabase("QSQLITE", name + "_table_conn");
        db.setDatabaseName(currentConn.Path);
        db.open();
    } else {
        db = QSqlDatabase::addDatabase("QPSQL", name + "_table_conn");
        db.setHostName(currentConn.Host);
        db.setUserName(currentConn.Username);
        db.setPassword(currentConn.Password);
        db.setDatabaseName(ui->databasesList->currentText());
        db.setPort(currentConn.Port.toInt());
        db.open();
    }
    m = new QSqlTableModel(this, db);
    m->setTable(table);
    m->setFilter(filterText);
    m->select();
    m->setEditStrategy(QSqlTableModel::OnManualSubmit);

    // while (m->canFetchMore()) m->fetchMore();

    proxy = new SQLProxyModel(this);
    proxy->setSourceModel(m);

    ui->tableView->setSortingEnabled(true);
    ui->tableView->setModel(proxy);
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

    std::sort(conns->begin(), conns->end(), [](const DatabaseConnection &a, const DatabaseConnection &b) {
        if (a.Driver == b.Driver) {
            return a.Name < b.Name;
        }
        return a.Driver < b.Driver;
    });

    for (auto it = conns->begin(); it != conns->end(); ++it)
    {
        ui->connectionsList->addItem(QString("[%2] %1").arg(it->Name, it->Driver));
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

    QModelIndex sourceIndex = proxy->mapToSource(index);
    int row = sourceIndex.row();

    QAbstractItemModel *sourceModel = proxy->sourceModel();
    QVariant data = sourceModel->data(sourceModel->index(row, index.column()));

    QString colName = m->headerData(index.column(), Qt::Horizontal).toString();
    int rowId = m->data(m->index(index.row(), 0)).toInt();

    if (data.toString() != "[BLOB]") {
        ui->dataViewTable->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOn);
        ui->dataViewTable->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOn);
        ui->dataViewTable->document()->setPlainText(data.toString());
        ui->dataViewTable->update();
        ui->dataViewTable->setFocus();
        ui->dataViewTable->selectAll();
        return;
    }

    auto db = QSqlDatabase::database(name + "_table_conn");
    auto pk2 = db.primaryIndex(ui->tablesList->currentItem()->text());

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
        }
    }

    if (primaryKeyValues.empty()) {
        QMessageBox msg;
        msg.setText("Unable to fetch data: missing primary key index");
        msg.exec();
        return;
    }

    auto lookupQuery = QString("SELECT %1 FROM %2 WHERE ").arg(colName, ui->tablesList->currentItem()->text());
    auto count = 0;
    for (auto it = primaryKeyValues.begin(); it != primaryKeyValues.end(); ++it)
    {
        ++count;
        qDebug() << it.key();

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
        qDebug() << lookupQuery;
        QMessageBox msg;
        msg.setText(q.lastError().text());
        msg.exec();
    }
}

void DBViewer::hideDataView(bool) {
    ui->dataViewWidget->hide();
}
