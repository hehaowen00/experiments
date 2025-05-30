from PyQt5.QtWidgets import QApplication, QWidget
import sys

app = QApplication(sys.argv)

window = QWidget()
window.setWindowTitle('DB GUI')
window.showMaximized()
window.show()

if __name__ == '__main__':
    app.exec()
