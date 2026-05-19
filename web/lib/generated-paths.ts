// Path helpers for generated assets (2D images and 3D models).
//
// Each generation gets its own subdirectory keyed by `generationId` so
// concurrent runs cannot stomp on each other and we can clean up by id.
//
// Layout (relative to the Next.js project root):
//   public/generated/<id>/...      <-- 2D assets (png, jpg, webp)
//   public/generated3d/<id>/...    <-- 3D assets (glb, gltf)
//
// SECURITY: all path-building functions defensively reject unsafe filenames
// or invalid generationIds, and `buildAssetFsPath` asserts that the resolved
// path stays inside the expected root (prevents `../../etc/passwd` escapes).

import * as path from 'node:path';
import * as fs from 'node:fs';

import { isValidGenerationId } from './generation-id';

/**
 * The two top-level public directories where generated assets live,
 * relative to web/public/.
 */
export const ASSETS_2D_ROOT = 'generated' as const;
export const ASSETS_3D_ROOT = 'generated3d' as const;

export type AssetKind = '2d' | '3d';

const FILENAME_PATTERN = /^[a-z0-9._-]+$/i;
const MAX_FILENAME_LEN = 64;

/**
 * Sanity check on a filename — only allows `[a-z0-9._-]+`, max 64 chars,
 * no leading '.', no '..' anywhere, no slashes, no backslashes, no null bytes.
 */
export function isSafeFilename(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  if (s.length === 0 || s.length > MAX_FILENAME_LEN) return false;
  if (s.startsWith('.')) return false;
  if (s.includes('..')) return false;
  // Defence in depth — these should already be excluded by the pattern,
  // but be explicit so a future regex change cannot silently weaken security.
  if (s.includes('/') || s.includes('\\') || s.includes('\0')) return false;
  return FILENAME_PATTERN.test(s);
}

function rootDirFor(kind: AssetKind): typeof ASSETS_2D_ROOT | typeof ASSETS_3D_ROOT {
  if (kind === '2d') return ASSETS_2D_ROOT;
  if (kind === '3d') return ASSETS_3D_ROOT;
  throw new Error(`Unknown asset kind: ${String(kind)}`);
}

/**
 * Build a server-side absolute filesystem path for an asset.
 *  - cwd: usually `process.cwd()` (caller passes it explicitly — keeps this
 *    module pure-testable).
 *  - kind: '2d' | '3d'
 *  - generationId: must already be validated; we re-validate defensively.
 *  - filename: simple basename, no slashes, no '..' segments.
 *
 * Returns an absolute path **guaranteed to be inside** cwd/public/<root>/<id>.
 * Throws if the resolved path escapes that root.
 */
export function buildAssetFsPath(args: {
  cwd: string;
  kind: AssetKind;
  generationId: string;
  filename: string;
}): string {
  const { cwd, kind, generationId, filename } = args;

  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('buildAssetFsPath: cwd is required');
  }
  if (!isValidGenerationId(generationId)) {
    throw new Error(`buildAssetFsPath: invalid generationId: ${String(generationId)}`);
  }
  if (!isSafeFilename(filename)) {
    throw new Error(`buildAssetFsPath: unsafe filename: ${String(filename)}`);
  }

  const root = rootDirFor(kind);

  // The root that everything *must* stay under, resolved once.
  const rootResolved = path.resolve(cwd, 'public', root, generationId);

  // The candidate path. We re-resolve after joining the filename so that
  // any traversal sequence inside `filename` (defence in depth — we already
  // rejected '..') would surface as a path outside `rootResolved`.
  const candidate = path.resolve(rootResolved, filename);

  // `startsWith(rootResolved + path.sep)` ensures the candidate is a strict
  // descendant of rootResolved — not the root itself, and not a sibling
  // whose name happens to share a common prefix.
  if (!candidate.startsWith(rootResolved + path.sep)) {
    throw new Error(
      `buildAssetFsPath: resolved path escapes root (filename=${filename})`,
    );
  }

  return candidate;
}

/**
 * Build the public web URL for an asset (what the client uses in `<img src>`
 * or `<model-viewer src>`).
 * Returns e.g. `/generated/<id>/background.png` or
 * `/generated3d/<id>/character.glb`.
 * Throws on invalid generationId or unsafe filename.
 */
export function buildAssetUrl(args: {
  kind: AssetKind;
  generationId: string;
  filename: string;
}): string {
  const { kind, generationId, filename } = args;

  if (!isValidGenerationId(generationId)) {
    throw new Error(`buildAssetUrl: invalid generationId: ${String(generationId)}`);
  }
  if (!isSafeFilename(filename)) {
    throw new Error(`buildAssetUrl: unsafe filename: ${String(filename)}`);
  }

  const root = rootDirFor(kind);
  // Always forward slashes — this is a URL, not a filesystem path.
  return `/${root}/${generationId}/${filename}`;
}

/**
 * Ensure the directory for a given generationId exists. Uses
 * `fs.mkdirSync(..., { recursive: true })`. Safe to call multiple times.
 * Returns the directory's absolute path.
 */
export function ensureAssetDir(args: {
  cwd: string;
  kind: AssetKind;
  generationId: string;
}): string {
  const { cwd, kind, generationId } = args;

  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new Error('ensureAssetDir: cwd is required');
  }
  if (!isValidGenerationId(generationId)) {
    throw new Error(`ensureAssetDir: invalid generationId: ${String(generationId)}`);
  }

  const root = rootDirFor(kind);
  const dir = path.resolve(cwd, 'public', root, generationId);

  // Defence in depth: confirm dir is still under cwd/public/<root>.
  const rootResolved = path.resolve(cwd, 'public', root);
  if (
    dir !== rootResolved &&
    !dir.startsWith(rootResolved + path.sep)
  ) {
    throw new Error(`ensureAssetDir: resolved dir escapes root: ${dir}`);
  }

  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
