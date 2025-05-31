#include "connectiondialog.h"
#include "ui_connection_dialog.h"
#include <QDialog>
#include <QObject>
#include <QDir>
#include<QFileDialog>

ConnectionDialog::ConnectionDialog(QWidget *parent)
    : QDialog(parent)
    , ui(new Ui::ConnectionDialog)
{
    ui->setupUi(this);
    this->setWindowTitle("Add New Connection");
    this->adjustSize();
    connect(ui->driverInput, SIGNAL(currentTextChanged(QString)), this, SLOT(driverChanged(QString)));
    connect(ui->openDBButton, SIGNAL(clicked(bool)), this, SLOT(openSQLiteDB(bool)));
    connect(ui->saveButton, SIGNAL(clicked(bool)), this, SLOT(saveState(bool)));
    connect(ui->cancelBtn, SIGNAL(clicked(bool)), this, SLOT(cancel(bool)));
}

void ConnectionDialog::driverChanged(QString currentTextChanged) {
    if (currentTextChanged == "PostgreSQL") {
        ui->dbWidget->setEnabled(true);
        ui->fileWidget->setEnabled(false);
    } else {
        ui->dbWidget->setEnabled(false);
        ui->fileWidget->setEnabled(true);
    }
}

bool ConnectionDialog::cancelled() {
    return this->isCancelled;
}

void ConnectionDialog::openSQLiteDB(bool) {
    QString filepath = QFileDialog::getOpenFileName(
        this,
        tr("Open SQLite Database"),
        QDir().homePath(),
        tr("SQLite Databases (*.db *.sqlite);;All Files (*)")
    );

    ui->pathInput->setText(filepath);
}

void ConnectionDialog::saveState(bool) {
    if (ui->nameInput->text().trimmed().length() == 0 ||
        (ui->hostInput->text().trimmed().length() == 0 &&
        ui->pathInput->text().trimmed().length() == 0))
    {
        return;
    }
    this->accept();
}

void ConnectionDialog::cancel(bool) {
    this->reject();
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
