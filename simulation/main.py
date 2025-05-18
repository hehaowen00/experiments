import pygame
from enum import Enum
import random
from typing import List, Dict, Tuple


class Tile(Enum):
    GRASS = 1
    DIRT = 2
    TREE = 3
    ROAD = 4
    BUILDING = 5
    PASTURE = 6
    FARMLAND = 7


class Job:
    MINER = 1
    WOODCUTTER = 2
    CARPENTER = 3
    FARMER = 4
    CHEF = 5
    BUTCHER = 6
    SHOPKEEPER = 7
    MERCHANT = 8
    CHILD = 9
    BLACKSMITH = 10
    TAILOR = 11
    BANKER = 12
    POLICE_OFFICER = 13
    SOLDIER = 14
    GENERAL = 15
    FISHERMAN = 16


class Rect:
    def __init__(self, x, y, w, h) -> None:
        self.x = x
        self.y = y
        self.w = w
        self.h = h


class Circle:
    def __init__(self, x, y, r) -> None:
        self.x = x
        self.y = y
        self.r = r


class Shape:
    Rect
    Circle


class QuadTree:
    def __init__(self) -> None:
        pass

    def insert(self, shape):
        pass


class World:
    def __init__(self, width):
        self.size = width
        self.tiles = [[Tile.GRASS for _ in range(width)] for _ in range(width)]
        self.inventory = {"coal": 0, "iron": 0,
                          "copper": 0, "wheat": 0, "rice": 0, "beef": 0, "pork": 0,
                          "chicken": 0, "egg": 0,
                          }
        self.citizens = []
        self.workplaces = []
        self.delta = 0  # 0 - 24

    def add_person(self, gender, age, job):
        id = len(self.citizens)
        self.citizens.append({
            id: id,
            gender: gender,
            age: age,
            job: job,
        })

    def add_workplace(self, building: Tile):
        pass

    def place(self, x, y, building: Tile):
        self.tiles[x][y] = building

    def step(self):
        self.delta += 1
        self.delta = self.delta % 24

        if self.delta == 12 and self.delta == 17:
            for p in self.citizens:
                if p["job"] == Job.MINER:
                    self.inventory["coal"] += 5
                    self.inventory["iron"] += 5
                    self.inventory["copper"] += 5
                elif p["job"] == Job.FARMER:
                    self.inventory["wheat"] += 5
                    self.inventory["rice"] += 5
                    self.inventory["potato"] += 5
                    self.inventory["carrot"] += 5
                    self.inventory["lettuce"] += 5
                    self.inventory["spinach"] += 5
                    self.inventory["beef"] += 5
                    self.inventory["pork"] += 5
                    self.inventory["chicken"] += 5
                    self.inventory["egg"] += 5

        if self.delta == 12:
            for p in self.citizens:
                self.inventory["wheat"] -= 1
                self.inventory["rice"] -= 1
                self.inventory["potato"] -= 1
                self.inventory["carrot"] -= 1
                self.inventory["lettuce"] -= 1
                self.inventory["beef"] -= 1

    def disp(self):
        tile_symbols = {
            Tile.GRASS: ".",
            Tile.DIRT: ",",
            Tile.TREE: "T",
            Tile.ROAD: "#",
            Tile.BUILDING: "B",
            Tile.PASTURE: "P",
            Tile.FARMLAND: "F"
        }

        for y in range(self.size):
            row = []
            for x in range(self.size):
                row.append(tile_symbols[self.tiles[x][y]])
            print(" ".join(row))
        print("")

        for p in self.citizens:
            print(p)

        for p in self.inventory:
            print(p, self.inventory[p])


class Button:
    def __init__(self, x, y, width, height, color, text):
        self.rect = pygame.Rect(x, y, width, height)
        self.text = text
        self.is_hovered = False
        self.font = pygame.font.Font(None, 12)

    def draw(self):
        pass

    def check_hover(self):
        pass

    def check_clicked(self):
        pass


class Layout:
    def __init__(self):
        pass


class TextInput:
    def __init__(self):
        pass


if __name__ == "__main__":
    pygame.init()
    window = pygame.display.set_mode((1280, 720))

    while True:
        event = pygame.event.poll()
        if event.type == pygame.QUIT:
            break

        pygame.draw.rect(window, (0, 0, 255), (120, 120, 400, 120))
        pygame.display.update()

    pygame.quit()
