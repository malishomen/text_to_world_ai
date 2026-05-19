import * as path from 'node:path';
import * as os from 'node:os';
import {
  isSafeFilename,
  buildAssetUrl,
  buildAssetFsPath,
} from '@/lib/generated-paths';

describe('isSafeFilename', () => {
  describe('accepts safe filenames', () => {
    it("accepts 'background.png'", () => {
      expect(isSafeFilename('background.png')).toBe(true);
    });

    it("accepts 'character.glb'", () => {
      expect(isSafeFilename('character.glb')).toBe(true);
    });

    it("accepts 'foo-bar_baz.json'", () => {
      expect(isSafeFilename('foo-bar_baz.json')).toBe(true);
    });
  });

  describe('rejects unsafe filenames', () => {
    it("rejects '../etc/passwd' (traversal + slashes)", () => {
      expect(isSafeFilename('../etc/passwd')).toBe(false);
    });

    it("rejects '/abs/path.png' (absolute path)", () => {
      expect(isSafeFilename('/abs/path.png')).toBe(false);
    });

    it("rejects 'has space.png' (whitespace)", () => {
      expect(isSafeFilename('has space.png')).toBe(false);
    });

    it("rejects 'with\\0null.png' (null byte)", () => {
      expect(isSafeFilename('with\0null.png')).toBe(false);
    });

    it("rejects '.hidden.png' (leading dot)", () => {
      expect(isSafeFilename('.hidden.png')).toBe(false);
    });

    it('rejects strings longer than 64 chars', () => {
      expect(isSafeFilename('a'.repeat(65) + '.png')).toBe(false);
    });
  });

  describe('rejects non-string input', () => {
    it('rejects null', () => {
      expect(isSafeFilename(null)).toBe(false);
    });

    it('rejects a number', () => {
      expect(isSafeFilename(42)).toBe(false);
    });

    it('rejects an object', () => {
      expect(isSafeFilename({})).toBe(false);
    });
  });
});

describe('buildAssetUrl', () => {
  it('builds a 2d asset url', () => {
    expect(
      buildAssetUrl({ kind: '2d', generationId: 'abcd', filename: 'background.png' }),
    ).toBe('/generated/abcd/background.png');
  });

  it('builds a 3d asset url', () => {
    expect(
      buildAssetUrl({ kind: '3d', generationId: 'abcd', filename: 'character.glb' }),
    ).toBe('/generated3d/abcd/character.glb');
  });

  it('throws on invalid generationId', () => {
    expect(() =>
      buildAssetUrl({ kind: '2d', generationId: 'BAD!', filename: 'a.png' }),
    ).toThrow();
  });

  it('throws on unsafe filename', () => {
    expect(() =>
      buildAssetUrl({ kind: '2d', generationId: 'abcd', filename: '../evil.png' }),
    ).toThrow();
  });
});

describe('buildAssetFsPath', () => {
  const cwd = os.tmpdir();

  it('resolves a 2d asset path under <cwd>/public/generated/<id>/', () => {
    const got = buildAssetFsPath({
      cwd,
      kind: '2d',
      generationId: 'abcd',
      filename: 'file.png',
    });
    const expected = path.resolve(cwd, 'public', 'generated', 'abcd', 'file.png');
    expect(got).toBe(expected);
  });

  it('resolves a 3d asset path under <cwd>/public/generated3d/<id>/', () => {
    const got = buildAssetFsPath({
      cwd,
      kind: '3d',
      generationId: 'abcd',
      filename: 'model.glb',
    });
    const expected = path.resolve(cwd, 'public', 'generated3d', 'abcd', 'model.glb');
    expect(got).toBe(expected);
  });

  it("throws on '../../etc/passwd' path-escape even with valid generationId", () => {
    expect(() =>
      buildAssetFsPath({
        cwd,
        kind: '2d',
        generationId: 'abcd',
        filename: '../../etc/passwd',
      }),
    ).toThrow();
  });

  it("throws on '../foo'", () => {
    expect(() =>
      buildAssetFsPath({
        cwd,
        kind: '2d',
        generationId: 'abcd',
        filename: '../foo',
      }),
    ).toThrow();
  });

  it('throws on invalid generationId', () => {
    expect(() =>
      buildAssetFsPath({
        cwd,
        kind: '2d',
        generationId: 'BAD!',
        filename: 'file.png',
      }),
    ).toThrow();
  });
});

