CC = clang
FLAGS = -Wall -Werror
IFLAGS = -I/opt/homebrew/include/SDL2 
LFLAGS = -L/opt/homebrew/lib -lSDL2 
SRC = main.c
OBJ = pong

pong: main.c 
	$(CC) $(FLAGS) $(IFLAGS) $(LFLAGS) $(SRC) -o $(OBJ)

run: pong
	./pong
