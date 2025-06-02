#include "connectiondialog.h"
#include "ui_connection_dialog.h"

#include <QDialog>
#include <QDir>
#include <QFileDialog>
#include <QMessageBox>
#include <QObject>
#include <QSql>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlQuery>

ConnectionDialog::ConnectionDialog(QWidget *parent)
    : QDialog(parent)
    , ui(new Ui::ConnectionDialog)
{
    ui->setupUi(this);
    ui->testButton->setEnabled(false);

    setWindowTitle("Add New Connection");
    adjustSize();

    connect(ui->driverInput, SIGNAL(currentTextChanged(QString)), this, SLOT(driverChanged(QString)));
    connect(ui->openDBButton, SIGNAL(clicked(bool)), this, SLOT(openSQLiteDB(bool)));
    connect(ui->saveButton, SIGNAL(clicked(bool)), this, SLOT(saveState(bool)));
    connect(ui->cancelBtn, SIGNAL(clicked(bool)), this, SLOT(cancel(bool)));
    connect(ui->testButton, SIGNAL(clicked(bool)), this, SLOT(testConn(bool)));
}

void ConnectionDialog::driverChanged(QString currentTextChanged) {
    if (currentTextChanged == "PostgreSQL") {
        ui->dbWidget->setEnabled(true);
        ui->fileWidget->setEnabled(false);
        ui->databaseInput->setText("postgres");
        ui->testButton->setEnabled(true);
    } else {
        ui->dbWidget->setEnabled(false);
        ui->fileWidget->setEnabled(true);
        ui->testButton->setEnabled(false);
    }
}

void ConnectionDialog::openSQLiteDB(bool) {
    QString filepath = QFileDialog::getOpenFileName(
        this,
        tr("Open SQLite Database"),
        QDir().homePath(),
        tr("SQLite Databases (*.db *.sqlite);;All Files (*)")
    );

    QFileInfo fi = QFileInfo(filepath);
    if (ui->nameInput->text() == "") {
        ui->nameInput->setText(fi.fileName());
    }
    ui->pathInput->setText(filepath);
}

void ConnectionDialog::testConn(bool) {
    auto driver = ui->driverInput->currentText();

    if (driver == "PostgreSQL") {
        bool isNum;
        auto port = ui->portInput->text().toInt(&isNum);
        auto db = QSqlDatabase::addDatabase("QPSQL");
        db.setHostName(ui->hostInput->text());
        db.setPort(port);
        db.setDatabaseName(ui->databaseInput->text());
        db.setUserName(ui->usernameInput->text());
        db.setPassword(ui->passwordInput->text());

        if (!db.open()) {
            auto err = db.lastError().text();
            auto text = QString("Unable to open database: %1").arg(err);

            QMessageBox msg;
            msg.setText(text);
            msg.exec();
            db.close();
            return;
        }

        db.close();
    } else if (driver == "SQLite") {
        auto db = QSqlDatabase::addDatabase("QSQLITE");
        db = QSqlDatabase::addDatabase("QSQLITE");
        db.setDatabaseName(ui->pathInput->text());

        if (!db.open()) {
            auto err = db.lastError().text();
            auto text = QString("Unable to open database: %1").arg(err);

            QMessageBox msg;
            msg.setText(text);
            msg.exec();
            db.close();
            return;
        }

        db.close();
    }

    QMessageBox msg;
    msg.setText("Test successful.");
    msg.exec();
    return;
}

void ConnectionDialog::saveState(bool) {
    auto driver = ui->driverInput->currentText();

    bool nameCheck = ui->nameInput->text().trimmed().length() == 0;
    if (nameCheck) {
        QMessageBox msg;
        msg.setText("Name is required.");
        msg.exec();
        return;
    }

    bool isNum;
    ui->portInput->text().toInt(&isNum);

    if (driver != "SQLite" && !isNum) {
        QMessageBox msg;
        msg.setText("Port must be a valid number.");
        msg.exec();
        return;
    }

    bool check1 = ui->hostInput->text().trimmed().length() == 0 && ui->pathInput->text().trimmed().length() == 0;
    bool hostCheck = driver != "SQLite" && (ui->hostInput->text().trimmed().length() == 0);

    if (hostCheck || check1)
    {
        QMessageBox msg;
        msg.setText("Host, Port and Username are required.");
        msg.exec();
        return;
    }

    accept();
}

void ConnectionDialog::cancel(bool) {
    reject();
}

DatabaseConnection ConnectionDialog::getState() {
    return DatabaseConnection{
        .Driver = ui->driverInput->currentText(),
        .Name = ui->nameInput->text(),
        .Path = ui->pathInput->text(),
        .Host = ui->hostInput->text(),
        .Port = ui->portInput->text(),
        .Username = ui->usernameInput->text(),
        .Password = ui->passwordInput->text(),
        .Database = ui->databaseInput->text(),
    };
}

ConnectionDialog::~ConnectionDialog()
{
    delete ui;
}
