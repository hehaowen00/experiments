#include "mainwindow.h"

#include <QApplication>

int main(int argc, char *argv[])
{
    qputenv("QT_MESSAGE_PATTERN", "[%{type}] %{file}:%{line} - %{function} -- %{message}\n");

    QApplication a(argc, argv);
    MainWindow w;
    w.show();
    return a.exec();
}
