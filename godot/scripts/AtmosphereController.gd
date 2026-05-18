extends Node3D
## Dynamic weather + atmosphere controller.
## Drives: volumetric fog density, rain/storm particles, wind, lightning.

var _env_node: WorldEnvironment
var _env: Environment
var _weather: String = "clear"
var _time: float = 0.0
var _rain: GPUParticles3D
var _lightning_timer: float = 0.0
var _lightning_light: OmniLight3D

func apply(cfg: Dictionary, mood_params: Dictionary, env_node: WorldEnvironment) -> void:
	_env_node = env_node
	_env      = env_node.environment
	_weather  = mood_params.get("weather", "clear")

	_spawn_weather_particles()
	_spawn_lightning_light()

func _spawn_weather_particles() -> void:
	_rain = GPUParticles3D.new()
	_rain.name = "WeatherParticles"
	add_child(_rain)

	var pm := ParticleProcessMaterial.new()

	match _weather:
		"rain", "storm":
			pm.emission_shape       = ParticleProcessMaterial.EMISSION_SHAPE_BOX
			pm.emission_box_extents = Vector3(60, 1, 60)
			pm.direction            = Vector3(0.05, -1.0, 0.0)
			pm.spread               = 3.0
			pm.initial_velocity_min = 20.0
			pm.initial_velocity_max = 28.0
			pm.gravity              = Vector3(0, -5.0, 0)
			pm.scale_min            = 0.04
			pm.scale_max            = 0.06
			pm.color                = Color(0.6, 0.7, 0.9, 0.5)
			_rain.amount            = 800 if _weather == "storm" else 400
			_rain.lifetime          = 1.2
			_rain.position.y        = 25.0
		"light_fog":
			pm.emission_shape       = ParticleProcessMaterial.EMISSION_SHAPE_BOX
			pm.emission_box_extents = Vector3(80, 2, 80)
			pm.direction            = Vector3(0.2, 0.0, 0.05)
			pm.spread               = 60.0
			pm.initial_velocity_min = 0.2
			pm.initial_velocity_max = 0.8
			pm.scale_min            = 0.3
			pm.scale_max            = 0.9
			pm.color                = Color(0.8, 0.8, 0.9, 0.15)
			_rain.amount            = 80
			_rain.lifetime          = 6.0
			_rain.position.y        = 5.0
		_:
			_rain.emitting = false
			return

	_rain.process_material = pm
	_rain.emitting = true
	_rain.visibility_aabb = AABB(Vector3(-80, -30, -80), Vector3(160, 60, 160))

func _spawn_lightning_light() -> void:
	if _weather != "storm":
		return
	_lightning_light = OmniLight3D.new()
	_lightning_light.light_color  = Color(0.8, 0.85, 1.0)
	_lightning_light.light_energy = 0.0
	_lightning_light.omni_range   = 200.0
	_lightning_light.shadow_enabled = false
	_lightning_light.position     = Vector3(0, 60, 0)
	add_child(_lightning_light)

func _process(delta: float) -> void:
	_time += delta
	_animate_fog(delta)
	if _weather == "storm" and _lightning_light:
		_animate_lightning(delta)

func _animate_fog(delta: float) -> void:
	if not _env:
		return
	# Gentle fog density pulse for surreal effect
	var base_density: float = _env.volumetric_fog_density
	var pulse := sin(_time * 0.12) * base_density * 0.15
	_env.volumetric_fog_density = base_density + pulse

func _animate_lightning(delta: float) -> void:
	_lightning_timer -= delta
	if _lightning_timer <= 0.0:
		_lightning_timer = randf_range(3.0, 9.0)
		_trigger_lightning()

func _trigger_lightning() -> void:
	var tween := create_tween()
	tween.tween_property(_lightning_light, "light_energy", 12.0, 0.04)
	tween.tween_property(_lightning_light, "light_energy", 0.0,  0.06)
	tween.tween_interval(0.08)
	tween.tween_property(_lightning_light, "light_energy", 8.0,  0.03)
	tween.tween_property(_lightning_light, "light_energy", 0.0,  0.15)
