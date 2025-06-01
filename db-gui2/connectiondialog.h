#ifndef CONNECTION_DIALOG_H
#define CONNECTION_DIALOG_H

#include <QDialog>

struct DatabaseConnection {
    QString Driver;
    QString Name;
    QString Path;
    QString Host;
    QString Port;
    QString Username;
    QString Password;
    QString Database;
};

namespace Ui {
class ConnectionDialog;
};

class ConnectionDialog : public QDialog
{
    Q_OBJECT

public:
    ConnectionDialog(QWidget *parent = nullptr);
    ~ConnectionDialog();

    DatabaseConnection getState();

public slots:
    void driverChanged(QString);
    void openSQLiteDB(bool);
    void testConn(bool);
    void saveState(bool);
    void cancel(bool);

private:
    Ui::ConnectionDialog *ui;
};

#endif // CONNECTION_DIALOG_H
