extends Node

# Reads game config from localStorage (via JavaScript bridge) and starts the game.
# In the Godot WebGL export, JavaScript.eval() allows reading from the web page.

var config: Dictionary = {}
var assets: Dictionary = {}

func _ready():
	config = _load_config()
	assets = _load_assets()
	get_tree().call_group("game_nodes", "apply_dream_config", config, assets)

func _load_config() -> Dictionary:
	var default_config = {
		"mood": "surreal_calm",
		"style": "surreal",
		"main_character": {"description": "Dream Wanderer", "color": "#a855f7"},
		"background": {"sky_color": "#0a0015", "ground_color": "#1a0030"},
		"color_palette": ["#a855f7", "#7c3aed", "#4c1d95", "#0a0015"],
		"narrative": "A dream unfolding into reality...",
		"goal": "Reach the light",
		"platforms": 6,
		"enemy_count": 3,
	}

	# In WebGL export, read from localStorage via JS bridge
	if OS.get_name() == "Web":
		var js_result = JavaScriptBridge.eval(
			"JSON.stringify(JSON.parse(localStorage.getItem('gameConfig') || '{}'))"
		)
		if js_result and typeof(js_result) == TYPE_STRING and js_result != "{}":
			var parsed = JSON.parse_string(js_result)
			if parsed and typeof(parsed) == TYPE_DICTIONARY:
				return parsed

	# Desktop: try reading from a local file (useful during dev)
	var file_path = "user://game_config.json"
	if FileAccess.file_exists(file_path):
		var file = FileAccess.open(file_path, FileAccess.READ)
		var text = file.get_as_text()
		file.close()
		var parsed = JSON.parse_string(text)
		if parsed:
			return parsed

	return default_config

func _load_assets() -> Dictionary:
	if OS.get_name() == "Web":
		var js_result = JavaScriptBridge.eval(
			"JSON.stringify(JSON.parse(localStorage.getItem('gameAssets') || '{}'))"
		)
		if js_result and typeof(js_result) == TYPE_STRING:
			var parsed = JSON.parse_string(js_result)
			if parsed and typeof(parsed) == TYPE_DICTIONARY:
				return parsed
	return {}

func get_color(hex: String) -> Color:
	return Color.html(hex) if hex.begins_with("#") else Color.PURPLE
