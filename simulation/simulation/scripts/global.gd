extends Node2D

var seconds: float
var resources: Dictionary

func _ready():
	seconds = 0
	resources["gold"] = 0

func _process(delta: float) -> void:
	seconds += delta
