#ifndef UTILS_H
#define UTILS_H

#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>

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

QJsonDocument serializeConnections(const QVector<DatabaseConnection>& connections);
QVector<DatabaseConnection>* deserializeConnections(const QJsonDocument& doc);

#endif // UTILS_H
