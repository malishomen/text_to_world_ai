import { parseGameConfig, isValidHexColor } from '@/lib/game-config-schema';
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

  describe('genre normalization', () => {
    it('normalizes 2d_platformer to 3d_platformer', () => {
      const cfg = parseGameConfig({ genre: '2d_platformer' }, dream);
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
