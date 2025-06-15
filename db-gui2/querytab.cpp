#include "querytab.h"
#include "ui_querytab.h"

#include <QSqlQuery>
#include <QSqlDatabase>
#include <QSqlError>
#include <QSqlTableModel>
#include <QPushButton>

QueryTab::QueryTab(QWidget *parent, QString name)
    : QWidget(parent)
    , ui(new Ui::QueryTab)
{
    ui->setupUi(this);

    // QFont headerFont;
    // headerFont.setPointSize(13);
    // ui->queryTableView->horizontalHeader()->setFont(headerFont);
    // ui->queryTableView->verticalHeader()->setFont(headerFont);
    ui->queryMessage->hide();

    connect(ui->runQueryButton, &QPushButton::clicked, this, &QueryTab::runQuery);
}

QueryTab::~QueryTab()
{
    delete ui;
}

void QueryTab::runQuery()
{
    auto db = QSqlDatabase::database(name, true);
    auto text = ui->queryEditor->document()->toPlainText();

    QSqlQuery q(text, db);
    if (!q.exec())
    {
        auto err = q.lastError().text();
        ui->queryMessage->document()->setPlainText(err);
        ui->queryMessage->show();
        return;
    }

    auto tm = new QSqlTableModel();
    tm->setQuery(std::move(q));
    while (tm->canFetchMore()) tm->fetchMore();

    ui->queryTableView->setModel(tm);
}
