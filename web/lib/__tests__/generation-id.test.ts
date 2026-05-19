import {
  isValidGenerationId,
  normalizeGenerationId,
  newGenerationId,
} from '@/lib/generation-id';

describe('isValidGenerationId', () => {
  describe('accepts valid ids', () => {
    it("accepts 'abcd' (min length 4)", () => {
      expect(isValidGenerationId('abcd')).toBe(true);
    });

    it("accepts '20260519-120000-deadbeef' (canonical format)", () => {
      expect(isValidGenerationId('20260519-120000-deadbeef')).toBe(true);
    });

    it("accepts 'a1b2-c3d4' (mixed alpha/digits/dashes)", () => {
      expect(isValidGenerationId('a1b2-c3d4')).toBe(true);
    });

    it('accepts max length (64 chars)', () => {
      expect(isValidGenerationId('a'.repeat(64))).toBe(true);
    });
  });

  describe('rejects non-string input', () => {
    it('rejects a number', () => {
      expect(isValidGenerationId(123)).toBe(false);
    });

    it('rejects null', () => {
      expect(isValidGenerationId(null)).toBe(false);
    });

    it('rejects an object', () => {
      expect(isValidGenerationId({})).toBe(false);
    });

    it('rejects an array', () => {
      expect(isValidGenerationId([])).toBe(false);
    });
  });

  describe('rejects malformed ids', () => {
    it('rejects strings shorter than 4', () => {
      expect(isValidGenerationId('abc')).toBe(false);
    });

    it('rejects strings longer than 64', () => {
      expect(isValidGenerationId('a'.repeat(65))).toBe(false);
    });

    it('rejects uppercase letters', () => {
      expect(isValidGenerationId('Abcd')).toBe(false);
    });

    it('rejects underscores', () => {
      expect(isValidGenerationId('a_bc')).toBe(false);
    });

    it("rejects leading '-'", () => {
      expect(isValidGenerationId('-abc')).toBe(false);
    });

    it("rejects trailing '-'", () => {
      expect(isValidGenerationId('abc-')).toBe(false);
    });

    it("rejects double-dashes '--'", () => {
      expect(isValidGenerationId('ab--cd')).toBe(false);
    });

    it('rejects spaces', () => {
      expect(isValidGenerationId('ab cd')).toBe(false);
    });
  });
});

describe('normalizeGenerationId', () => {
  it("normalizes 'AbCd' → 'abcd'", () => {
    expect(normalizeGenerationId('AbCd')).toBe('abcd');
  });

  it("normalizes 'foo_bar' → 'foo-bar'", () => {
    expect(normalizeGenerationId('foo_bar')).toBe('foo-bar');
  });

  it("normalizes '--a-b--' → null (too short after cleanup: 'a-b' is 3 chars)", () => {
    // Cleanup: trim leading/trailing dashes & collapse → 'a-b' (length 3).
    // Validation requires min length 4, so result is null.
    expect(normalizeGenerationId('--a-b--')).toBe(null);
  });

  it("normalizes '!!' → null (too short after cleanup)", () => {
    expect(normalizeGenerationId('!!')).toBe(null);
  });

  it('returns null for non-string input', () => {
    expect(normalizeGenerationId(123)).toBe(null);
    expect(normalizeGenerationId(null)).toBe(null);
    expect(normalizeGenerationId(undefined)).toBe(null);
    expect(normalizeGenerationId({})).toBe(null);
  });
});

describe('newGenerationId', () => {
  it('returns a string that passes isValidGenerationId', () => {
    const id = newGenerationId();
    expect(typeof id).toBe('string');
    expect(isValidGenerationId(id)).toBe(true);
  });

  it('returns different ids on consecutive calls', () => {
    const id1 = newGenerationId();
    const id2 = newGenerationId();
    expect(id1).not.toBe(id2);
  });
});
