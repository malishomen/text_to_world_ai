extends Node3D
## DreamCraft — AAA Scene Builder
## Reads dream_config.json, constructs a full cinematic 3D world at runtime.
## Renderer: Forward+ (Vulkan) | GI: SDFGI | Shadows: PCSS 8192px

# ─── State ────────────────────────────────────────────────────────────────────
var config: Dictionary = {}
var palette: Array[Color] = []
var mood_params: Dictionary = {}

# ─── Node refs ────────────────────────────────────────────────────────────────
var world_env: WorldEnvironment
var sun: DirectionalLight3D
var atmosphere: Node  # AtmosphereController
var level_gen: Node   # LevelGenerator
var player: CharacterBody3D

signal dream_world_ready

# ─── Hot-reload watcher ───────────────────────────────────────────────────────
var _config_path: String = ""
var _last_mod_time: int  = 0

# ─── Bootstrap ────────────────────────────────────────────────────────────────
func _ready() -> void:
	config = _load_config()
	_parse_palette()
	mood_params = _compute_mood_params()

	_setup_environment()
	_setup_sun_and_sky_lights()

	level_gen = load("res://scripts/LevelGenerator.gd").new()
	level_gen.name = "LevelGenerator"

	# Hot-reload: check config file every 2 seconds
	_config_path = ProjectSettings.globalize_path("res://world_config.json")
	if FileAccess.file_exists(_config_path):
		_last_mod_time = FileAccess.get_modified_time(_config_path)
	var timer := Timer.new()
	timer.wait_time  = 2.0
	timer.autostart  = true
	timer.timeout.connect(_check_config_hot_reload)
	add_child(timer)

func _check_config_hot_reload() -> void:
	if not FileAccess.file_exists(_config_path):
		return
	var mod := FileAccess.get_modified_time(_config_path)
	if _last_mod_time > 0 and mod > _last_mod_time:
		print("DreamCraft: Config changed — reloading scene")
		get_tree().reload_current_scene()
	_last_mod_time = mod
	add_child(level_gen)
	level_gen.generate(config, palette)

	atmosphere = load("res://scripts/AtmosphereController.gd").new()
	atmosphere.name = "AtmosphereController"
	add_child(atmosphere)
	atmosphere.apply(config, mood_params, world_env)

	player = load("res://scripts/Player.gd").new()
	player.name = "Player"
	add_child(player)
	player.init(config, palette)

	emit_signal("dream_world_ready")
	print("DreamCraft: World ready — mood: ", config.get("mood", "?"))

# ─── Config loader ────────────────────────────────────────────────────────────
func _load_config() -> Dictionary:
	var candidates: Array[String] = [
		"res://world_config.json",
		"res://dream_config.json",
		OS.get_user_data_dir() + "/world_config.json",
		ProjectSettings.globalize_path("res://") + "../world_config.json",
	]
	for path in candidates:
		if FileAccess.file_exists(path):
			var f := FileAccess.open(path, FileAccess.READ)
			var parsed = JSON.parse_string(f.get_as_text())
			f.close()
			if parsed is Dictionary:
				print("DreamCraft: Config loaded → ", path)
				return parsed
	push_warning("DreamCraft: No dream_config.json found, using defaults.")
	return _default_config()

func _default_config() -> Dictionary:
	return {
		"mood": "surreal_calm", "style": "surreal",
		"color_palette": ["#a855f7", "#7c3aed", "#4c1d95", "#1e1b4b"],
		"narrative": "A dream unfolding into reality...",
		"goal": "Reach the luminous portal",
		"main_character": {"color": "#a855f7"},
		"background": {"sky_color": "#0a0015", "ground_color": "#1a0030"},
		"platforms": 8, "enemy_count": 3,
	}

func _parse_palette() -> void:
	palette.clear()
	for hex in config.get("color_palette", []):
		if hex is String and hex.begins_with("#"):
			palette.append(Color.html(hex))
	if palette.is_empty():
		palette = [Color("#a855f7"), Color("#7c3aed"), Color("#4c1d95"), Color("#1e1b4b")]

