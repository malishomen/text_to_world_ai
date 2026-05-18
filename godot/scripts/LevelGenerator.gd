extends Node3D
## Procedural level generator — читает world_config.json, размещает GLB объекты.

var _config:  Dictionary = {}
var _palette: Array[Color] = []
var _noise:   FastNoiseLite

const TERRAIN_SIZE   := 300
const TERRAIN_RES    := 128
const TERRAIN_HEIGHT := 20.0
const WATER_LEVEL    := -2.0

func generate(cfg: Dictionary, palette: Array[Color]) -> void:
	_config  = cfg
	_palette = palette
	_init_noise()
	_build_terrain()
	_build_water()
	_place_objects()
	_spawn_ambient_lights()
	_spawn_particles()

func _init_noise() -> void:
	_noise = FastNoiseLite.new()
	_noise.noise_type        = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	_noise.fractal_type      = FastNoiseLite.FRACTAL_FBM
	_noise.fractal_octaves   = 6
	_noise.fractal_lacunarity = 2.1
	_noise.fractal_gain      = 0.48
	_noise.frequency         = 0.006
	var terrain_data = _config.get("terrain", {})
	_noise.seed = abs(terrain_data.get("seed", _config.get("fantasy", "world").hash()))

# ─── Terrain ──────────────────────────────────────────────────────────────────
func _build_terrain() -> void:
	var step := float(TERRAIN_SIZE) / TERRAIN_RES
	var half := TERRAIN_SIZE * 0.5

	var verts   := PackedVector3Array()
	var normals := PackedVector3Array()
	var uvs     := PackedVector2Array()
	var indices := PackedInt32Array()
	var colors  := PackedColorArray()

	var height_map: Array = []
	for z in range(TERRAIN_RES + 1):
		var row: Array = []
		for x in range(TERRAIN_RES + 1):
			var wx := (float(x) / TERRAIN_RES - 0.5) * TERRAIN_SIZE
			var wz := (float(z) / TERRAIN_RES - 0.5) * TERRAIN_SIZE
			var h  := _noise.get_noise_2d(wx, wz) * TERRAIN_HEIGHT
			var dist := Vector2(wx, wz).length()
			h = lerpf(0.0, h, smoothstep(0.0, 30.0, dist))
			row.append(h)
		height_map.append(row)

	var terrain_data: Dictionary = _config.get("terrain", {})
	var col_low:  Color = Color.html(terrain_data.get("base_color", "#1a0d00")) if _palette.is_empty() else _palette[0]
	var col_high: Color = Color.html(terrain_data.get("peak_color", "#4a2d0a")) if _palette.size() < 2 else _palette[1]

	for z in range(TERRAIN_RES + 1):
		for x in range(TERRAIN_RES + 1):
			var fx: float = float(x) / TERRAIN_RES
			var fz: float = float(z) / TERRAIN_RES
			var h:  float = height_map[z][x]
			verts.append(Vector3(fx * TERRAIN_SIZE - half, h, fz * TERRAIN_SIZE - half))
			uvs.append(Vector2(fx * 10.0, fz * 10.0))
			var t: float = clampf((h + TERRAIN_HEIGHT) / (TERRAIN_HEIGHT * 2.0), 0.0, 1.0)
			colors.append(col_low.lerp(col_high, t))

	for z in range(TERRAIN_RES + 1):
		for x in range(TERRAIN_RES + 1):
			var hL: float = height_map[z][max(x-1,0)]
			var hR: float = height_map[z][min(x+1,TERRAIN_RES)]
			var hD: float = height_map[max(z-1,0)][x]
			var hU: float = height_map[min(z+1,TERRAIN_RES)][x]
			normals.append(Vector3(hL - hR, 2.0 * step, hD - hU).normalized())

	for z in range(TERRAIN_RES):
		for x in range(TERRAIN_RES):
			var i := z * (TERRAIN_RES + 1) + x
			indices.append(i);       indices.append(i + 1)
			indices.append(i + TERRAIN_RES + 1)
			indices.append(i + 1);  indices.append(i + TERRAIN_RES + 2)
			indices.append(i + TERRAIN_RES + 1)

	var arrays := []; arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_COLOR]  = colors
	arrays[Mesh.ARRAY_INDEX]  = indices

	var arr_mesh := ArrayMesh.new()
	arr_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	arr_mesh.surface_set_material(0, _make_terrain_mat())

	var mi    := MeshInstance3D.new(); mi.name = "Terrain"; mi.mesh = arr_mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

	var body  := StaticBody3D.new()
	var shape := CollisionShape3D.new()
	var htmap := HeightMapShape3D.new()
	htmap.map_width = TERRAIN_RES + 1; htmap.map_depth = TERRAIN_RES + 1
	var hdata := PackedFloat32Array()
	for z in range(TERRAIN_RES + 1):
		for x in range(TERRAIN_RES + 1):
			hdata.append(height_map[z][x])
	htmap.map_data   = hdata
	shape.shape      = htmap
	shape.position   = Vector3(-TERRAIN_SIZE * 0.5, 0, -TERRAIN_SIZE * 0.5)
	shape.scale      = Vector3(float(TERRAIN_SIZE) / TERRAIN_RES, 1.0, float(TERRAIN_SIZE) / TERRAIN_RES)
	body.add_child(shape); body.add_child(mi)
	add_child(body)

