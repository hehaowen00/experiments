#include <SDL.h>
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    int x, y;
    int width, height;
    int velocity;
} Paddle;

typedef struct {
    int x, y;
    int radius;
    int dx, dy;
} Ball;

#define bool short
#define true 1
#define false 0

void draw_circle(SDL_Renderer *renderer, int x, int y, int radius) {
    int diameter = 2 * radius;
    for (int i = 0; i < diameter; i++) {
        for (int j = 0; j < diameter; j++) {
            int dx = i - radius;
            int dy = j - radius;

            if (dx * dx + dy * dy <= radius * radius) {
                SDL_RenderDrawPoint(renderer, x + dx, y + dy);
            }
        }
    }
}

int main(int argc, char *argv[]) {
    if (SDL_Init(SDL_INIT_VIDEO) < 0) {
        printf("SDL could not initialize! SDL_Error: %s\n", SDL_GetError());
        return -1;
    }

    SDL_Window *window = SDL_CreateWindow("Pong Game",
                                          SDL_WINDOWPOS_CENTERED,
                                          SDL_WINDOWPOS_CENTERED,
                                          800, 600,
                                          SDL_WINDOW_SHOWN);
    if (!window) {
        printf("Window could not be created! SDL_Error: %s\n", SDL_GetError());
        SDL_Quit();
        return -1;
    }

    SDL_Renderer *renderer = SDL_CreateRenderer(window, -1, SDL_RENDERER_ACCELERATED);
    if (!renderer) {
        printf("Renderer could not be created! SDL_Error: %s\n", SDL_GetError());
        SDL_DestroyWindow(window);
        SDL_Quit();
        return -1;
    }

    Paddle paddle = {700 - 50, 580 - 10, 100, 20, 0};
    Ball ball = {400, 300, 10, 2, 2};

    bool running = true;
    while (running) {
        SDL_Event event;

        while (SDL_PollEvent(&event)) {
            if (event.type == SDL_QUIT) {
                running = false;
            }
        }

        const Uint8 *keys = SDL_GetKeyboardState(NULL);
        if (keys[SDL_SCANCODE_LEFT]) {
            paddle.x -= 5;
            if (paddle.x < 0) paddle.x = 0;
        }

        if (keys[SDL_SCANCODE_RIGHT]) {
            paddle.x += 5;
            if (paddle.x + paddle.width > 800) paddle.x = 800 - paddle.width;
        }

        ball.x += ball.dx;
        ball.y += ball.dy;

        if (ball.y - ball.radius <= 0 || ball.y + ball.radius >= 600) {
            ball.dy = -ball.dy;
        }

        if (ball.x - ball.radius <= 0) {
            ball.x = 400;
            ball.y = 300;
            ball.dx = 2;
            ball.dy = 2;
        }

        if (ball.x + ball.radius >= paddle.x &&
            ball.x - ball.radius <= paddle.x + paddle.width &&
            ball.y + ball.radius >= paddle.y &&
            ball.y - ball.radius <= paddle.y + paddle.height) {
            ball.dx = -ball.dx;
            ball.dy = -ball.dy;
        }

        SDL_SetRenderDrawColor(renderer, 0, 0, 0, 255);
        SDL_RenderClear(renderer);

        SDL_SetRenderDrawColor(renderer, 255, 255, 255, 255);
        SDL_Rect paddle_rect = {paddle.x, paddle.y, paddle.width, paddle.height};
        SDL_RenderFillRect(renderer, &paddle_rect);

        draw_circle(renderer, ball.x, ball.y, ball.radius);

        SDL_RenderPresent(renderer);

        SDL_Delay(16);
    }

    SDL_DestroyRenderer(renderer);
    SDL_DestroyWindow(window);
    SDL_Quit();
    return 0;
}
