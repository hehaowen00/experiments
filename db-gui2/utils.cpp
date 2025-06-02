#include "utils.h"

QJsonDocument serializeConnections(const QVector<DatabaseConnection>& connections) {
    QJsonArray array;

    for (const auto& conn : connections) {
        QJsonObject obj;
        obj["Driver"]   = conn.Driver;
        obj["Name"]     = conn.Name;
        obj["Path"]     = conn.Path;
        obj["Host"]     = conn.Host;
        obj["Port"]     = conn.Port;
        obj["Username"] = conn.Username;
        obj["Password"] = conn.Password;
        obj["Database"] = conn.Database;

        array.append(obj);
    }

    QJsonDocument doc(array);
    return doc;
}

QVector<DatabaseConnection>* deserializeConnections(const QJsonDocument& doc) {
    auto connections = new QVector<DatabaseConnection>();

    if (!doc.isArray())
        return connections;

    QJsonArray array = doc.array();
    for (auto it = array.begin(); it != array.end(); ++it)
    {
        auto value = it;
        if (!value->isObject())
            continue;

        QJsonObject obj = value->toObject();
        DatabaseConnection conn;
        conn.Driver   = obj.value("Driver").toString();
        conn.Name     = obj.value("Name").toString();
        conn.Path     = obj.value("Path").toString();
        conn.Host     = obj.value("Host").toString();
        conn.Port     = obj.value("Port").toString();
        conn.Username = obj.value("Username").toString();
        conn.Password = obj.value("Password").toString();
        conn.Database = obj.value("Database").toString();

        connections->append(conn);
    }

    return connections;
}