# ─── Mood → visual params ─────────────────────────────────────────────────────
func _compute_mood_params() -> Dictionary:
	match config.get("mood", "surreal_calm"):
		"nightmare":
			return {
				"sun_energy": 0.25, "sun_color": Color(0.9, 0.05, 0.05),
				"sun_angle": Vector3(-20, -40, 0),
				"ambient": 0.08, "fog_density": 0.06,
				"fog_albedo": Color(0.04, 0.0, 0.0),
				"fog_emission": Color(0.15, 0.0, 0.0), "fog_emission_energy": 0.8,
				"sky_top": Color(0.015, 0.0, 0.015),
				"sky_horizon": Color(0.06, 0.0, 0.0),
				"bloom_intensity": 1.8, "bloom_threshold": 0.7,
				"dof_far": 60.0, "dof_amount": 0.18,
				"saturation": 0.55, "contrast": 1.4, "exposure": 0.9,
				"sdfgi_energy": 0.4, "weather": "storm",
				"vol_light_energy": 1.2,
			}
		"cozy_dream":
			return {
				"sun_energy": 3.0, "sun_color": Color(1.0, 0.88, 0.62),
				"sun_angle": Vector3(-50, 20, 0),
				"ambient": 0.55, "fog_density": 0.006,
				"fog_albedo": Color(0.85, 0.92, 1.0),
				"fog_emission": Color(0.05, 0.05, 0.02), "fog_emission_energy": 0.2,
				"sky_top": Color(0.18, 0.38, 0.78),
				"sky_horizon": Color(0.72, 0.55, 0.28),
				"bloom_intensity": 0.5, "bloom_threshold": 1.8,
				"dof_far": 120.0, "dof_amount": 0.06,
				"saturation": 1.35, "contrast": 0.98, "exposure": 1.3,
				"sdfgi_energy": 1.8, "weather": "clear",
				"vol_light_energy": 0.4,
			}
		"cyber_dream":
			return {
				"sun_energy": 0.1, "sun_color": Color(0.0, 0.85, 1.0),
				"sun_angle": Vector3(-10, -60, 0),
				"ambient": 0.25, "fog_density": 0.028,
				"fog_albedo": Color(0.0, 0.04, 0.12),
				"fog_emission": Color(0.0, 0.12, 0.28), "fog_emission_energy": 1.5,
				"sky_top": Color(0.0, 0.01, 0.04),
				"sky_horizon": Color(0.0, 0.05, 0.15),
				"bloom_intensity": 2.4, "bloom_threshold": 0.4,
				"dof_far": 70.0, "dof_amount": 0.14,
				"saturation": 1.5, "contrast": 1.25, "exposure": 0.95,
				"sdfgi_energy": 1.2, "weather": "rain",
				"vol_light_energy": 2.0,
			}
		"dark_fantasy":
			return {
				"sun_energy": 0.55, "sun_color": Color(0.55, 0.3, 0.85),
				"sun_angle": Vector3(-25, -50, 0),
				"ambient": 0.12, "fog_density": 0.038,
				"fog_albedo": Color(0.08, 0.0, 0.14),
				"fog_emission": Color(0.06, 0.0, 0.12), "fog_emission_energy": 0.6,
				"sky_top": Color(0.04, 0.0, 0.09),
				"sky_horizon": Color(0.10, 0.0, 0.05),
				"bloom_intensity": 1.3, "bloom_threshold": 0.85,
				"dof_far": 80.0, "dof_amount": 0.12,
				"saturation": 0.75, "contrast": 1.28, "exposure": 1.0,
				"sdfgi_energy": 0.6, "weather": "light_fog",
				"vol_light_energy": 0.9,
			}
		"cosmic":
			return {
				"sun_energy": 0.08, "sun_color": Color(0.75, 0.45, 1.0),
				"sun_angle": Vector3(-5, -70, 0),
				"ambient": 0.18, "fog_density": 0.004,
				"fog_albedo": Color(0.0, 0.0, 0.06),
				"fog_emission": Color(0.04, 0.0, 0.10), "fog_emission_energy": 0.8,
				"sky_top": Color(0.0, 0.0, 0.015),
				"sky_horizon": Color(0.02, 0.0, 0.05),
				"bloom_intensity": 2.0, "bloom_threshold": 0.6,
				"dof_far": 200.0, "dof_amount": 0.04,
				"saturation": 1.25, "contrast": 1.12, "exposure": 1.1,
				"sdfgi_energy": 0.8, "weather": "clear",
				"vol_light_energy": 1.5,
			}
		_: # surreal_calm / ethereal / whimsical / default
			return {
				"sun_energy": 1.6, "sun_color": Color(0.92, 0.82, 1.0),
				"sun_angle": Vector3(-38, -30, 0),
				"ambient": 0.42, "fog_density": 0.014,
				"fog_albedo": Color(0.38, 0.28, 0.58),
				"fog_emission": Color(0.06, 0.02, 0.10), "fog_emission_energy": 0.5,
				"sky_top": Color(0.04, 0.015, 0.11),
				"sky_horizon": Color(0.18, 0.08, 0.28),
				"bloom_intensity": 1.0, "bloom_threshold": 1.0,
				"dof_far": 100.0, "dof_amount": 0.09,
				"saturation": 1.12, "contrast": 1.06, "exposure": 1.15,
				"sdfgi_energy": 1.3, "weather": "clear",
				"vol_light_energy": 0.7,
			}

