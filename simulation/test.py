from enum import Enum
import random
from typing import List, Dict, Tuple

# Tile Types
class Tile(Enum):
    GRASS = 1
    DIRT = 2
    TREE = 3
    ROAD = 4
    BUILDING = 5
    PASTURE = 6
    FARMLAND = 7

# Job Types
class Job(Enum):
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

# Building Types
class BuildingType(Enum):
    HOUSE = 1
    FARM = 2
    MINE = 3
    WORKSHOP = 4
    MARKET = 5
    BARRACKS = 6

# Initialize world state
world_size = 10
tiles = [[Tile.GRASS for _ in range(world_size)] for _ in range(world_size)]
buildings = []
citizens = []
resources = {
    "food": 100,
    "wood": 50,
    "stone": 25,
    "gold": 10,
    "tools": 5
}
economy = {
    "currency_printed": 0,
    "gold_reserve": 100
}

# Helper functions
def display_world():
    """Render the world map with ASCII characters"""
    print("\nWorld Map:")
    tile_symbols = {
        Tile.GRASS: ".",
        Tile.DIRT: ",",
        Tile.TREE: "♣",
        Tile.ROAD: "#",
        Tile.BUILDING: "B",
        Tile.PASTURE: "≈",
        Tile.FARMLAND: "≡"
    }

    for y in range(world_size):
        row = []
        for x in range(world_size):
            row.append(tile_symbols[tiles[x][y]])
        print(" ".join(row))

def display_resources():
    """Show current resource counts"""
    print("\nResources:")
    for resource, amount in resources.items():
        print(f"{resource.capitalize()}: {amount}")

def display_citizens():
    """List all citizens"""
    print("\nCitizens:")
    if not citizens:
        print("No citizens yet!")
        return

    for i, citizen in enumerate(citizens, 1):
        job_name = Job(citizen["job"]).name.replace("_", " ").title()
        print(f"{i}. {citizen['name']} (Age: {citizen['age']}, Job: {job_name})")

def display_buildings():
    """List all buildings"""
    print("\nBuildings:")
    if not buildings:
        print("No buildings yet!")
        return

    for i, building in enumerate(buildings, 1):
        btype = BuildingType(building["type"]).name.title()
        print(f"{i}. {btype} at ({building['x']}, {building['y']})")

def place_building(x: int, y: int, building_type: BuildingType):
    """Place a building on the map"""
    if x < 0 or x >= world_size or y < 0 or y >= world_size:
        print("Invalid coordinates!")
        return False

    if tiles[x][y] != Tile.GRASS:
        print("Cannot build on this tile!")
        return False

    # Check building requirements
    if building_type == BuildingType.FARM and resources["wood"] < 5:
        print("Not enough wood to build a farm (needs 5)")
        return False
    elif building_type == BuildingType.MINE and resources["wood"] < 10:
        print("Not enough wood to build a mine (needs 10)")
        return False

    # Deduct resources
    if building_type == BuildingType.FARM:
        resources["wood"] -= 5
    elif building_type == BuildingType.MINE:
        resources["wood"] -= 10

    tiles[x][y] = Tile.BUILDING
    buildings.append({
        "type": building_type.value,
        "x": x,
        "y": y,
        "workers": []
    })
    print(f"{building_type.name.title()} built at ({x}, {y})")
    return True

def add_citizen(name: str, age: int, job: Job):
    """Add a new citizen to the world"""
    citizens.append({
        "name": name,
        "age": age,
        "id": len(citizens),
        "job": job.value,
        "addr": None,  # Will be set when assigned to a house
        "hunger": 0
    })
    print(f"Citizen {name} added with job {job.name.replace('_', ' ').title()}")

def process_day():
    """Simulate one day of activity"""
    print("\nProcessing a new day...")

    # Citizens work and consume food
    for citizen in citizens:
        citizen["hunger"] += 1

        # Citizens with jobs produce resources
        if citizen["job"] != Job.CHILD.value:
            if citizen["job"] == Job.FARMER.value:
                resources["food"] += 2
            elif citizen["job"] == Job.WOODCUTTER.value:
                resources["wood"] += 1
            elif citizen["job"] == Job.MINER.value:
                resources["stone"] += 0.5

    # Feed citizens
    food_needed = sum(1 for c in citizens if c["hunger"] > 0)
    if resources["food"] >= food_needed:
        resources["food"] -= food_needed
        for citizen in citizens:
            citizen["hunger"] = 0
        print(f"Fed all citizens. Food remaining: {resources['food']}")
    else:
        print(f"Not enough food to feed everyone! {food_needed - resources['food']} citizens went hungry")
        resources["food"] = 0

    # Random events
    if random.random() < 0.2:
        event = random.choice([
            "A bountiful harvest!",
            "A tree fell in the forest",
            "A miner found a gold nugget!"
        ])
        print(f"Event: {event}")
        if "harvest" in event:
            resources["food"] += 5
        elif "tree" in event:
            resources["wood"] += 2
        elif "gold" in event:
            resources["gold"] += 1

def main_menu():
    """Display the main menu and handle input"""
    while True:
        print("\n=== CITY MANAGER ===")
        print("1. View World Map")
        print("2. View Resources")
        print("3. View Citizens")
        print("4. View Buildings")
        print("5. Add Citizen")
        print("6. Build Structure")
        print("7. Advance Day")
        print("8. Exit")

        choice = input("Select an option: ")

        if choice == "1":
            display_world()
        elif choice == "2":
            display_resources()
        elif choice == "3":
            display_citizens()
        elif choice == "4":
            display_buildings()
        elif choice == "5":
            name = input("Citizen name: ")
            age = int(input("Age: "))
            print("Available jobs:")
            for job in Job:
                print(f"{job.value}. {job.name.replace('_', ' ').title()}")
            job_id = int(input("Select job: "))
            add_citizen(name, age, Job(job_id))
        elif choice == "6":
            print("Building types:")
            for btype in BuildingType:
                print(f"{btype.value}. {btype.name.title()}")
            building_type = BuildingType(int(input("Select building type: ")))
            x = int(input("X coordinate: "))
            y = int(input("Y coordinate: "))
            place_building(x, y, building_type)
        elif choice == "7":
            process_day()
        elif choice == "8":
            print("Exiting...")
            break
        else:
            print("Invalid choice!")

if __name__ == "__main__":
    # Initial setup
    print("Initializing world...")

    # Place some initial trees
    for _ in range(15):
        x, y = random.randint(0, world_size-1), random.randint(0, world_size-1)
        tiles[x][y] = Tile.TREE

    # Add starter citizens
    add_citizen("Alice", 30, Job.FARMER)
    add_citizen("Bob", 25, Job.WOODCUTTER)
    add_citizen("Charlie", 10, Job.CHILD)

    # Build starter house
    place_building(3, 3, BuildingType.HOUSE)

    # Start the game
    main_menu()