func _make_terrain_mat() -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	var c   := _palette[0] if not _palette.is_empty() else Color(0.2, 0.15, 0.1)
	mat.albedo_color = c
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 0.8; mat.metallic = 0.0
	return mat

func _build_water() -> void:
	var wm  := PlaneMesh.new()
	wm.size = Vector2(TERRAIN_SIZE, TERRAIN_SIZE)
	var mat := StandardMaterial3D.new()
	var wc  := _palette[0] if not _palette.is_empty() else Color(0.1, 0.2, 0.5)
	mat.albedo_color  = Color(wc.r, wc.g, wc.b + 0.15, 0.5)
	mat.roughness     = 0.05; mat.metallic = 0.0
	mat.transparency  = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.emission_enabled = true
	mat.emission      = wc; mat.emission_energy_multiplier = 0.2
	var wi := MeshInstance3D.new(); wi.name = "Water"
	wi.mesh = wm; wi.position.y = WATER_LEVEL
	wi.material_override = mat
	add_child(wi)

# ─── GLB Object Placement ──────────────────────────────────────────────────────
func _place_objects() -> void:
	var objects: Array = _config.get("objects", [])
	if objects.is_empty():
		_build_fallback_props()
		return

	var container := Node3D.new(); container.name = "Objects"
	add_child(container)

	for obj_data in objects:
		var glb_file: String = obj_data.get("glb", "")
		var positions: Array = obj_data.get("positions", [])
		var scale_arr: Array = obj_data.get("scale", [1.0, 1.0, 1.0])
		var obj_scale := Vector3(scale_arr[0], scale_arr[1], scale_arr[2])
		var obj_type: String = obj_data.get("type", "object")

		# Try GLB first, then PNG texture on procedural mesh
		var glb_path     := "res://assets/" + glb_file
		var texture_file : String = obj_data.get("texture", "")
		var texture_path := "res://assets/" + texture_file
		var scene: PackedScene = null

		if glb_file != "" and ResourceLoader.exists(glb_path):
			scene = load(glb_path)
			print("DreamCraft: GLB → ", glb_path)
		else:
			print("DreamCraft: No GLB, using PNG texture mesh → ", texture_path)

		var pal_idx: int = objects.find(obj_data) % max(_palette.size(), 1)
		var obj_color: Color = _palette[pal_idx] if not _palette.is_empty() else Color.PURPLE

		# Load FLUX-generated texture if available
		var tex: Texture2D = null
		if texture_file != "" and ResourceLoader.exists(texture_path):
			tex = load(texture_path)

		for pos_arr in positions:
			var world_x: float = pos_arr[0] if pos_arr.size() > 0 else 0.0
			var world_z: float = pos_arr[2] if pos_arr.size() > 2 else 0.0
			var world_y: float = _get_terrain_height(world_x, world_z)

			var node: Node3D
			if scene:
				node = scene.instantiate()
			else:
				node = _make_textured_mesh(obj_data, obj_color, tex)

			node.position = Vector3(world_x, world_y, world_z)
			node.scale    = obj_scale
			# Random Y rotation for natural look
			node.rotation.y = randf() * TAU
			container.add_child(node)

			# Point light for landmark objects
			if obj_data.get("is_landmark", false):
				var lp := OmniLight3D.new()
				var lc := _palette[0] if not _palette.is_empty() else Color.WHITE
				lp.light_color  = lc; lp.light_energy = 1.5
				lp.omni_range   = 20.0; lp.shadow_enabled = false
				lp.light_volumetric_fog_energy = 0.8
				lp.position = Vector3(world_x, world_y + 5.0, world_z)
				container.add_child(lp)