# ─── WorldEnvironment — AAA render settings ───────────────────────────────────
func _setup_environment() -> void:
	world_env = WorldEnvironment.new()
	world_env.name = "WorldEnvironment"

	var env := Environment.new()
	var p := mood_params

	# Sky
	var sky := Sky.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color       = p["sky_top"]
	sky_mat.sky_horizon_color   = p["sky_horizon"]
	sky_mat.sky_curve           = 0.12
	sky_mat.ground_bottom_color = p["sky_top"].darkened(0.7)
	sky_mat.ground_horizon_color = p["sky_horizon"].darkened(0.4)
	sky_mat.ground_curve        = 0.02
	sky_mat.sun_angle_max       = 35.0
	sky_mat.sun_curve           = 0.12
	sky_mat.energy_multiplier   = 1.0
	sky.sky_material = sky_mat
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	# env.sky_luminance_energy removed (not available in Godot 4.6)

	# Ambient
	env.ambient_light_source          = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_color           = palette[1] if palette.size() > 1 else Color.WHITE
	env.ambient_light_energy          = p["ambient"]
	env.ambient_light_sky_contribution = 0.8

	# SDFGI — real-time global illumination
	env.sdfgi_enabled         = true
	env.sdfgi_use_occlusion   = true
	env.sdfgi_energy          = p["sdfgi_energy"]
	env.sdfgi_min_cell_size   = 0.25
	env.sdfgi_normal_bias     = 1.1
	env.sdfgi_probe_bias      = 1.1
	env.sdfgi_read_sky_light  = true

	# SSAO — contact shadows
	env.ssao_enabled          = true
	env.ssao_radius           = 1.8
	env.ssao_intensity        = 3.0
	env.ssao_power            = 1.7
	env.ssao_detail           = 0.5
	env.ssao_horizon          = 0.06
	env.ssao_sharpness        = 0.98
	env.ssao_light_affect     = 0.0
	env.ssao_ao_channel_affect = 1.0

	# SSIL — indirect lighting bounce
	env.ssil_enabled   = true
	env.ssil_radius    = 5.0
	env.ssil_intensity = 1.2
	env.ssil_sharpness = 0.98

	# SSR — screen-space reflections
	env.ssr_enabled        = true
	env.ssr_max_steps      = 64
	env.ssr_fade_in        = 0.15
	env.ssr_fade_out       = 2.0
	env.ssr_depth_tolerance = 0.2

	# Bloom / Glow
	env.glow_enabled             = true
	env.glow_normalized          = true
	env.glow_intensity           = p["bloom_intensity"]
	env.glow_bloom               = 0.4
	env.glow_hdr_threshold       = p["bloom_threshold"]
	env.glow_hdr_scale           = 2.2
	env.glow_hdr_luminance_cap   = 16.0
	env.glow_map_strength        = 0.85
	for i in range(7):
		env.set_glow_level(i, 0.7 if i < 4 else 0.3)

	# Volumetric Fog (god rays source)
	env.volumetric_fog_enabled                    = true
	env.volumetric_fog_density                    = p["fog_density"]
	env.volumetric_fog_albedo                     = p["fog_albedo"]
	env.volumetric_fog_emission                   = p["fog_emission"]
	env.volumetric_fog_emission_energy            = p["fog_emission_energy"]
	env.volumetric_fog_gi_inject                  = 1.0
	env.volumetric_fog_anisotropy                 = 0.3
	env.volumetric_fog_length                     = 80.0
	env.volumetric_fog_detail_spread              = 2.0
	env.volumetric_fog_ambient_inject             = 0.5
	env.volumetric_fog_sky_affect                 = 0.4
	env.volumetric_fog_temporal_reprojection_enabled = true
	env.volumetric_fog_temporal_reprojection_amount  = 0.9

	# DoF moved to CameraAttributesPractical on Camera3D (Player.gd)

	# Tone mapping — Filmic (closest to AAA)
	env.tonemap_mode     = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = p["exposure"]
	env.tonemap_white    = 8.0

	# Color grading
	env.adjustment_enabled    = true
	env.adjustment_brightness = 1.0
	env.adjustment_contrast   = p["contrast"]
	env.adjustment_saturation = p["saturation"]

	world_env.environment = env
	add_child(world_env)

