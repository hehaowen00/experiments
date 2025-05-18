extends BoxContainer

func _ready() -> void:
	$Button.pressed.connect(btn1_clicked)

func btn1_clicked():
	print('clicked btn1')
	Global.resources["gold"] += 5
