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