# ─── Sun + fill lights ────────────────────────────────────────────────────────
func _setup_sun_and_sky_lights() -> void:
	var p := mood_params

	# Main directional light (sun / moon)
	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.light_color                        = p["sun_color"]
	sun.light_energy                       = p["sun_energy"]
	sun.light_volumetric_fog_energy        = p["vol_light_energy"]
	sun.shadow_enabled                     = true
	sun.shadow_bias                        = 0.05
	sun.shadow_normal_bias                 = 2.0
	sun.directional_shadow_mode            = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_max_distance    = 250.0
	sun.directional_shadow_split_1        = 0.08
	sun.directional_shadow_split_2        = 0.25
	sun.directional_shadow_split_3        = 0.55
	sun.directional_shadow_fade_start     = 0.88
	sun.directional_shadow_pancake_size   = 15.0
	sun.directional_shadow_blend_splits   = true
	sun.rotation_degrees                  = p["sun_angle"]
	add_child(sun)

	# Hemisphere fill lights — colored by dream palette
	var fill_configs: Array = [
		{"pos": Vector3(-40, 25, -30), "idx": 1, "energy": 0.35, "range": 80.0},
		{"pos": Vector3( 35, 20,  25), "idx": 2, "energy": 0.25, "range": 70.0},
		{"pos": Vector3(  0, 30, -60), "idx": 0, "energy": 0.20, "range": 90.0},
	]
	for fc in fill_configs:
		var fill := OmniLight3D.new()
		fill.light_color                 = palette[fc["idx"]] if fc["idx"] < palette.size() else palette[0]
		fill.light_energy                = fc["energy"]
		fill.omni_range                  = fc["range"]
		fill.shadow_enabled              = false
		fill.light_volumetric_fog_energy = 0.25
		fill.position                    = fc["pos"]
		add_child(fill)
