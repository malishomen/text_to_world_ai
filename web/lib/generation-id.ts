// Pure helpers for working with a `generationId` — the opaque token that
// isolates a single user dream/generation's assets from every other run.
//
// No I/O, no Next.js APIs, no `node:` imports — safe to import from anywhere
// (server, edge, tests).
//
// Allowed alphabet: lowercase letters, digits, dash. Length 4..64.
// Cannot start or end with `-`. No double-dashes.

/**
 * Allowed alphabet for a generationId: lowercase letters, digits, dash.
 * Length: between 4 and 64 characters inclusive.
 * Cannot start or end with a dash. No double-dashes.
 */
export const ID_PATTERN: RegExp =
  /^(?!.*--)[a-z0-9](?:[a-z0-9-]{2,62}[a-z0-9])$/;

// Brand-style nominal type — useful for downstream modules that want the
// type system to remember "this string has been validated".
export type ValidGenerationId = string & { readonly __brand: 'GenerationId' };

/** True if the input is a string and matches ID_PATTERN. */
export function isValidGenerationId(id: unknown): id is ValidGenerationId {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/**
 * Try to convert arbitrary input to a valid generationId.
 * Lowercases, replaces any disallowed char with '-', collapses runs of '-',
 * trims '-' from start/end, then validates. Returns null if the result is
 * still invalid (e.g. too short, or empty after sanitisation).
 */
export function normalizeGenerationId(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-') // disallowed chars → single dash
    .replace(/-+/g, '-')           // collapse runs of '-'
    .replace(/^-+/, '')            // trim leading dashes
    .replace(/-+$/, '');           // trim trailing dashes

  return isValidGenerationId(cleaned) ? cleaned : null;
}

/**
 * Generate a fresh generationId.
 * Format: yyyymmdd-hhmmss-<8 hex chars>  (always 23 characters, always valid).
 *
 * Uses `crypto.randomUUID()` when available (browser + Node 19+) and reuses
 * its first 8 hex chars as the entropy suffix. Falls back to
 * `Math.random()` if no `crypto.randomUUID` is present.
 */
export function newGenerationId(): string {
  const now = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const ymd =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`;
  const hms =
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

  let suffix: string;
  // Defensive: globalThis.crypto may be undefined in odd runtimes.
  const c: { randomUUID?: () => string } | undefined =
    (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') {
    // UUID v4 starts with 8 hex chars before the first '-'. Lowercase already.
    suffix = c.randomUUID().replace(/-/g, '').slice(0, 8).toLowerCase();
  } else {
    // Fallback: 8 hex chars from Math.random (not cryptographically strong,
    // but adequate as a uniqueness suffix paired with a UTC timestamp).
    suffix = Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  }

  const id = `${ymd}-${hms}-${suffix}`;
  // Sanity check — should always pass given the construction above.
  /* istanbul ignore next */
  if (!isValidGenerationId(id)) {
    throw new Error(`newGenerationId produced invalid id: ${id}`);
  }
  return id;
}