describe('Path security — explicit attack surface', () => {
  const cwd = os.tmpdir();
  // A known-valid generationId for cases where filename or cwd is the variable
  // under test. Format matches ID_PATTERN (lowercase + digits + dash).
  const validId = 'abcd-1234';

  describe('buildAssetFsPath — filename attack surface', () => {
    it("rejects classic '../../../etc/passwd' traversal", () => {
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: validId,
          filename: '../../../etc/passwd',
        }),
      ).toThrow();
    });

    it("rejects '.env' (leading dot)", () => {
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: validId,
          filename: '.env',
        }),
      ).toThrow();
    });

    it("rejects '.hidden' (leading dot, no extension)", () => {
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: validId,
          filename: '.hidden',
        }),
      ).toThrow();
    });

    it("rejects 'foo/bar.png' (forward-slash separator)", () => {
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: validId,
          filename: 'foo/bar.png',
        }),
      ).toThrow();
    });

    it("rejects 'foo\\bar.png' (backslash separator)", () => {
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: validId,
          filename: 'foo\\bar.png',
        }),
      ).toThrow();
    });

    it('rejects an oversized filename (65 chars)', () => {
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: validId,
          filename: 'a'.repeat(65),
        }),
      ).toThrow();
    });

    it('rejects a filename containing a null byte', () => {
      const naughty = 'foo' + String.fromCharCode(0) + 'bar.png';
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: validId,
          filename: naughty,
        }),
      ).toThrow();
    });
  });

  describe('buildAssetFsPath — generationId attack surface', () => {
    it("rejects '../../../etc' traversal in generationId", () => {
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: '../../../etc',
          filename: 'file.png',
        }),
      ).toThrow();
    });

    it("rejects '!!' (too short / wrong alphabet) generationId", () => {
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: '!!',
          filename: 'file.png',
        }),
      ).toThrow();
    });

    it("rejects 'BAD!!!' (uppercase + punctuation) raw generationId", () => {
      expect(() =>
        buildAssetFsPath({
          cwd,
          kind: '2d',
          generationId: 'BAD!!!',
          filename: 'file.png',
        }),
      ).toThrow();
    });
  });

  describe('buildAssetFsPath — cwd attack surface', () => {
    it("rejects missing cwd ('')", () => {
      expect(() =>
        buildAssetFsPath({
          cwd: '',
          kind: '2d',
          generationId: validId,
          filename: 'file.png',
        }),
      ).toThrow();
    });
  });

  describe('buildAssetFsPath — happy path sanity', () => {
    it('returns a path ending with <generationId>/<filename> for valid input', () => {
      const got = buildAssetFsPath({
        cwd,
        kind: '2d',
        generationId: validId,
        filename: 'background.png',
      });
      const tail = `${validId}${path.sep}background.png`;
      expect(got.endsWith(tail)).toBe(true);
    });
  });

  describe('buildAssetUrl — filename attack surface', () => {
    it("rejects '../foo' traversal", () => {
      expect(() =>
        buildAssetUrl({
          kind: '2d',
          generationId: validId,
          filename: '../foo',
        }),
      ).toThrow();
    });

    it("rejects '.env' (leading dot)", () => {
      expect(() =>
        buildAssetUrl({
          kind: '2d',
          generationId: validId,
          filename: '.env',
        }),
      ).toThrow();
    });

    it("rejects 'a/b' (slash separator)", () => {
      expect(() =>
        buildAssetUrl({
          kind: '2d',
          generationId: validId,
          filename: 'a/b',
        }),
      ).toThrow();
    });

    it('rejects an oversized filename (65 chars)', () => {
      expect(() =>
        buildAssetUrl({
          kind: '2d',
          generationId: validId,
          filename: 'a'.repeat(65),
        }),
      ).toThrow();
    });
  });

  describe('buildAssetUrl — generationId attack surface', () => {
    it("rejects 'BAD!' invalid generationId", () => {
      expect(() =>
        buildAssetUrl({
          kind: '2d',
          generationId: 'BAD!',
          filename: 'file.png',
        }),
      ).toThrow();
    });

    it("rejects '../etc' traversal in generationId", () => {
      expect(() =>
        buildAssetUrl({
          kind: '3d',
          generationId: '../etc',
          filename: 'file.glb',
        }),
      ).toThrow();
    });

    it("rejects empty-string generationId", () => {
      expect(() =>
        buildAssetUrl({
          kind: '2d',
          generationId: '',
          filename: 'file.png',
        }),
      ).toThrow();
    });
  });

  describe('buildAssetUrl — filename null-byte attack', () => {
    it('rejects a filename containing a null byte', () => {
      const naughty = 'foo' + String.fromCharCode(0) + 'bar.png';
      expect(() =>
        buildAssetUrl({
          kind: '2d',
          generationId: validId,
          filename: naughty,
        }),
      ).toThrow();
    });
  });

  describe('buildAssetUrl — happy path sanity', () => {
    it("returns '/generated/<id>/<filename>' for kind='2d'", () => {
      const got = buildAssetUrl({
        kind: '2d',
        generationId: validId,
        filename: 'background.png',
      });
      expect(got).toBe(`/generated/${validId}/background.png`);
    });

    it("returns '/generated3d/<id>/<filename>' for kind='3d'", () => {
      const got = buildAssetUrl({
        kind: '3d',
        generationId: validId,
        filename: 'character.glb',
      });
      expect(got).toBe(`/generated3d/${validId}/character.glb`);
    });
  });
});
