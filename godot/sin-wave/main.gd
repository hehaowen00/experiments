extends Node2D

var amplitude = 100
var frequency = 0.05


func _ready():
	_draw()


func _draw():
	var dim = DisplayServer.window_get_size()
	var points = PackedVector2Array()
	var length = dim.x
	
	for x in range(length):
		var y = amplitude * sin((x - dim.x / 2) * frequency)
		points.append(Vector2(x, y + dim.y / 2))
	
	draw_polyline(points, Color.BLUE, 2)
	draw_line(Vector2(dim.x / 2, 0), Vector2(dim.x / 2, length), Color.BLACK, 1)
	draw_line(Vector2(0, dim.y / 2), Vector2(length, dim.y / 2), Color.BLACK, 1)


func _on_amplitude_value_changed(value: float) -> void:
	amplitude = value
	queue_redraw()


func _on_frequency_value_changed(value: float) -> void:
	frequency = value
	queue_redraw()
