#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

#define CTRL_KEY(k) ((k) & 0x1f)
#define BUF_INIT {NULL, 0}

void die(const char * s) {
  write(STDOUT_FILENO, "\x1b[2J", 4);
  write(STDOUT_FILENO, "\x1b[H", 3);
  perror(s);
  exit(1);
}

struct buffer {
  char *b;
  int len;
};

void bufAppend(struct buffer *b, const char *s, int len) {
  char *new = realloc(b->b, b->len + len);

  if (new == NULL) return;
  memcpy(&new[b->len], s, len);
  b->b = new;
  b->len += len;
}

void bufFree(struct buffer *b) {
  free(b->b);
}

struct termios original;
int rows = 0;
int cols = 0;
int cx = 0;
int cy = 0;

void disableRawMode(void) {
  if (tcsetattr(STDIN_FILENO, TCSAFLUSH, &original) == -1) die("tcsetattr");
}

void enableRawMode(void) {
  if (tcgetattr(STDIN_FILENO, &original)) die("tcgetattr");
  atexit(disableRawMode);

  struct termios raw = original;
  raw.c_iflag &= ~(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
  raw.c_oflag &= ~(OPOST);
  raw.c_cflag |= (CS8);
  raw.c_lflag &= ~(ECHO | ICANON | IEXTEN | ISIG);
  raw.c_cc[VMIN] = 0;
  raw.c_cc[VTIME] = 1;

  if (tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw)) die("tcsetattr");
}

char readKey() {
  int nread;
  char c = '\0';

  while ((nread = read(STDIN_FILENO, &c, 1)) != 1) {
    if (nread == -1 && errno != EAGAIN) die("read");
  }

  return c;
}

int getCursorPosition(int *rows, int *cols) {
  char buf[32];
  unsigned int i = 0;

  if (write(STDOUT_FILENO, "\x1b[6n", 4) != 4) return -1;

  while (i < sizeof(buf) - 1) {
    if (read(STDIN_FILENO, &buf[i], 1) != 1) break;
    if (buf[i] == 'R') break;
    i++;
  }

  buf[i] = '\0';

  if (buf[0] != '\x1b' || buf[1] != '[') return -1;
  if (sscanf(&buf[2], "%d;%d", rows, cols) != 2) return -1;

  // printf("%d %d\n", *rows, *cols);

  readKey();

  return 0;
}

int getWindowSize(int *rows, int *cols) {
  struct winsize ws;

  if (ioctl(STDOUT_FILENO, TIOCGWINSZ, &ws) == -1 || ws.ws_col == 0) {
    if (write(STDOUT_FILENO, "\x1b[999C\x1b[999B", 12) != 12) return -1;
    return getCursorPosition(rows, cols);
  } else {
    *cols = ws.ws_col;
    *rows = ws.ws_row;
    // printf("%d %d\n", *rows, *cols);
    readKey();
    return 0;
  }
}

void processKeyPress(void) {
  char c = readKey();

  switch (c) {
    case CTRL_KEY('q'): // ctrl + q
      write(STDOUT_FILENO, "\x1b[2J", 4);
      write(STDOUT_FILENO, "\x1b[H", 3);
      exit(0);
      break;
    case 'h':
      if (cx) cx--;
      break;
    case 'j':
      if (cy != rows - 1) cy++;
      break;
    case 'k':
      if (cy) cy--;
      break;
    case 'l':
      if (cx != cols -1) cx++;
      break;
  }
}

void drawRows(struct buffer *b) {
  int y;

  for (y = 0; y < rows; y++) {
    // write(STDOUT_FILENO, "~", 1);
    bufAppend(b, "~", 1);
    bufAppend(b, "\x1b[K", 3);
    if (y < rows) {
      bufAppend(b, "\r\n", 2);
      // write(STDOUT_FILENO, "\r\n", 2);
    }
  }

  bufAppend(b, "STATUS BAR", 11);
}

void redrawStatusBar() {
  int currentX = cx;
  int currentY = cy;
  write(STDOUT_FILENO, "STATUS BAR", 11);
}

void clearScreen(void) {
  struct buffer b = BUF_INIT;

  bufAppend(&b, "\x1b[?25l", 6);
  // bufAppend(&b, "\x2b[2J", 4);
  bufAppend(&b, "\x1b[H", 3);

  drawRows(&b);

  char buf[32];
  snprintf(buf, sizeof(buf), "\x1b[%d;%dH", cy + 1, cx + 1);
  bufAppend(&b, buf, strlen(buf));

  // bufAppend(&b, "\x1b[H", 3);
  bufAppend(&b, "\x1b[?25h", 6);
  write(STDOUT_FILENO, b.b, b.len);
  bufFree(&b);

  // write(STDOUT_FILENO, "\x1b[2J", 4);
  // write(STDOUT_FILENO, "\x1b[H", 3);
  // drawRows();
  // write(STDOUT_FILENO, "\x1b[H", 3);
}

void init(void) {
  if (getWindowSize(&rows, &cols) == -1) die("getWindowSize");
}

int main(int argc, char** argv) {
  enableRawMode();
  write(STDOUT_FILENO, "\x1b[2J", 4);
  write(STDOUT_FILENO, "\x1b[H", 3);
  init();

  while (1) {
    clearScreen();
    processKeyPress();
  }

  return 0;
}
