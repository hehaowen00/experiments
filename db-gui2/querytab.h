#ifndef QUERYTAB_H
#define QUERYTAB_H

#include <QWidget>

namespace Ui {
class QueryTab;
}

class QueryTab : public QWidget
{
    Q_OBJECT

public:
    explicit QueryTab(QWidget *parent = nullptr, QString name = "");
    ~QueryTab();

private slots:
    void runQuery();

private:
    Ui::QueryTab *ui;
    QString name;
};

#endif // QUERYTAB_H
