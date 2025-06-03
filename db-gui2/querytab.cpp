#include "querytab.h"
#include "ui_querytab.h"

QueryTab::QueryTab(QWidget *parent)
    : QWidget(parent)
    , ui(new Ui::QueryTab)
{
    ui->setupUi(this);

    QFont headerFont;
    headerFont.setPointSize(13);
    ui->queryTableView->horizontalHeader()->setFont(headerFont);
    ui->queryTableView->verticalHeader()->setFont(headerFont);
}

QueryTab::~QueryTab()
{
    delete ui;
}
