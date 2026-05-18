extends CharacterBody3D
## Third-person player controller with spring-arm camera.
## Supports: WASD, sprint (Shift), double-jump, coyote time.

# ─── Constants ────────────────────────────────────────────────────────────────
const WALK_SPEED    := 6.0
const SPRINT_SPEED  := 12.0
const JUMP_FORCE    := 9.5
const GRAVITY       := 22.0
const ACCEL         := 18.0
const DECEL         := 24.0
const AIR_CONTROL   := 0.35
const COYOTE_TIME   := 0.12
const JUMP_BUFFER   := 0.10
const MAX_JUMPS     := 2

# ─── Camera config ────────────────────────────────────────────────────────────
const CAM_DISTANCE  := 7.0
const CAM_HEIGHT    := 2.8
const CAM_SENS_X    := 0.003
const CAM_SENS_Y    := 0.002
const CAM_PITCH_MIN := -60.0
const CAM_PITCH_MAX := 75.0
const CAM_LERP      := 8.0
const FOV_WALK      := 72.0
const FOV_SPRINT    := 82.0

# ─── State ────────────────────────────────────────────────────────────────────
var _jumps_left       := MAX_JUMPS
var _coyote_timer     := 0.0
var _jump_buffer      := 0.0
var _is_sprinting     := false
var _cam_yaw          := 0.0
var _cam_pitch        := -20.0
var _spring_arm_len   := CAM_DISTANCE
var _char_color       := Color("#a855f7")

# ─── Nodes ────────────────────────────────────────────────────────────────────
var _yaw_pivot:   Node3D
var _spring_arm:  SpringArm3D
var _camera:      Camera3D
var _mesh:        MeshInstance3D
var _light:       OmniLight3D
var _particles:   GPUParticles3D

# ─────────────────────────────────────────────────────────────────────────────
func init(cfg: Dictionary, palette: Array[Color]) -> void:
	var char_data = cfg.get("main_character", {})
	var hex: String = char_data.get("color", "#a855f7")
	_char_color = Color.html(hex) if hex.begins_with("#") else Color("#a855f7")
	_build_nodes()
	position = Vector3(0, 3.0, 0)

func _build_nodes() -> void:
	# ── Collision ──────────────────────────────────────────────────────────
	var col := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.38
	cap.height = 1.6
	col.shape  = cap
	col.position.y = 0.8
	add_child(col)

	# ── Character mesh ─────────────────────────────────────────────────────
	_mesh = MeshInstance3D.new()
	var capsule_mesh := CapsuleMesh.new()
	capsule_mesh.radius = 0.35
	capsule_mesh.height = 1.55
	_mesh.mesh = capsule_mesh
	_mesh.position.y = 0.8
	_mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

	var mat := StandardMaterial3D.new()
	mat.albedo_color        = _char_color
	mat.emission_enabled    = true
	mat.emission            = _char_color
	mat.emission_energy_multiplier = 0.4
	mat.metallic            = 0.3
	mat.roughness           = 0.2
	mat.rim_enabled         = true
	mat.rim                 = 0.6
	mat.rim_tint            = 0.5
	_mesh.material_override = mat
	add_child(_mesh)

	# ── Player point light (self-illumination) ─────────────────────────────
	_light = OmniLight3D.new()
	_light.light_color              = _char_color
	_light.light_energy             = 2.5
	_light.omni_range               = 5.0
	_light.shadow_enabled           = false
	_light.light_volumetric_fog_energy = 0.8
	_light.position                 = Vector3(0, 1.2, 0)
	add_child(_light)

	# ── Trail particles ────────────────────────────────────────────────────
	_particles = GPUParticles3D.new()
	var proc_mat := ParticleProcessMaterial.new()
	proc_mat.emission_shape          = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	proc_mat.emission_sphere_radius  = 0.3
	proc_mat.direction               = Vector3(0, 1, 0)
	proc_mat.spread                  = 30.0
	proc_mat.initial_velocity_min    = 0.2
	proc_mat.initial_velocity_max    = 0.8
	proc_mat.gravity                 = Vector3(0, 0.5, 0)
	proc_mat.scale_min               = 0.05
	proc_mat.scale_max               = 0.18
	proc_mat.color                   = _char_color
	_particles.process_material      = proc_mat
	_particles.amount                = 24
	_particles.lifetime              = 0.6
	_particles.fixed_fps             = 60
	add_child(_particles)

	# ── Camera rig ────────────────────────────────────────────────────────
	_yaw_pivot = Node3D.new()
	_yaw_pivot.position = Vector3(0, 1.5, 0)
	add_child(_yaw_pivot)

	_spring_arm = SpringArm3D.new()
	_spring_arm.spring_length = CAM_DISTANCE
	_spring_arm.margin        = 0.3
	_spring_arm.rotation_degrees.x = _cam_pitch
	_yaw_pivot.add_child(_spring_arm)

	_camera = Camera3D.new()
	_camera.fov                      = FOV_WALK
	_camera.near                     = 0.1
	_camera.far                      = 600.0
	_camera.position                 = Vector3(0, CAM_HEIGHT * 0.3, CAM_DISTANCE)
	# DoF focus tracking — auto-focus on scene via adjustment
	_camera.attributes               = CameraAttributesPractical.new()
	var attr := _camera.attributes as CameraAttributesPractical
	attr.dof_blur_far_enabled        = true
	attr.dof_blur_far_distance       = 80.0
	attr.dof_blur_far_transition     = 30.0
	attr.dof_blur_amount             = 0.08
	attr.auto_exposure_enabled       = true
	attr.auto_exposure_min_sensitivity = 50.0
	attr.auto_exposure_max_sensitivity = 800.0
	attr.auto_exposure_speed         = 3.0
	_spring_arm.add_child(_camera)

	# Capture mouse
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func _input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_cam_yaw  -= event.relative.x * CAM_SENS_X
		_cam_pitch -= event.relative.y * CAM_SENS_Y
		_cam_pitch  = clampf(_cam_pitch, deg_to_rad(CAM_PITCH_MIN), deg_to_rad(CAM_PITCH_MAX))
	if event.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func _physics_process(delta: float) -> void:
	_update_timers(delta)
	_handle_movement(delta)
	_handle_jump()
	_update_camera(delta)
	_update_visuals(delta)
	move_and_slide()

