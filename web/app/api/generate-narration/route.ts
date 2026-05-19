// POST /api/generate-narration
//
// Turns LLM narrative text into a narrator-voice MP3 via ElevenLabs, with a
// "no-tts" fallback that never crashes the demo. See docs/PLAN_TIER_S.md §
// Phase 1 / Agent N and `.agent-tier-s-contract.md` for the frozen contract.
//
// Cache: if `web/public/generated-tts/<generationId>.mp3` already exists we
// return its URL without calling ElevenLabs (idempotent — supports the
// preset pre-generation step in Phase 0.4).
//
// Failure modes (NEVER 500 — always 200 with a sensible `source`):
//   - missing/empty ELEVENLABS_API_KEY → source: 'no-tts'
//   - ElevenLabs non-2xx               → source: 'no-tts'
//   - fetch threw / timed out          → source: 'no-tts'
//
// Only 400 path: malformed JSON body or invalid generationId (which would
// otherwise let an attacker walk the filesystem when we build the cache path).

import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { badRequest, logApiError } from '@/lib/api-errors';
import { isValidGenerationId } from '@/lib/generation-id';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_NARRATIVE_CHARS = 600;
const ELEVENLABS_TIMEOUT_MS = 60_000;
const ELEVENLABS_MODEL_ID = 'eleven_turbo_v2_5';

// 8-mood enum — must mirror `Mood` in web/lib/audio/AudioEngine.ts.
const MOODS = [
  'surreal_calm',
  'dark_fantasy',
  'cozy_dream',
  'nightmare',
  'cyber_dream',
  'ethereal',
  'whimsical',
  'cosmic',
] as const;
type Mood = (typeof MOODS)[number];
const DEFAULT_MOOD: Mood = 'surreal_calm';

// Voice IDs — ElevenLabs public-library defaults (stable across accounts).
// See `.agent-tier-s-contract.md` and docs/PLAN_TIER_S.md.
const VOICE_ID_BY_MOOD: Readonly<Record<Mood, string>> = {
  nightmare:    'pNInz6obpgDQGcFmaJgB', // Adam, deep male
  cozy_dream:   'EXAVITQu4vr4xnSDxMaL', // Bella, warm female
  cyber_dream:  '21m00Tcm4TlvDq8ikWAM', // Rachel, clear female
  cosmic:       '29vD33N1CtxCmqQRPOHJ', // Drew, calm male
  dark_fantasy: 'ErXwobaYiN019PkySvjV', // Antoni, narrator male
  ethereal:     'AZnzlk1XvdvUeBnXmlld', // Domi, breathy female
  whimsical:    'EXAVITQu4vr4xnSDxMaL', // Bella, playful female
  surreal_calm: '21m00Tcm4TlvDq8ikWAM', // Rachel, neutral
};

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

// Per-mood voice settings — tuned in the contract sheet.
function voiceSettingsForMood(mood: Mood): VoiceSettings {
  switch (mood) {
    case 'nightmare':
    case 'dark_fantasy':
      return { stability: 0.65, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true };
    case 'cozy_dream':
    case 'whimsical':
    case 'ethereal':
      return { stability: 0.50, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true };
    case 'cyber_dream':
    case 'cosmic':
    case 'surreal_calm':
      return { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true };
  }
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface NarrationResponse {
  audio_url: string | null;
  source: 'elevenlabs' | 'cached' | 'no-tts';
  durationSec: number | null;
}

function noTts(): NextResponse<NarrationResponse> {
  return NextResponse.json<NarrationResponse>(
    { audio_url: null, source: 'no-tts', durationSec: null },
    { status: 200 },
  );
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------

function isMood(v: unknown): v is Mood {
  return typeof v === 'string' && (MOODS as readonly string[]).includes(v);
}

function truncateNarrative(text: string): string {
  if (text.length <= MAX_NARRATIVE_CHARS) return text;
  // Reserve 1 char for the ellipsis so the final string is ≤ MAX_NARRATIVE_CHARS.
  return text.slice(0, MAX_NARRATIVE_CHARS - 1) + '…';
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // -- 1. Parse + validate body ---------------------------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('Invalid JSON body');
  }

  const rec = body as Record<string, unknown>;

  // narrative — required non-empty string; truncate (do NOT reject) if too long.
  const rawNarrative = rec.narrative;
  if (typeof rawNarrative !== 'string' || rawNarrative.trim().length === 0) {
    return badRequest('Field "narrative" is required and must be a non-empty string', {
      field: 'narrative',
    });
  }
  const narrative = truncateNarrative(rawNarrative.trim());

  // generationId — must be a valid id BEFORE we use it in a filesystem path.
  // This is the path-traversal guard.
  const rawId = rec.generationId;
  if (!isValidGenerationId(rawId)) {
    return badRequest('Invalid generationId', { field: 'generationId' });
  }
  const generationId: string = rawId;

  // mood — default to surreal_calm on unknown (DON'T reject).
  const mood: Mood = isMood(rec.mood) ? rec.mood : DEFAULT_MOOD;

  // -- 2. Cache hit ----------------------------------------------------------
  const ttsDir = path.join(process.cwd(), 'public', 'generated-tts');
  const filePath = path.join(ttsDir, `${generationId}.mp3`);
  const publicUrl = `/generated-tts/${generationId}.mp3`;

  if (fs.existsSync(filePath)) {
    return NextResponse.json<NarrationResponse>(
      { audio_url: publicUrl, source: 'cached', durationSec: null },
      { status: 200 },
    );
  }

  // -- 3. No key → no-tts (200) ---------------------------------------------
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.warn('[generate-narration] ELEVENLABS_API_KEY not set; returning no-tts');
    return noTts();
  }

  // -- 4. Call ElevenLabs ----------------------------------------------------
  const voiceId = VOICE_ID_BY_MOOD[mood];
  const voiceSettings = voiceSettingsForMood(mood);

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: narrative,
        model_id: ELEVENLABS_MODEL_ID,
        voice_settings: voiceSettings,
      }),
      signal: AbortSignal.timeout(ELEVENLABS_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Drain the body so we surface a useful (but bounded) message in logs.
      // ElevenLabs sends JSON error bodies; never include the api key in logs.
      let errText = '';
      try {
        errText = (await res.text()).slice(0, 500);
      } catch {
        /* ignore secondary read failure */
      }
      logApiError(
        'generate-narration',
        new Error(`ElevenLabs HTTP ${res.status}: ${errText}`),
      );
      return noTts();
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) {
      logApiError('generate-narration', new Error('ElevenLabs returned empty audio body'));
      return noTts();
    }

    // Ensure the directory exists, then write the MP3.
    fs.mkdirSync(ttsDir, { recursive: true });
    fs.writeFileSync(filePath, buf);

    return NextResponse.json<NarrationResponse>(
      { audio_url: publicUrl, source: 'elevenlabs', durationSec: null },
      { status: 200 },
    );
  } catch (err) {
    // Network error, abort/timeout, fs write failure — degrade gracefully.
    logApiError('generate-narration', err);
    return noTts();
  }
}
