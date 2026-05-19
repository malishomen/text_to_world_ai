import {
  parseGameConfig,
  parseGameConfigExtended,
  isValidHexColor,
} from '@/lib/game-config-schema';
import { buildFallback } from '@/lib/fallback-config';

describe('parseGameConfig', () => {
  const dream = 'whatever';

  describe('rejects non-object input', () => {
    it('returns fallback when raw is null', () => {
      expect(parseGameConfig(null, dream)).toEqual(buildFallback(dream));
    });

    it('returns fallback when raw is undefined', () => {
      expect(parseGameConfig(undefined, dream)).toEqual(buildFallback(dream));
    });

    it('returns fallback when raw is a number', () => {
      expect(parseGameConfig(42, dream)).toEqual(buildFallback(dream));
    });

    it('returns fallback when raw is a string', () => {
      expect(parseGameConfig('string', dream)).toEqual(buildFallback(dream));
    });

    it('returns fallback when raw is an array', () => {
      expect(parseGameConfig([], dream)).toEqual(buildFallback(dream));
    });
  });

  describe('valid config normalization', () => {
    it('returns a fully normalized config when all fields are valid', () => {
      const raw = {
        mood: 'cosmic',
        style: 'cosmic',
        genre: '3d_platformer',
        main_character: { description: 'Hero', color: '#abcdef' },
        background: { sky_color: '#123456', ground_color: '#abcdef' },
        color_palette: ['#111111', '#222222', '#333333', '#444444'],
        narrative: 'A long dream...',
        goal: 'Reach the end',
        music_prompt: 'ambient',
        platforms: 7,
        enemy_count: 3,
      };
      const cfg = parseGameConfig(raw, dream);
      expect(cfg.mood).toBe('cosmic');
      expect(cfg.style).toBe('cosmic');
      expect(cfg.genre).toBe('3d_platformer');
      expect(cfg.main_character).toEqual({ description: 'Hero', color: '#abcdef' });
      expect(cfg.background).toEqual({ sky_color: '#123456', ground_color: '#abcdef' });
      expect(cfg.color_palette).toEqual(['#111111', '#222222', '#333333', '#444444']);
      expect(cfg.narrative).toBe('A long dream...');
      expect(cfg.goal).toBe('Reach the end');
      expect(cfg.music_prompt).toBe('ambient');
      expect(cfg.platforms).toBe(7);
      expect(cfg.enemy_count).toBe(3);
    });
  });

  describe('bad hex colors are replaced with fallback', () => {
    const fb = buildFallback(dream);

    it('replaces bad main_character.color "red" with fallback', () => {
      const cfg = parseGameConfig({ main_character: { color: 'red' } }, dream);
      expect(cfg.main_character.color).toBe(fb.main_character.color);
    });

    it('replaces bad main_character.color "#zzz" with fallback', () => {
      const cfg = parseGameConfig({ main_character: { color: '#zzz' } }, dream);
      expect(cfg.main_character.color).toBe(fb.main_character.color);
    });

    it('replaces too-short hex "#12" with fallback', () => {
      const cfg = parseGameConfig({ main_character: { color: '#12' } }, dream);
      expect(cfg.main_character.color).toBe(fb.main_character.color);
    });
  });

  describe('genre is an unconditional 3d_platformer invariant', () => {
    // Hard invariant (agent.md § 1.6 / memory.md § 1.3): the game IS 3D.
    // `normalizeGenre` returns '3d_platformer' regardless of input. These cases
    // assert that no value supplied by the LLM can ever produce a non-3D genre.

    it("returns '3d_platformer' when raw genre is 'rpg'", () => {
      const cfg = parseGameConfig({ genre: 'rpg' }, dream);
      expect(cfg.genre).toBe('3d_platformer');
    });

    it("returns '3d_platformer' when raw genre is 'shooter'", () => {
      const cfg = parseGameConfig({ genre: 'shooter' }, dream);
      expect(cfg.genre).toBe('3d_platformer');
    });

    it("returns '3d_platformer' when raw genre is '2d_platformer'", () => {
      const cfg = parseGameConfig({ genre: '2d_platformer' }, dream);
      expect(cfg.genre).toBe('3d_platformer');
    });

    it("returns '3d_platformer' when raw genre is an empty string", () => {
      const cfg = parseGameConfig({ genre: '' }, dream);
      expect(cfg.genre).toBe('3d_platformer');
    });

    it("returns '3d_platformer' when raw genre is missing (undefined)", () => {
      const cfg = parseGameConfig({}, dream);
      expect(cfg.genre).toBe('3d_platformer');
    });

    it("returns '3d_platformer' when raw genre is null", () => {
      const cfg = parseGameConfig({ genre: null }, dream);
      expect(cfg.genre).toBe('3d_platformer');
    });

    it("returns '3d_platformer' when raw genre is the number 42", () => {
      const cfg = parseGameConfig({ genre: 42 }, dream);
      expect(cfg.genre).toBe('3d_platformer');
    });
  });

  describe('platforms clamping', () => {
    it('clamps platforms = 100 to 12', () => {
      const cfg = parseGameConfig({ platforms: 100 }, dream);
      expect(cfg.platforms).toBe(12);
    });

    it('clamps platforms = 0 to 5', () => {
      const cfg = parseGameConfig({ platforms: 0 }, dream);
      expect(cfg.platforms).toBe(5);
    });

    it('rounds and clamps platforms = 3.7 (rounds to 4, clamps to 5)', () => {
      const cfg = parseGameConfig({ platforms: 3.7 }, dream);
      expect(cfg.platforms).toBe(5);
    });
  });

  describe('enemy_count clamping', () => {
    it('clamps enemy_count = -5 to 0', () => {
      const cfg = parseGameConfig({ enemy_count: -5 }, dream);
      expect(cfg.enemy_count).toBe(0);
    });

    it('clamps enemy_count = 999 to 8', () => {
      const cfg = parseGameConfig({ enemy_count: 999 }, dream);
      expect(cfg.enemy_count).toBe(8);
    });
  });

  describe('color_palette normalization', () => {
    const fb = buildFallback(dream);

    it('replaces fully-invalid palette with fallback (4 entries)', () => {
      const cfg = parseGameConfig({ color_palette: ['red', '#zzz', 'blue', 'green'] }, dream);
      expect(cfg.color_palette).toEqual(fb.color_palette);
      expect(cfg.color_palette.length).toBe(4);
    });

    it('keeps valid entries and drops invalid in mixed palette', () => {
      const cfg = parseGameConfig(
        { color_palette: ['#111111', 'red', '#222222', 'blue'] },
        dream,
      );
      expect(cfg.color_palette).toEqual(['#111111', '#222222']);
    });
  });
});

