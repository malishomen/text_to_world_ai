import { buildFallback } from '@/lib/fallback-config';

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function isHex(s: string): boolean {
  if (!HEX_RE.test(s)) return false;
  const len = s.length - 1;
  return len === 3 || len === 4 || len === 6 || len === 8;
}

describe('buildFallback', () => {
  describe('genre invariant', () => {
    it('returns genre 3d_platformer for dark dreams', () => {
      expect(buildFallback('dark monster').genre).toBe('3d_platformer');
    });

    it('returns genre 3d_platformer for cozy dreams', () => {
      expect(buildFallback('forest cozy').genre).toBe('3d_platformer');
    });

    it('returns genre 3d_platformer for cyber dreams', () => {
      expect(buildFallback('neon cyber').genre).toBe('3d_platformer');
    });

    it('returns genre 3d_platformer for cosmic dreams', () => {
      expect(buildFallback('space stars').genre).toBe('3d_platformer');
    });

    it('returns genre 3d_platformer for default (surreal) dreams', () => {
      expect(buildFallback('whatever').genre).toBe('3d_platformer');
    });
  });

  describe('hex colors', () => {
    const samples = ['dark monster', 'forest cozy', 'neon cyber', 'space stars', 'whatever'];

    for (const sample of samples) {
      it(`returns valid hex for main_character.color (${sample})`, () => {
        const cfg = buildFallback(sample);
        expect(isHex(cfg.main_character.color)).toBe(true);
      });

      it(`returns valid hex for background.sky_color (${sample})`, () => {
        const cfg = buildFallback(sample);
        expect(isHex(cfg.background.sky_color)).toBe(true);
      });

      it(`returns valid hex for background.ground_color (${sample})`, () => {
        const cfg = buildFallback(sample);
        expect(isHex(cfg.background.ground_color)).toBe(true);
      });

      it(`returns valid hex for every color_palette entry (${sample})`, () => {
        const cfg = buildFallback(sample);
        for (const c of cfg.color_palette) {
          expect(isHex(c)).toBe(true);
        }
      });
    }
  });

  describe('numeric ranges', () => {
    const samples = ['dark monster', 'forest cozy', 'neon cyber', 'space stars', 'whatever'];

    for (const sample of samples) {
      it(`returns platforms as integer in [5, 12] for "${sample}"`, () => {
        const cfg = buildFallback(sample);
        expect(Number.isInteger(cfg.platforms)).toBe(true);
        expect(cfg.platforms).toBeGreaterThanOrEqual(5);
        expect(cfg.platforms).toBeLessThanOrEqual(12);
      });

      it(`returns enemy_count as integer in [0, 8] for "${sample}"`, () => {
        const cfg = buildFallback(sample);
        expect(Number.isInteger(cfg.enemy_count)).toBe(true);
        expect(cfg.enemy_count).toBeGreaterThanOrEqual(0);
        expect(cfg.enemy_count).toBeLessThanOrEqual(8);
      });
    }
  });

  describe('mood mapping', () => {
    it('maps "dark monster" → nightmare', () => {
      expect(buildFallback('dark monster').mood).toBe('nightmare');
    });

    it('maps "forest cozy" → cozy_dream', () => {
      expect(buildFallback('forest cozy').mood).toBe('cozy_dream');
    });

    it('maps "neon cyber" → cyber_dream', () => {
      expect(buildFallback('neon cyber').mood).toBe('cyber_dream');
    });

    it('maps "space stars" → cosmic', () => {
      expect(buildFallback('space stars').mood).toBe('cosmic');
    });

    it('maps "whatever" → surreal_calm', () => {
      expect(buildFallback('whatever').mood).toBe('surreal_calm');
    });
  });

  describe('narrative bounds', () => {
    it('truncates long dreams in narrative (default branch, cap ~100)', () => {
      const long = 'x'.repeat(500);
      const cfg = buildFallback(long);
      // Narrative should be bounded — won't include the full 500-char string.
      expect(cfg.narrative.length).toBeLessThan(500);
    });

    it('truncates long dreams in narrative (dark branch, cap ~80)', () => {
      const long = 'dark ' + 'x'.repeat(500);
      const cfg = buildFallback(long);
      expect(cfg.narrative.length).toBeLessThan(500);
    });
  });

  describe('robustness', () => {
    it('does not throw on empty string', () => {
      expect(() => buildFallback('')).not.toThrow();
    });

    it('does not throw on whitespace-only input', () => {
      expect(() => buildFallback('   \t \n ')).not.toThrow();
    });

    it('returns a config for empty string', () => {
      const cfg = buildFallback('');
      expect(cfg.genre).toBe('3d_platformer');
    });
  });
});