# ─── Terrain height sampler (approximate) ─────────────────────────────────────
func _get_terrain_height(x: float, z: float) -> float:
	var h := _noise.get_noise_2d(x, z) * TERRAIN_HEIGHT
	var dist := Vector2(x, z).length()
	return lerpf(0.0, h, smoothstep(0.0, 30.0, dist))

# ─── Fallback mesh when GLB unavailable ───────────────────────────────────────
func _make_textured_mesh(obj_data: Dictionary, color: Color, tex: Texture2D) -> Node3D:
	var n  := Node3D.new()
	var mi := MeshInstance3D.new()
	var mesh: Mesh

	match obj_data.get("type", ""):
		"tree", "pine", "forest":
			var cy := CylinderMesh.new()
			cy.top_radius = 0.0; cy.bottom_radius = 0.8; cy.height = 5.0
			mesh = cy
		"bush", "shrub", "plant":
			var sp := SphereMesh.new(); sp.radius = 0.8; sp.height = 1.6; mesh = sp
		"castle", "tower", "temple", "fortress", "ruin", "building":
			var bx := BoxMesh.new(); bx.size = Vector3(4, 7, 4); mesh = bx
		"rock", "stone", "boulder", "cliff":
			var sp := SphereMesh.new(); sp.radius = 1.0; sp.height = 1.4; mesh = sp
		"mushroom", "flower":
			var cy := CylinderMesh.new()
			cy.top_radius = 0.8; cy.bottom_radius = 0.15; cy.height = 1.5
			mesh = cy
		_:
			var bx := BoxMesh.new(); bx.size = Vector3(1.5, 2.0, 1.5); mesh = bx

	var mat := StandardMaterial3D.new()
	if tex:
		# Apply FLUX-generated image as albedo texture
		mat.albedo_texture = tex
		mat.albedo_color   = Color.WHITE
	else:
		mat.albedo_color = color
	mat.emission_enabled = true
	mat.emission         = color
	mat.emission_energy_multiplier = 0.15
	mat.roughness = 0.55; mat.metallic = 0.1
	mat.rim_enabled = true; mat.rim = 0.4

	mi.mesh = mesh; mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	n.add_child(mi)
	return n

func _make_fallback_mesh(obj_data: Dictionary, color: Color) -> Node3D:
	return _make_textured_mesh(obj_data, color, null)

func _build_fallback_props() -> void:
	# No objects in config — place simple environmental props
	var rng := RandomNumberGenerator.new(); rng.seed = 12345
	var container := Node3D.new(); container.name = "FallbackProps"
	add_child(container)
	for i in range(15):
		var px := rng.randf_range(-60, 60)
		var pz := rng.randf_range(-60, 60)
		var py := _get_terrain_height(px, pz)
		if py < WATER_LEVEL + 0.3: continue
		var col := _palette[i % _palette.size()] if not _palette.is_empty() else Color.PURPLE
		var n   := _make_fallback_mesh({"type": "rock"}, col)
		n.position = Vector3(px, py, pz)
		container.add_child(n)

# ─── Ambient lights ────────────────────────────────────────────────────────────
func _spawn_ambient_lights() -> void:
	var positions := [
		Vector3(30,12,30), Vector3(-30,10,40), Vector3(0,15,-30),
		Vector3(50,8,-20), Vector3(-50,12,10),
	]
	for i in range(positions.size()):
		var col := _palette[i % _palette.size()] if not _palette.is_empty() else Color.PURPLE
		var pl  := OmniLight3D.new()
		pl.light_color  = col; pl.light_energy = 0.4; pl.omni_range = 35.0
		pl.shadow_enabled = false; pl.light_volumetric_fog_energy = 0.35
		pl.position = positions[i]; add_child(pl)

# ─── Dream dust particles ─────────────────────────────────────────────────────
func _spawn_particles() -> void:
	var dust := GPUParticles3D.new(); dust.name = "DreamDust"
	var pm   := ParticleProcessMaterial.new()
	pm.emission_shape       = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(80, 15, 80)
	pm.direction            = Vector3(0.1, 0.0, 0.05)
	pm.spread               = 180.0
	pm.initial_velocity_min = 0.1; pm.initial_velocity_max = 0.4
	pm.gravity              = Vector3(0, 0.01, 0)
	pm.scale_min            = 0.03; pm.scale_max = 0.10
	pm.color = _palette[0] if not _palette.is_empty() else Color.WHITE
	dust.process_material   = pm; dust.amount = 180; dust.lifetime = 10.0
	dust.visibility_aabb    = AABB(Vector3(-80,-5,-80), Vector3(160,20,160))
	dust.position           = Vector3(0, 6, 0)
	add_child(dust)
