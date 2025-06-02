QT       += core gui sql

greaterThan(QT_MAJOR_VERSION, 4): QT += widgets

CONFIG += c++17

# You can make your code fail to compile if it uses deprecated APIs.
# In order to do so, uncomment the following line.
# DEFINES += QT_DISABLE_DEPRECATED_BEFORE=0x060000    # disables all the APIs deprecated before Qt 6.0.0

SOURCES += \
    connectiondialog.cpp \
    dbviewer.cpp \
    main.cpp \
    mainwindow.cpp \
    metadataview.cpp \
    querytab.cpp \
    sqlproxymodel.cpp \
    utils.cpp

HEADERS += \
    connectiondialog.h \
    dbviewer.h \
    mainwindow.h \
    metadataview.h \
    querytab.h \
    sqlproxymodel.h \
    utils.h

FORMS += \
    connection_dialog.ui \
    dbviewer.ui \
    mainwindow.ui \
    metadataview.ui \
    querytab.ui \
    scratchpad.ui

# Default rules for deployment.
qnx: target.path = /tmp/$${TARGET}/bin
else: unix:!android: target.path = /opt/$${TARGET}/bin
!isEmpty(target.path): INSTALLS += target
