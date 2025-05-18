extends Node2D

func _ready() -> void:
	#Global.timer.connect("timeout", timed_out)
	pass

func timed_out():
	print('timed_out')

func _process(delta: float) -> void:
	print(Global.seconds)

func _physics_process(delta: float) -> void:
	pass
	
func _draw() -> void:
	pass
