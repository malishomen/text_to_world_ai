// Shared helpers for API route error responses and structured logging.
//
// Goals:
//  - One consistent JSON shape for client-facing errors.
//  - Never leak secrets through logs or response bodies.
//  - Allow "graceful degradation" responses (200 + fallback flag) when an
//    upstream is down but the client should still proceed.
//
// No I/O at import time, no env reads at module load — safe to import from
// any runtime (node, edge).

import { NextResponse } from 'next/server';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

/** 400 — request was malformed or failed client-side validation. */
export function badRequest(
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  const body: Record<string, unknown> = { error: message, ...(details ?? {}) };
  return NextResponse.json(body, { status: 400 });
}

/** 422 — request was syntactically OK but semantically rejected
 *  (e.g. body parsed but config failed a schema check). */
export function unprocessable(
  message: string,
  details?: Record<string, unknown>,
): NextResponse {
  const body: Record<string, unknown> = { error: message, ...(details ?? {}) };
  return NextResponse.json(body, { status: 422 });
}

/**
 * 200 with a graceful-degradation body. Used when an external service is down
 * but we still want the client to keep going (e.g. fall back to a canned
 * GameConfig). Adds `fallback: true` unless caller already set it.
 */
export function fallbackOk<T extends Record<string, unknown>>(
  body: T,
): NextResponse {
  const merged: Record<string, unknown> =
    'fallback' in body ? { ...body } : { ...body, fallback: true };
  return NextResponse.json(merged, { status: 200 });
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const REDACTED = '[REDACTED]';

// Match object keys that almost certainly hold a secret.
const SECRET_KEY_RE = /token|key|secret|password/i;

// Token shapes we know about in this project.
//  - hf_*           : HuggingFace user/org tokens.
//  - sk-...         : OpenAI / Anthropic style API keys (sk-<20+ chars>).
//  - Bearer <token> : Authorization headers.
const HF_TOKEN_RE = /hf_[A-Za-z0-9]+/g;
const SK_TOKEN_RE = /sk-[A-Za-z0-9]{20,}/g;
const BEARER_RE = /Bearer\s+[A-Za-z0-9._\-+/=]+/gi;

function redactString(s: string): string {
  return s
    .replace(BEARER_RE, `Bearer ${REDACTED}`)
    .replace(HF_TOKEN_RE, REDACTED)
    .replace(SK_TOKEN_RE, REDACTED);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively redact a value of common secret patterns.
 *  - Object keys matching token|key|secret|password → value becomes [REDACTED].
 *  - String values are scanned for hf_*, sk-..., and Bearer ... tokens; just
 *    the token portion is replaced.
 *  - Arrays are walked element-wise.
 *  - Numbers, booleans, null, undefined are returned unchanged.
 *  - Non-plain objects (Error, Date, Map, ...) are coerced to string and
 *    redacted as a string — we never mutate the input.
 */
export function redactSecrets<T>(value: T): T {
  return redactInternal(value) as T;
}

function redactInternal(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value;
  if (t === 'string') return redactString(value as string);

  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = redactInternal(v);
      }
    }
    return out;
  }

  // Errors, Dates, Maps, Sets, class instances — represent as a redacted
  // string rather than risk mutating or leaking internals.
  if (t === 'object') {
    try {
      return redactString(String(value));
    } catch {
      return REDACTED;
    }
  }

  // Functions, symbols — drop.
  return undefined;
}

// ---------------------------------------------------------------------------
// Error logging
// ---------------------------------------------------------------------------

interface ErrLike {
  message?: unknown;
  name?: unknown;
  stack?: unknown;
}

/**
 * Log an error with a label, redacting any field that looks like a secret.
 * Writes to console.error. Returns the sanitized `{ name, message }` so the
 * caller can include it in a structured response (without leaking the stack
 * or the original error to the client).
 */
export function logApiError(
  label: string,
  err: unknown,
): { message: string; name: string } {
  const e = (err ?? {}) as ErrLike;

  const rawMessage =
    typeof e.message === 'string' && e.message.length > 0
      ? e.message
      : String(err);
  const rawName =
    typeof e.name === 'string' && e.name.length > 0 ? e.name : 'Error';
  const rawStack = typeof e.stack === 'string' ? e.stack : undefined;

  const safe = redactSecrets({
    name: rawName,
    message: rawMessage,
    stack: rawStack,
  });

  console.error(`[${label}]`, safe);

  return { name: safe.name, message: safe.message };
}
