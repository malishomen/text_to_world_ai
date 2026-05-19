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
// eleven_multilingual_v2 — expressive, broadcast-quality, same per-char
// billing as Turbo v2.5. Picked over Turbo for "wow" demo quality after
// the prompt-engineering upgrade. Override per-call via the
// `ELEVENLABS_MODEL` env if you need to fall back.
const ELEVENLABS_MODEL_ID = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

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
// Voice cast per mood. Duplicates from the v1 plan eliminated — whimsical
// used to share Bella with cozy_dream which made the two demos sound
// identical, and surreal_calm shared Rachel with cyber_dream. The new
// cast gives every mood a recognisably different timbre/age/energy.
const VOICE_ID_BY_MOOD: Readonly<Record<Mood, string>> = {
  nightmare:    'pNInz6obpgDQGcFmaJgB', // Adam — deep American male, dread-capable
  dark_fantasy: 'ErXwobaYiN019PkySvjV', // Antoni — mid-male narrator, gothic
  cozy_dream:   'EXAVITQu4vr4xnSDxMaL', // Bella — warm, soft, bedtime-story
  cyber_dream:  '21m00Tcm4TlvDq8ikWAM', // Rachel — clear modern female, urgent
  cosmic:       '29vD33N1CtxCmqQRPOHJ', // Drew — calm male, slow wonder
  ethereal:     'AZnzlk1XvdvUeBnXmlld', // Domi — breathy female, light/glassy
  whimsical:    'MF3mGyEYCl7XYWbV9V6O', // Elli — young, expressive, playful (NEW)
  surreal_calm: 'CYw3kZ02Hs0563khs1Fj', // Dave — neutral British male storyteller (NEW)
};

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

// Per-mood voice settings — wider expressive range than the v1 plan.
// ElevenLabs voice_settings semantics:
//   stability        — lower (0.30-0.45) ⇒ more emotional variation, more
//                      breathy / unstable delivery. Higher (0.60-0.85) ⇒
//                      monotone, predictable, broadcast-news flat.
//                      For DRAMATIC moods we WANT instability.
//   style            — higher (0.45-0.70) ⇒ accent/emphasis exaggerated;
//                      reads as performative, theatrical. Higher than ~0.75
//                      starts distorting on Multilingual v2.
//   similarity_boost — kept at 0.75 across the cast (default).
//   use_speaker_boost — always on; reduces breath/sibilance artefacts.
function voiceSettingsForMood(mood: Mood): VoiceSettings {
  switch (mood) {
    case 'nightmare':
      // Whispered fear, breath in the voice.
      return { stability: 0.35, similarity_boost: 0.75, style: 0.65, use_speaker_boost: true };
    case 'dark_fantasy':
      // Gothic narrator with weight.
      return { stability: 0.42, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true };
    case 'cosmic':
      // Slow wonder, distant.
      return { stability: 0.45, similarity_boost: 0.75, style: 0.40, use_speaker_boost: true };
    case 'ethereal':
      // Light, wispy, almost-whispered.
      return { stability: 0.40, similarity_boost: 0.75, style: 0.50, use_speaker_boost: true };
    case 'cozy_dream':
      // Warm and soft; little drama, lots of cadence.
      return { stability: 0.55, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true };
    case 'cyber_dream':
      // Clipped, urgent, slightly mechanical.
      return { stability: 0.50, similarity_boost: 0.75, style: 0.40, use_speaker_boost: true };
    case 'whimsical':
      // Playful, varied, theatrical.
      return { stability: 0.42, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true };
    case 'surreal_calm':
      // Neutral wash — narrator presence without drama.
      return { stability: 0.50, similarity_boost: 0.75, style: 0.30, use_speaker_boost: true };
  }
}

// ---------------------------------------------------------------------------
// Prompt engineering — shape the input string so ElevenLabs reads with the
// pacing a mood deserves. Multilingual v2 takes pacing cues primarily from
// PUNCTUATION (commas, periods, ellipses, em-dashes). We don't use SSML
// because Multilingual v2 doesn't reliably honour <break> tags.
// ---------------------------------------------------------------------------

function engineerPromptForMood(text: string, mood: Mood): string {
  let t = text.trim();

  // "Slow" moods get an explicit pause inserted between sentences —
  // replace ". <Capital>" with "... <Capital>" so the narrator audibly
  // breathes between thoughts.
  const slow =
    mood === 'nightmare' ||
    mood === 'dark_fantasy' ||
    mood === 'cosmic' ||
    mood === 'ethereal' ||
    mood === 'surreal_calm';
  if (slow) {
    t = t.replace(/(\w)\.\s+([A-Z])/g, '$1... $2');
  }

  // "Lingering" moods get a trailing ellipsis instead of a period — leaves
  // the listener suspended at the end of the narration so the fade-in lands
  // on quiet space, not a hard full stop.
  const linger =
    mood === 'nightmare' ||
    mood === 'cosmic' ||
    mood === 'ethereal';
  if (linger) {
    // Only swap if narration already ends with a period and isn't already
    // ellipsis. The Unicode ellipsis is preserved if present.
    t = t.replace(/(\w)\.\s*$/, '$1…');
  }

  // "Urgent" moods get an em-dash break for the second sentence's opening —
  // forces a sharp narrative pivot rather than a settled period.
  // (Best-effort: only insert after the FIRST sentence's period.)
  if (mood === 'cyber_dream' || mood === 'whimsical') {
    let replaced = false;
    t = t.replace(/(\w)\.\s+([A-Z])/g, (_m, a: string, b: string) => {
      if (replaced) return `${a}. ${b}`;
      replaced = true;
      return `${a} — ${b}`;
    });
  }

  return t;
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
        text: engineerPromptForMood(narrative, mood),
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
