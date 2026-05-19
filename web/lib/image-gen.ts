// Shared image-generation backends for /api/generate-3d and
// /api/generate-assets. Centralises the fal.ai FLUX-schnell adapter and
// the local A1111 fallback so prompt-engineering changes propagate
// consistently and provider-status checks live in one place.
//
// Backend dispatch is driven by SD_BACKEND env var:
//   'fal'    — fal.ai FLUX schnell ($0.005/image, ~1.5 s, no local GPU)
//   'a1111'  — local Automatic1111 WebUI at SD_BASE_URL (legacy)
//
// Failure semantics: NEVER throws. Returns Buffer | null. Callers decide
// whether null is fatal or degraded.

import { logApiError } from '@/lib/api-errors';

// ---------------------------------------------------------------------------
// Env (read once at module load — Next.js dev server hot-reloads the file
// when web/.env.local changes, so this is safe).
// ---------------------------------------------------------------------------

const SD_BACKEND  = (process.env.SD_BACKEND || 'a1111').toLowerCase();
const FAL_API_KEY = process.env.FAL_API_KEY || '';
const FAL_MODEL   = process.env.FAL_MODEL   || 'fal-ai/flux/schnell';
const SD_URL      = process.env.SD_BASE_URL || 'http://127.0.0.1:7860';

// ---------------------------------------------------------------------------
// Provider status — used by /api routes to short-circuit cleanly and by
// the UI to surface a "provider unavailable" badge if we ever expose one.
// ---------------------------------------------------------------------------

export type ImageGenBackend = 'fal' | 'a1111';
export type ImageGenStatus = 'available' | 'unavailable' | 'unknown';

export interface ImageGenProviderInfo {
  backend: ImageGenBackend;
  status: ImageGenStatus;
  reason?: string;
}

/** Cheap synchronous check — no network IO; returns 'unknown' if we'd need
 *  to probe to be sure. Callers that need certainty should call probe(). */
export function getImageGenProvider(): ImageGenProviderInfo {
  if (SD_BACKEND === 'fal') {
    if (!FAL_API_KEY) {
      return { backend: 'fal', status: 'unavailable', reason: 'FAL_API_KEY not set' };
    }
    return { backend: 'fal', status: 'available' };
  }
  return { backend: 'a1111', status: 'unknown', reason: 'requires probe' };
}

/** Network probe — adds latency. Use sparingly. */
export async function probeImageGen(): Promise<ImageGenProviderInfo> {
  const info = getImageGenProvider();
  if (info.backend === 'fal') return info; // no probe needed for paid REST API
  // a1111 probe
  try {
    const r = await fetch(`${SD_URL}/sdapi/v1/options`, {
      signal: AbortSignal.timeout(3000),
    });
    return r.ok
      ? { backend: 'a1111', status: 'available' }
      : { backend: 'a1111', status: 'unavailable', reason: `HTTP ${r.status}` };
  } catch (err) {
    return {
      backend: 'a1111',
      status: 'unavailable',
      reason: (err as Error)?.message ?? 'network error',
    };
  }
}

// ---------------------------------------------------------------------------
// Image-size hint — fal.ai accepts named presets (preferred) or
// {width, height}. A1111 takes raw width/height.
// ---------------------------------------------------------------------------

export interface ImageGenOptions {
  /** Free-form prompt. Caller does prompt engineering before passing. */
  prompt: string;
  /** Output shape. `square_hd` ≈ 1024×1024 on fal; the A1111 path maps to
   *  width/height accordingly. Other values pass through unchanged. */
  size?: 'square' | 'square_hd' | 'landscape_4_3' | 'portrait_4_3' | 'landscape_16_9';
  /** Per-call timeout. Defaults to 45 s for fal (typical ~1.5 s) and 90 s
   *  for A1111 (heavier samplers). */
  timeoutMs?: number;
  /** Logical asset slot — used only for log line clarity. */
  label?: string;
}

// ---------------------------------------------------------------------------
// fal.ai FLUX schnell
// ---------------------------------------------------------------------------

async function generateFalImage(opts: ImageGenOptions): Promise<Buffer | null> {
  if (!FAL_API_KEY) {
    console.warn('[image-gen/fal] FAL_API_KEY not set');
    return null;
  }
  const sizePreset = opts.size ?? 'square_hd';
  try {
    const res = await fetch(`https://fal.run/${FAL_MODEL}`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${FAL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: opts.prompt,
        image_size: sizePreset,
        num_inference_steps: 4,            // schnell is distilled for exactly 4
        num_images: 1,
        enable_safety_checker: false,      // game art legitimately has dark moods
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      logApiError(
        'image-gen/fal',
        new Error(`fal.ai HTTP ${res.status}: ${t.slice(0, 300)}`),
      );
      return null;
    }
    const data = (await res.json()) as { images?: Array<{ url?: string }> };
    const imgUrl = data?.images?.[0]?.url;
    if (!imgUrl) return null;
    const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(20_000) });
    if (!imgRes.ok) return null;
    return Buffer.from(await imgRes.arrayBuffer());
  } catch (err) {
    logApiError('image-gen/fal', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// A1111 (legacy) — kept for users who run a local SD WebUI.
// ---------------------------------------------------------------------------

function sizeToWH(size: ImageGenOptions['size']): { width: number; height: number } {
  switch (size) {
    case 'square':           return { width: 512,  height: 512 };
    case 'square_hd':        return { width: 1024, height: 1024 };
    case 'landscape_4_3':    return { width: 1024, height: 768 };
    case 'portrait_4_3':     return { width: 768,  height: 1024 };
    case 'landscape_16_9':   return { width: 1280, height: 720 };
    default:                 return { width: 512,  height: 512 };
  }
}

async function generateA1111Image(opts: ImageGenOptions): Promise<Buffer | null> {
  const { width, height } = sizeToWH(opts.size);
  try {
    const res = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: opts.prompt,
        negative_prompt:
          'blurry, text, watermark, multiple subjects, ugly, distorted',
        width,
        height,
        steps: 25,
        cfg_scale: 7.5,
        sampler_name: 'DPM++ 2M Karras',
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data.images?.[0];
    if (typeof b64 !== 'string' || b64.length === 0) return null;
    return Buffer.from(b64, 'base64');
  } catch (err) {
    logApiError('image-gen/a1111', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public dispatch — one call site for both endpoints.
// ---------------------------------------------------------------------------

export async function generateImage(opts: ImageGenOptions): Promise<Buffer | null> {
  if (SD_BACKEND === 'fal') return generateFalImage(opts);
  return generateA1111Image(opts);
}