describe('isValidHexColor', () => {
  describe('accepts canonical hex formats', () => {
    it("accepts '#fff' (3 hex digits)", () => {
      expect(isValidHexColor('#fff')).toBe(true);
    });

    it("accepts '#ffff' (4 hex digits)", () => {
      expect(isValidHexColor('#ffff')).toBe(true);
    });

    it("accepts '#ffffff' (6 hex digits)", () => {
      expect(isValidHexColor('#ffffff')).toBe(true);
    });

    it("accepts '#ffffffff' (8 hex digits)", () => {
      expect(isValidHexColor('#ffffffff')).toBe(true);
    });
  });

  describe('rejects malformed strings', () => {
    it("rejects 'fff' (no leading #)", () => {
      expect(isValidHexColor('fff')).toBe(false);
    });

    it("rejects '#zzz' (non-hex chars)", () => {
      expect(isValidHexColor('#zzz')).toBe(false);
    });

    it("rejects '#12345' (5 hex digits — not canonical)", () => {
      expect(isValidHexColor('#12345')).toBe(false);
    });

    it("rejects '' (empty string)", () => {
      expect(isValidHexColor('')).toBe(false);
    });
  });

  describe('rejects non-string input', () => {
    it('rejects null', () => {
      expect(isValidHexColor(null)).toBe(false);
    });

    it('rejects a number', () => {
      expect(isValidHexColor(123)).toBe(false);
    });
  });
});

