#include "metadataview.h"
#include "ui_metadataview.h"

MetadataView::MetadataView(QWidget *parent)
    : QWidget(parent)
    , ui(new Ui::MetadataView)
{
    ui->setupUi(this);
}

MetadataView::~MetadataView()
{
    delete ui;
}