func _update_timers(delta: float) -> void:
	if is_on_floor():
		_coyote_timer = COYOTE_TIME
		_jumps_left   = MAX_JUMPS
	else:
		_coyote_timer = maxf(_coyote_timer - delta, 0.0)
	_jump_buffer = maxf(_jump_buffer - delta, 0.0)

func _handle_movement(delta: float) -> void:
	_is_sprinting = Input.is_action_pressed("sprint")
	var target_speed := SPRINT_SPEED if _is_sprinting else WALK_SPEED
	var on_floor     := is_on_floor()

	# Input direction in camera space
	var raw := Vector2(
		Input.get_axis("move_left",  "move_right"),
		Input.get_axis("move_forward", "move_back")
	).normalized()

	var cam_basis  := _yaw_pivot.global_transform.basis
	var move_dir   := (cam_basis.x * raw.x + (-cam_basis.z) * raw.y).normalized()
	move_dir.y     = 0.0

	var accel := ACCEL if on_floor else ACCEL * AIR_CONTROL
	var decel := DECEL if on_floor else DECEL * 0.4

	if move_dir.length() > 0.01:
		velocity.x = move_toward(velocity.x, move_dir.x * target_speed, accel * delta)
		velocity.z = move_toward(velocity.z, move_dir.z * target_speed, accel * delta)
		# Rotate mesh toward movement
		var target_angle := atan2(-move_dir.x, -move_dir.z)
		_mesh.rotation.y = lerp_angle(_mesh.rotation.y, target_angle, 12.0 * delta)
	else:
		velocity.x = move_toward(velocity.x, 0.0, decel * delta)
		velocity.z = move_toward(velocity.z, 0.0, decel * delta)

	if not on_floor:
		velocity.y -= GRAVITY * delta

func _handle_jump() -> void:
	if Input.is_action_just_pressed("jump"):
		_jump_buffer = JUMP_BUFFER

	var can_jump := _coyote_timer > 0.0 or _jumps_left > 0
	if _jump_buffer > 0.0 and can_jump:
		velocity.y   = JUMP_FORCE
		_jump_buffer = 0.0
		_coyote_timer = 0.0
		_jumps_left  -= 1

	# Fall faster for better game feel
	if velocity.y < 0:
		velocity.y -= GRAVITY * 0.5 * get_physics_process_delta_time()

func _update_camera(delta: float) -> void:
	_yaw_pivot.rotation.y      = _cam_yaw
	_spring_arm.rotation.x     = _cam_pitch
	_spring_arm.spring_length  = lerpf(_spring_arm.spring_length, CAM_DISTANCE, 10.0 * delta)

	var target_fov := FOV_SPRINT if _is_sprinting else FOV_WALK
	_camera.fov    = lerpf(_camera.fov, target_fov, 6.0 * delta)

func _update_visuals(delta: float) -> void:
	var speed := Vector2(velocity.x, velocity.z).length()

	# Particle emission only when moving
	_particles.emitting = speed > 1.0

	# Light pulse
	_light.light_energy = 2.0 + sin(Time.get_ticks_msec() * 0.003) * 0.6

	# Squash-stretch on landing / jumping
	if is_on_floor() and velocity.y == 0.0 and speed > 2.0:
		_mesh.scale = _mesh.scale.lerp(Vector3(1.0, 1.0, 1.0), 12.0 * delta)
	elif not is_on_floor() and velocity.y > 0:
		_mesh.scale = _mesh.scale.lerp(Vector3(0.88, 1.18, 0.88), 10.0 * delta)
	elif not is_on_floor() and velocity.y < -3.0:
		_mesh.scale = _mesh.scale.lerp(Vector3(1.12, 0.86, 1.12), 8.0 * delta)
	else:
		_mesh.scale = _mesh.scale.lerp(Vector3(1.0, 1.0, 1.0), 10.0 * delta)
