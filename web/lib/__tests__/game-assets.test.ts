import {
  isGameAssets,
  mergeAssetResponses,
  NO_ASSETS,
  type GameAssets,
} from '@/lib/game-assets';

// ---------------------------------------------------------------------------
// isGameAssets
// ---------------------------------------------------------------------------

describe('isGameAssets', () => {
  it('accepts a fully-valid GameAssets object', () => {
    const v: GameAssets = {
      background_2d: '/generated/abcd/bg.png',
      character_2d: '/generated/abcd/char.png',
      platform_2d: '/generated/abcd/platform.png',
      character_3d: '/generated3d/abcd/char.glb',
      prop_3d: '/generated3d/abcd/prop.glb',
      portal_3d: '/generated3d/abcd/portal.glb',
      hasAny: true,
    };
    expect(isGameAssets(v)).toBe(true);
  });

  it('accepts NO_ASSETS (all-null shape)', () => {
    expect(isGameAssets(NO_ASSETS)).toBe(true);
  });

  it('accepts a mixed shape with some null URLs', () => {
    const v: GameAssets = {
      background_2d: '/generated/abcd/bg.png',
      character_2d: null,
      platform_2d: null,
      character_3d: '/generated3d/abcd/c.glb',
      prop_3d: null,
      portal_3d: null,
      hasAny: true,
    };
    expect(isGameAssets(v)).toBe(true);
  });

  it('rejects null', () => {
    expect(isGameAssets(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isGameAssets(undefined)).toBe(false);
  });

  it('rejects a string', () => {
    expect(isGameAssets('not an object')).toBe(false);
  });

  it('rejects a number', () => {
    expect(isGameAssets(42)).toBe(false);
  });

  it("rejects when hasAny is the string 'true' instead of a boolean", () => {
    const bad = { ...NO_ASSETS, hasAny: 'true' as unknown as boolean };
    expect(isGameAssets(bad)).toBe(false);
  });

  it('rejects when a URL field is a non-string non-null value (number)', () => {
    const bad = { ...NO_ASSETS, background_2d: 42 as unknown as string | null };
    expect(isGameAssets(bad)).toBe(false);
  });

  it('rejects when a URL field is an empty string (length 0)', () => {
    const bad = { ...NO_ASSETS, background_2d: '' as string | null };
    expect(isGameAssets(bad)).toBe(false);
  });

  it('rejects when a URL field exceeds 512 chars', () => {
    const bad = { ...NO_ASSETS, background_2d: '/x/' + 'a'.repeat(512) };
    expect(isGameAssets(bad)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mergeAssetResponses
// ---------------------------------------------------------------------------

describe('mergeAssetResponses', () => {
  it('merges two fully-valid responses into all 6 URL fields with hasAny=true', () => {
    const two = {
      background_url: '/generated/abcd/bg.png',
      character_url: '/generated/abcd/char.png',
      platform_url: '/generated/abcd/p.png',
    };
    const three = {
      character_url: '/generated3d/abcd/char.glb',
      prop_url: '/generated3d/abcd/prop.glb',
      portal_url: '/generated3d/abcd/portal.glb',
    };
    const merged = mergeAssetResponses(two, three, 'abcd');
    expect(merged.background_2d).toBe('/generated/abcd/bg.png');
    expect(merged.character_2d).toBe('/generated/abcd/char.png');
    expect(merged.platform_2d).toBe('/generated/abcd/p.png');
    expect(merged.character_3d).toBe('/generated3d/abcd/char.glb');
    expect(merged.prop_3d).toBe('/generated3d/abcd/prop.glb');
    expect(merged.portal_3d).toBe('/generated3d/abcd/portal.glb');
    expect(merged.hasAny).toBe(true);
    expect(merged.generationId).toBe('abcd');
  });

  it('handles null 2D and valid 3D — 2D fields null, 3D fields populated', () => {
    const three = {
      character_url: '/generated3d/abcd/char.glb',
      prop_url: '/generated3d/abcd/prop.glb',
      portal_url: '/generated3d/abcd/portal.glb',
    };
    const merged = mergeAssetResponses(null, three, 'abcd');
    expect(merged.background_2d).toBe(null);
    expect(merged.character_2d).toBe(null);
    expect(merged.platform_2d).toBe(null);
    expect(merged.character_3d).toBe('/generated3d/abcd/char.glb');
    expect(merged.prop_3d).toBe('/generated3d/abcd/prop.glb');
    expect(merged.portal_3d).toBe('/generated3d/abcd/portal.glb');
    expect(merged.hasAny).toBe(true);
  });

  it('handles both undefined — all fields null, hasAny=false', () => {
    const merged = mergeAssetResponses(undefined, undefined);
    expect(merged.background_2d).toBe(null);
    expect(merged.character_2d).toBe(null);
    expect(merged.platform_2d).toBe(null);
    expect(merged.character_3d).toBe(null);
    expect(merged.prop_3d).toBe(null);
    expect(merged.portal_3d).toBe(null);
    expect(merged.hasAny).toBe(false);
  });

  it('treats empty strings as null', () => {
    const two = {
      background_url: '',
      character_url: '/generated/abcd/c.png',
      platform_url: '',
    };
    const merged = mergeAssetResponses(two, undefined, 'abcd');
    expect(merged.background_2d).toBe(null);
    expect(merged.character_2d).toBe('/generated/abcd/c.png');
    expect(merged.platform_2d).toBe(null);
    expect(merged.hasAny).toBe(true);
  });

  it('treats over-long strings (>= 512 chars) as null', () => {
    const two = {
      background_url: 'a'.repeat(512),
      character_url: 'a'.repeat(800),
      platform_url: '/ok.png',
    };
    const merged = mergeAssetResponses(two, undefined, 'abcd');
    expect(merged.background_2d).toBe(null);
    expect(merged.character_2d).toBe(null);
    expect(merged.platform_2d).toBe('/ok.png');
    expect(merged.hasAny).toBe(true);
  });

  it('treats non-string values as null', () => {
    const two = {
      background_url: 42,
      character_url: { not: 'a string' },
      platform_url: ['arr'],
    };
    const merged = mergeAssetResponses(two, undefined, 'abcd');
    expect(merged.background_2d).toBe(null);
    expect(merged.character_2d).toBe(null);
    expect(merged.platform_2d).toBe(null);
    expect(merged.hasAny).toBe(false);
  });

  it('omits generationId when none is supplied', () => {
    const merged = mergeAssetResponses(undefined, undefined);
    expect(merged.generationId).toBeUndefined();
  });

  it('returns a result that passes isGameAssets()', () => {
    const merged = mergeAssetResponses(
      { background_url: '/x.png' },
      { character_url: '/y.glb' },
      'abcd',
    );
    expect(isGameAssets(merged)).toBe(true);
  });
});
