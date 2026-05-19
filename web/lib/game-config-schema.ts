// Runtime schema + parser for GameConfig (Phase 2).
//
// Treats the LLM as adversarial: extra keys are ignored, wrong types coerced
// safely or replaced by fallbacks. Never throws to the caller — on any failure
// `parseGameConfig` returns `buildFallback(dream)`.
//
// See: web/lib/fallback-config.ts for the existing `GameConfig` interface.

import * as z from 'zod';
import { type GameConfig, buildFallback } from '@/lib/fallback-config';

// ---------------------------------------------------------------------------
// Hex color guard
// ---------------------------------------------------------------------------

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** True when `s` is a string of the form `#rgb`, `#rgba`, `#rrggbb`, or `#rrggbbaa`. */
export function isValidHexColor(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (!HEX_COLOR_RE.test(s)) return false;
  // Restrict to canonical lengths: 3, 4, 6, 8 hex digits after the `#`.
  const len = s.length - 1;
  return len === 3 || len === 4 || len === 6 || len === 8;
}

// ---------------------------------------------------------------------------
// Defaults (single source of truth — keep aligned with fallback-config.ts)
// ---------------------------------------------------------------------------

const DEFAULTS = {
  mood: 'surreal_calm',
  style: 'surreal',
  genre: '3d_platformer',
  character_description: 'Dream Wanderer',
  character_color: '#a855f7',
  sky_color: '#0a0015',
  ground_color: '#1a0030',
  palette: ['#a855f7', '#7c3aed', '#4c1d95', '#1e1b4b'] as readonly string[],
  narrative: 'A dream unfolds...',
  goal: 'Reach the light beyond the dream',
  platforms: 6,
  enemy_count: 3,
} as const;

// ---------------------------------------------------------------------------
// Zod schema (lenient: unknown keys are ignored, everything optional at the
// raw level — normalization happens in `parseGameConfig`).
// ---------------------------------------------------------------------------

const mainCharacterSchema = z
  .object({
    description: z.string().optional(),
    color: z.string().optional(),
  })
  .optional();

const backgroundSchema = z
  .object({
    sky_color: z.string().optional(),
    ground_color: z.string().optional(),
  })
  .optional();

/**
 * Public schema. Callers may use `gameConfigSchema.safeParse(raw)` directly
 * when they need access to the raw zod result. For normalized output prefer
 * `parseGameConfig(raw, dream)`.
 *
 * The schema is intentionally permissive — every field is optional, unknown
 * keys are stripped (default zod behavior), and types of individual fields
 * are loose so the post-parse normalization layer can apply
 * field-by-field fallbacks instead of failing the whole object.
 */
export const gameConfigSchema = z.object({
  mood: z.string().optional(),
  style: z.string().optional(),
  genre: z.string().optional(),
  main_character: mainCharacterSchema,
  background: backgroundSchema,
  color_palette: z.array(z.string()).optional(),
  narrative: z.string().optional(),
  goal: z.string().optional(),
  music_prompt: z.string().optional(),
  platforms: z.number().optional(),
  enemy_count: z.number().optional(),

  // Optional extended fields the LLM may emit. They are not part of the
  // canonical `GameConfig` interface — `parseGameConfig` ignores them, but
  // `parseGameConfigExtended` preserves them for downstream consumers.
  weather: z.string().optional(),
  time_of_day: z.string().optional(),
  fog_density: z.number().optional(),
  terrain_height_scale: z.number().optional(),
  meshy_character_prompt: z.string().optional(),
  meshy_environment_prompt: z.string().optional(),
  godot_environment_hints: z.record(z.string(), z.unknown()).optional(),
});

export type RawGameConfig = z.infer<typeof gameConfigSchema>;

/** Optional, extended fields that the LLM may emit beyond the canonical {@link GameConfig}. */
export interface ExtendedGameConfigFields {
  weather?: string;
  time_of_day?: string;
  fog_density?: number;
  terrain_height_scale?: number;
  meshy_character_prompt?: string;
  meshy_environment_prompt?: string;
  godot_environment_hints?: Record<string, unknown>;
}

