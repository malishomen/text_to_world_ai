// DreamCraft — Multi-layer PBR terrain shader
// Blends 3 material zones by height + slope.
// Forward+ renderer required.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

// ─── Uniforms ─────────────────────────────────────────────────────────────────
uniform vec4  color_low    : source_color = vec4(0.15, 0.08, 0.25, 1.0);
uniform vec4  color_mid    : source_color = vec4(0.28, 0.12, 0.45, 1.0);
uniform vec4  color_high   : source_color = vec4(0.55, 0.35, 0.80, 1.0);
uniform vec4  color_snow   : source_color = vec4(0.90, 0.88, 1.00, 1.0);

uniform float roughness_low  : hint_range(0.0, 1.0) = 0.85;
uniform float roughness_mid  : hint_range(0.0, 1.0) = 0.70;
uniform float roughness_high : hint_range(0.0, 1.0) = 0.45;

uniform float metallic_low   : hint_range(0.0, 1.0) = 0.00;
uniform float metallic_high  : hint_range(0.0, 1.0) = 0.15;

uniform float height_low_max  = -2.0;
uniform float height_mid_max  = 5.0;
uniform float height_high_max = 14.0;
uniform float blend_sharpness : hint_range(0.1, 8.0) = 3.0;

uniform float emission_strength : hint_range(0.0, 2.0) = 0.08;
uniform vec4  emission_color : source_color = vec4(0.4, 0.2, 0.7, 1.0);

// Tiling for micro-detail
uniform float uv_scale : hint_range(0.1, 32.0) = 8.0;

// ─── Varying ──────────────────────────────────────────────────────────────────
varying float v_height;
varying vec3  v_world_normal;
varying vec3  v_world_pos;

// ─── Vertex ───────────────────────────────────────────────────────────────────
void vertex() {
	v_height      = VERTEX.y;
	v_world_normal = (MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz;
	v_world_pos    = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
float smooth_blend(float x, float edge0, float edge1) {
	return smoothstep(edge0, edge1, x);
}

// Simple value noise for micro-detail
float hash(vec2 p) {
	p = fract(p * vec2(127.1, 311.7));
	p += dot(p, p + 19.19);
	return fract(p.x * p.y);
}
float value_noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash(i), hash(i + vec2(1,0)), f.x),
		mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
		f.y);
}

// ─── Fragment ─────────────────────────────────────────────────────────────────
void fragment() {
	vec2 scaled_uv = UV * uv_scale;

	// Micro-detail noise (simulates texture variation)
	float detail = value_noise(scaled_uv * 4.0) * 0.5
	             + value_noise(scaled_uv * 8.0) * 0.25
	             + value_noise(scaled_uv * 16.0) * 0.125;
	detail = (detail - 0.5) * 0.15 + 1.0;

	// Height-based blend weights
	float h = v_height;
	float w_low  = 1.0 - smooth_blend(h, height_low_max - 2.0, height_low_max + 2.0);
	float w_high = smooth_blend(h, height_high_max - 2.0, height_high_max + 2.0);
	float w_mid  = 1.0 - w_low - w_high;
	w_mid = max(w_mid, 0.0);

	// Slope factor (steep = rock = mid color darkened)
	float slope       = 1.0 - dot(normalize(v_world_normal), vec3(0.0, 1.0, 0.0));
	float slope_blend = smooth_blend(slope, 0.35, 0.65);

	// Final albedo
	vec4 albedo = color_low  * w_low
	            + color_mid  * w_mid
	            + color_high * w_high;

	// Slope darkens toward rock tone
	albedo = mix(albedo, color_mid * 0.7, slope_blend * 0.6);

	// Snow cap
	albedo = mix(albedo, color_snow, w_high * (1.0 - slope_blend) * 0.8);

	// Apply micro-detail
	albedo.rgb *= detail;

	// Roughness
	float rough = mix(mix(roughness_low, roughness_mid, w_mid + w_high), roughness_high, w_high);
	rough = mix(rough, 0.9, slope_blend * 0.3);

	// Metallic
	float metal = mix(metallic_low, metallic_high, w_high);

	ALBEDO    = albedo.rgb;
	ROUGHNESS = rough;
	METALLIC  = metal;

	// Subtle emission on high peaks for dream glow
	EMISSION = emission_color.rgb * emission_strength * w_high * (1.0 - slope_blend);

	// Normal perturbation from noise (fake micro bumps)
	float dX = value_noise(scaled_uv + vec2(0.01, 0.0)) - value_noise(scaled_uv - vec2(0.01, 0.0));
	float dY = value_noise(scaled_uv + vec2(0.0, 0.01)) - value_noise(scaled_uv - vec2(0.0, 0.01));
	NORMAL_MAP = normalize(vec3(dX, dY, 1.0)) * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 0.6;
}
