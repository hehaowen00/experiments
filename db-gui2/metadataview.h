#ifndef METADATAVIEW_H
#define METADATAVIEW_H

#include <QWidget>

namespace Ui {
class MetadataView;
}

class MetadataView : public QWidget
{
    Q_OBJECT

public:
    explicit MetadataView(QWidget *parent = nullptr);
    ~MetadataView();

private:
    Ui::MetadataView *ui;
};

#endif // METADATAVIEW_H