export type ExtendedGameConfig = GameConfig & ExtendedGameConfigFields;

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeHex(value: unknown, fallback: string): string {
  return isValidHexColor(value) ? value : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function normalizePalette(value: unknown, fallback: readonly string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const filtered = value.filter(isValidHexColor);
  return filtered.length >= 1 ? filtered : [...fallback];
}

function normalizeGenre(_value: unknown): string {
  // Hard invariant (agent.md §1.6 / memory.md §1.3): the game is 3D.
  // Every config, normalized or fallback, sets genre to '3d_platformer'.
  return DEFAULTS.genre;
}

function normalizeMusicPrompt(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

// ---------------------------------------------------------------------------
// Public parsers
// ---------------------------------------------------------------------------

function buildExtended(parsed: RawGameConfig, dream: string): ExtendedGameConfig {
  const fb = buildFallback(dream);

  const mainCharacter = {
    description: normalizeString(parsed.main_character?.description, fb.main_character.description),
    color: normalizeHex(parsed.main_character?.color, fb.main_character.color),
  };

  const background = {
    sky_color: normalizeHex(parsed.background?.sky_color, fb.background.sky_color),
    ground_color: normalizeHex(parsed.background?.ground_color, fb.background.ground_color),
  };

  const core: GameConfig = {
    mood: normalizeString(parsed.mood, fb.mood),
    style: normalizeString(parsed.style, fb.style),
    genre: normalizeGenre(parsed.genre),
    main_character: mainCharacter,
    background,
    color_palette: normalizePalette(parsed.color_palette, fb.color_palette),
    narrative: normalizeString(parsed.narrative, fb.narrative),
    goal: normalizeString(parsed.goal, fb.goal),
    music_prompt: normalizeMusicPrompt(parsed.music_prompt) ?? fb.music_prompt,
    platforms: clampInt(parsed.platforms, 5, 12, fb.platforms),
    enemy_count: clampInt(parsed.enemy_count, 0, 8, fb.enemy_count),
  };

  const extended: ExtendedGameConfigFields = {};
  if (typeof parsed.weather === 'string' && parsed.weather.trim().length > 0) {
    extended.weather = parsed.weather;
  }
  if (typeof parsed.time_of_day === 'string' && parsed.time_of_day.trim().length > 0) {
    extended.time_of_day = parsed.time_of_day;
  }
  if (typeof parsed.fog_density === 'number' && Number.isFinite(parsed.fog_density)) {
    extended.fog_density = parsed.fog_density;
  }
  if (
    typeof parsed.terrain_height_scale === 'number' &&
    Number.isFinite(parsed.terrain_height_scale)
  ) {
    extended.terrain_height_scale = parsed.terrain_height_scale;
  }
  if (
    typeof parsed.meshy_character_prompt === 'string' &&
    parsed.meshy_character_prompt.trim().length > 0
  ) {
    extended.meshy_character_prompt = parsed.meshy_character_prompt;
  }
  if (
    typeof parsed.meshy_environment_prompt === 'string' &&
    parsed.meshy_environment_prompt.trim().length > 0
  ) {
    extended.meshy_environment_prompt = parsed.meshy_environment_prompt;
  }
  if (
    parsed.godot_environment_hints &&
    typeof parsed.godot_environment_hints === 'object' &&
    !Array.isArray(parsed.godot_environment_hints)
  ) {
    extended.godot_environment_hints = parsed.godot_environment_hints as Record<string, unknown>;
  }

  return { ...core, ...extended };
}

/**
 * Parse a raw unknown payload (typically from an LLM) into a strict
 * {@link GameConfig}. Never throws. On validation failure of the outer
 * structure, returns {@link buildFallback}`(dream)`. On per-field failures,
 * substitutes per-field fallbacks.
 */
export function parseGameConfig(raw: unknown, dream: string): GameConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return buildFallback(dream);
  }

  const result = gameConfigSchema.safeParse(raw);
  if (!result.success) {
    return buildFallback(dream);
  }

  const extended = buildExtended(result.data, dream);
  // Strip extended-only keys; downstream consumers that hold a `GameConfig`
  // reference rely on its exact shape (no extra optional keys).
  const {
    mood,
    style,
    genre,
    main_character,
    background,
    color_palette,
    narrative,
    goal,
    music_prompt,
    platforms,
    enemy_count,
  } = extended;
  return {
    mood,
    style,
    genre,
    main_character,
    background,
    color_palette,
    narrative,
    goal,
    music_prompt,
    platforms,
    enemy_count,
  };
}

/**
 * Same contract as {@link parseGameConfig} but preserves optional extended
 * fields (weather, time_of_day, fog_density, terrain_height_scale,
 * meshy_* prompts, godot_environment_hints). Use this when downstream code
 * (e.g. `/api/generate-3d`) needs the richer LLM payload.
 */
export function parseGameConfigExtended(raw: unknown, dream: string): ExtendedGameConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return buildFallback(dream);
  }

  const result = gameConfigSchema.safeParse(raw);
  if (!result.success) {
    return buildFallback(dream);
  }

  return buildExtended(result.data, dream);
}
