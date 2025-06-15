from PyQt5 import QtCore
import PyQt5
from PyQt5.QtCore import Qt
from PyQt5.QtCore import QAbstractTableModel, QModelIndex, QObject, Qt
from PyQt5.QtWidgets import QApplication, QFileDialog, QHeaderView, QMenu, QMenuBar, QWidget, QHBoxLayout, QVBoxLayout, QComboBox, QTabBar, QTabWidget, QTableView
import sqlite3
import sys
import typing


import sqlite3
from PyQt5.QtCore import QAbstractTableModel, Qt, QModelIndex, QVariant

class LazySqlTableModel(QAbstractTableModel):
    def __init__(self, db_path, table_name, cache_size=100, parent=None):
        super().__init__(parent)
        self.db_path = db_path
        self.table_name = table_name
        self.cache_size = cache_size
        self.sort_column = "rowid"
        self.sort_order = "ASC"

        self.conn = sqlite3.connect(self.db_path)
        self.cursor = self.conn.cursor()

        # Get column names
        self.cursor.execute(f"PRAGMA table_info({self.table_name})")
        self.columns = [row[1] for row in self.cursor.fetchall()]

        # Get total row count
        self.cursor.execute(f"SELECT COUNT(*) FROM {self.table_name}")
        self._row_count = self.cursor.fetchone()[0]

        # Data cache: maps row number → row data tuple
        self.cache = {}
        self.cache_start = -1
        self.cache_end = -1

    def rowCount(self, parent=QModelIndex()):
        return self._row_count

    def columnCount(self, parent=QModelIndex()):
        return len(self.columns)

    def data(self, index, role=Qt.ItemDataRole.DisplayRole):
        if not index.isValid() or role != Qt.ItemDataRole.DisplayRole:
            return QVariant()

        row = index.row()
        col = index.column()

        # Check if row is in cache
        if not (self.cache_start <= row < self.cache_end):
            self._populate_cache_around_row(row)

        value = self.cache.get(row, (None,) * self.columnCount())[col]
        return value if value is not None else QVariant()

    def _populate_cache_around_row(self, center_row):
        half_window = self.cache_size // 2
        start_row = max(0, center_row - half_window)
        end_row = min(self._row_count, start_row + self.cache_size)

        query = (
            f"SELECT * FROM {self.table_name} "
            f"ORDER BY {self.sort_column} {self.sort_order} "
            f"LIMIT {end_row - start_row} OFFSET {start_row}"
        )

        print(query)

        self.cursor.execute(query)
        rows = self.cursor.fetchall()

        # Update cache
        self.cache.clear()
        for i, row_data in enumerate(rows):
            self.cache[start_row + i] = row_data

        self.cache_start = start_row
        self.cache_end = end_row

    def headerData(self, section, orientation, role=Qt.ItemDataRole.DisplayRole):
        if role != Qt.ItemDataRole.DisplayRole:
            return QVariant()

        if orientation == Qt.Orientation.Horizontal:
            return self.columns[section]
        else:
            return section + 1

    def sort(self, column, order):
        self.layoutAboutToBeChanged.emit()

        self.sort_column = self.columns[column]
        self.sort_order = "ASC" if order == Qt.SortOrder.AscendingOrder else "DESC"

        # Clear cache because sort order changed
        self.cache.clear()
        self.cache_start = -1
        self.cache_end = -1

        self.layoutChanged.emit()

    def flags(self, index):
        if not index.isValid():
            return Qt.ItemFlag.NoItemFlags
        return Qt.ItemFlag.ItemIsEnabled | Qt.ItemFlag.ItemIsSelectable

    def close(self):
        self.conn.close()

class DataModel(QAbstractTableModel):
    def __init__(self, data, headerData) -> None:
        super().__init__()
        self._data = data
        self._headerData = headerData

    def headerData(self, section: int, orientation: Qt.Orientation, role: int = ...) -> typing.Any:
        if role == Qt.ItemDataRole.DisplayRole:
            if orientation == Qt.Orientation.Horizontal:
                return self._headerData[section]

    def data(self, index: QModelIndex, role) -> typing.Any:
        if role == Qt.ItemDataRole.DisplayRole:
            return self._data[index.row()][index.column()]

    def rowCount(self, index):
        return len(self._data)

    def columnCount(self, index):
        if len(self._data) == 0:
            return 0

        return len(self._data[0])

db_path_curr = ''

def get_sqlite_tables(db_path):
    global db_path_curr
    db_path_curr = db_path

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [row[0] for row in cursor.fetchall()]
    conn.close()

    return sorted(tables)


app = QApplication(sys.argv)

layout = QVBoxLayout()

menu = QMenuBar()

cb = QComboBox()

table = QTableView()
m = DataModel([], [])
table.setModel(m)
dataTabLayout = QVBoxLayout()
dataTabLayout.addWidget(cb)

dataTabLayout.addWidget(table)
dataTab = QWidget()
dataTab.setLayout(dataTabLayout)
dataTab.show()

tabs = QTabWidget()
tabs.addTab(QWidget(), 'Metadata')
tabs.addTab(dataTab, 'Data')
tabs.addTab(QWidget(), 'Editor')
tabs.setCurrentIndex(1)

layout.addWidget(menu)
layout.addWidget(tabs)

window = QWidget()
window.setLayout(layout)
window.setWindowTitle('DB GUI')
window.showMaximized()
window.show()

def open_dlg():
    dlg = QFileDialog()
    # dlg.setAcceptMode(QFileDialog.AcceptMode.AcceptSave)
    dlg.setViewMode(QFileDialog.ViewMode.Detail)
    files = dlg.getOpenFileName()
    tables = get_sqlite_tables(files[0])
    for f in tables:
        cb.addItem(f)

m2 = menu.addMenu('File')
act = m2.addAction('Open')
act.triggered.connect(open_dlg)

def get_table_data(db_path, tbl):
    global table
    # conn = sqlite3.connect(db_path)
    # cursor = conn.cursor()
    # cursor.execute("SELECT * FROM " + tbl+ " ORDER BY rowid")
    # column_names = [description[0] for description in cursor.description]
    # print(column_names)
    # data = cursor.fetchall()
    # table.setModel(DataModel(data, column_names))
    table.setModel(LazySqlTableModel(db_path, tbl))
    table.setSortingEnabled(True)
    table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)

def table_changed(e):
    get_table_data(db_path_curr, e)

cb.currentTextChanged.connect(table_changed)

if __name__ == '__main__':
    app.exec()
