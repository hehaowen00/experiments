#include <stdlib.h>

struct rope {
  char *data;
  size_t len;
  size_t cap;
  struct rope *left;
  struct rope *right;
};

struct rope* newRope(struct rope *left, struct rope *right) {
  return NULL;
}

// need to be able to get the piece of text from the rope
// for a very long single line,
// an average file
// a very big file with multiple lines
