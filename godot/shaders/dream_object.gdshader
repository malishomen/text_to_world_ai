// DreamCraft — Glowing dream object shader
// Pulsing emission, rim light, Fresnel glow, animated UV scroll.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform vec4  albedo_color   : source_color = vec4(0.6, 0.2, 0.9, 1.0);
uniform vec4  emission_color : source_color = vec4(0.6, 0.2, 0.9, 1.0);
uniform float emission_min   : hint_range(0.0, 5.0)  = 0.3;
uniform float emission_max   : hint_range(0.0, 10.0) = 2.0;
uniform float pulse_speed    : hint_range(0.1, 8.0)  = 1.8;
uniform float rim_strength   : hint_range(0.0, 3.0)  = 1.2;
uniform float metallic       : hint_range(0.0, 1.0)  = 0.6;
uniform float roughness      : hint_range(0.0, 1.0)  = 0.12;
uniform float uv_scroll_x    : hint_range(-1.0, 1.0) = 0.05;
uniform float uv_scroll_y    : hint_range(-1.0, 1.0) = 0.08;
uniform sampler2D noise_tex  : hint_default_white;

uniform float TIME_SCALE : hint_range(0.0, 2.0) = 1.0;

void fragment() {
	// Animated UV
	vec2 uv = UV + vec2(uv_scroll_x, uv_scroll_y) * TIME * TIME_SCALE;

	// Noise-based variation
	float noise = texture(noise_tex, uv * 2.0).r;

	// Fresnel rim
	float fresnel = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);

	// Pulsing emission
	float pulse = (sin(TIME * pulse_speed * TIME_SCALE) * 0.5 + 0.5);
	float emit  = mix(emission_min, emission_max, pulse) * (0.8 + noise * 0.4);

	ALBEDO    = albedo_color.rgb;
	METALLIC  = metallic;
	ROUGHNESS = roughness;
	EMISSION  = emission_color.rgb * emit + emission_color.rgb * fresnel * rim_strength;
	SPECULAR  = 0.8;
}