describe('parseGameConfigExtended', () => {
  const dream = 'whatever';

  it('preserves all extended fields when the raw payload provides them', () => {
    const raw = {
      mood: 'cosmic',
      style: 'cosmic',
      genre: '3d_platformer',
      main_character: { description: 'Hero', color: '#abcdef' },
      background: { sky_color: '#123456', ground_color: '#abcdef' },
      color_palette: ['#111111', '#222222', '#333333', '#444444'],
      narrative: 'A long dream...',
      goal: 'Reach the end',
      music_prompt: 'ambient',
      platforms: 7,
      enemy_count: 3,
      meshy_character_prompt: 'glowing wanderer',
      meshy_environment_prompt: 'crystal cave',
      weather: 'storm',
      time_of_day: 'twilight',
      fog_density: 0.42,
      terrain_height_scale: 1.5,
      godot_environment_hints: { fog_color: '#abcdef', sun_angle: 30 },
    };
    const cfg = parseGameConfigExtended(raw, dream);
    expect(cfg.meshy_character_prompt).toBe('glowing wanderer');
    expect(cfg.meshy_environment_prompt).toBe('crystal cave');
    expect(cfg.weather).toBe('storm');
    expect(cfg.time_of_day).toBe('twilight');
    expect(cfg.fog_density).toBe(0.42);
    expect(cfg.terrain_height_scale).toBe(1.5);
    expect(cfg.godot_environment_hints).toEqual({
      fog_color: '#abcdef',
      sun_angle: 30,
    });
  });

  it('omits all extended fields when the raw payload does not provide them', () => {
    const cfg = parseGameConfigExtended({ mood: 'cozy' }, dream);
    expect(cfg.meshy_character_prompt).toBeUndefined();
    expect(cfg.meshy_environment_prompt).toBeUndefined();
    expect(cfg.weather).toBeUndefined();
    expect(cfg.time_of_day).toBeUndefined();
    expect(cfg.fog_density).toBeUndefined();
    expect(cfg.terrain_height_scale).toBeUndefined();
    expect(cfg.godot_environment_hints).toBeUndefined();
    expect('meshy_character_prompt' in cfg).toBe(false);
    expect('weather' in cfg).toBe(false);
  });

  it('treats an empty meshy_character_prompt as absent', () => {
    const cfg = parseGameConfigExtended({ meshy_character_prompt: '' }, dream);
    expect(cfg.meshy_character_prompt).toBeUndefined();
    expect('meshy_character_prompt' in cfg).toBe(false);
  });

  it('treats a whitespace-only meshy_character_prompt as absent', () => {
    const cfg = parseGameConfigExtended({ meshy_character_prompt: '   ' }, dream);
    expect(cfg.meshy_character_prompt).toBeUndefined();
    expect('meshy_character_prompt' in cfg).toBe(false);
  });

  it('drops godot_environment_hints when it is an array (not an object)', () => {
    const cfg = parseGameConfigExtended(
      { godot_environment_hints: [1, 2, 3] },
      dream,
    );
    expect(cfg.godot_environment_hints).toBeUndefined();
    expect('godot_environment_hints' in cfg).toBe(false);
  });

  it('produces identical base fields to parseGameConfig for the same raw payload', () => {
    const raw = {
      mood: 'cyber_dream',
      style: 'cyberpunk',
      genre: '2d_platformer', // normalised to 3d_platformer either way
      main_character: { description: 'Neon Hacker', color: '#06b6d4' },
      background: { sky_color: '#000a1a', ground_color: '#0a1a2a' },
      color_palette: ['#06b6d4', '#0891b2', '#0e7490', '#000a1a'],
      narrative: 'Deep in the digital dream',
      goal: 'Reach the source code',
      music_prompt: 'synthwave',
      platforms: 9,
      enemy_count: 4,
      // Extended-only key should NOT affect base parity.
      weather: 'rain',
    };
    const base = parseGameConfig(raw, dream);
    const extended = parseGameConfigExtended(raw, dream);

    expect(extended.mood).toBe(base.mood);
    expect(extended.style).toBe(base.style);
    expect(extended.genre).toBe(base.genre);
    expect(extended.main_character).toEqual(base.main_character);
    expect(extended.background).toEqual(base.background);
    expect(extended.color_palette).toEqual(base.color_palette);
    expect(extended.narrative).toBe(base.narrative);
    expect(extended.goal).toBe(base.goal);
    expect(extended.music_prompt).toBe(base.music_prompt);
    expect(extended.platforms).toBe(base.platforms);
    expect(extended.enemy_count).toBe(base.enemy_count);
  });

  it('returns buildFallback(dream) on non-object input (null/42/string/array)', () => {
    const fb = buildFallback(dream);
    expect(parseGameConfigExtended(null, dream)).toEqual(fb);
    expect(parseGameConfigExtended(42, dream)).toEqual(fb);
    expect(parseGameConfigExtended('string', dream)).toEqual(fb);
    expect(parseGameConfigExtended([], dream)).toEqual(fb);
  });
});
