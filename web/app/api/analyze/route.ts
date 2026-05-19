import { NextRequest, NextResponse } from 'next/server';
import { buildFallback } from '@/lib/fallback-config';
import { parseGameConfigExtended } from '@/lib/game-config-schema';
import { badRequest, logApiError } from '@/lib/api-errors';

const LM_BASE_URL = process.env.QWEN_BASE_URL || 'http://localhost:1234';
const LM_MODEL = process.env.QWEN_MODEL || 'qwen3-coder-30b-a3b-instruct-mlx';

const MAX_DREAM_LENGTH = 5000;
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000;
const LLM_MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are DreamCraft AI — a cinematic dream-to-game director.

Convert the user's dream into a JSON configuration for a 3D platformer scene. Be poetic but concise.

Return ONLY valid JSON, no markdown, no explanation, no <think> tags. Exact schema:
{
  "mood": "one of: surreal_calm | dark_fantasy | cozy_dream | nightmare | cyber_dream | ethereal | whimsical | cosmic",
  "style": "one of: surreal | dark | cozy | nightmare | cyberpunk | watercolor | cosmic",
  "genre": "3d_platformer",
  "main_character": {
    "description": "3-5 word evocative character description",
    "color": "#hex — character emissive color"
  },
  "background": {
    "sky_color": "#hex — dark sky base",
    "ground_color": "#hex — terrain base"
  },
  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "narrative": "2 sentence poetic story tied to the dream. Vivid imagery.",
  "goal": "Poetic 5-8 word win condition",
  "music_prompt": "Music description: genre, BPM, mood, 8-12 words",
  "platforms": 7,
  "enemy_count": 3
}`;

interface LLMChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function POST(req: NextRequest) {
  // -------------------------------------------------------------------------
  // Phase 5: request validation
  // -------------------------------------------------------------------------

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return badRequest('Field "dream" is required and must be a string', { field: 'dream' });
  }

  const rawDream = (body as Record<string, unknown>).dream;
  if (typeof rawDream !== 'string') {
    return badRequest('Field "dream" is required and must be a string', { field: 'dream' });
  }

  const dream = rawDream.trim();
  if (dream.length === 0) {
    return badRequest('Dream cannot be empty', { field: 'dream' });
  }

  if (dream.length > MAX_DREAM_LENGTH) {
    return badRequest('Dream exceeds 5000 characters', {
      field: 'dream',
      max: MAX_DREAM_LENGTH,
      actual: dream.length,
    });
  }

  // -------------------------------------------------------------------------
  // Phase 2: LLM call + response normalization with graceful fallback
  // -------------------------------------------------------------------------

  try {
    const res = await fetch(`${LM_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LM_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Dream: "${dream}"\n\nGenerate the game configuration JSON. /no_think`,
          },
        ],
        temperature: 0.7,
        max_tokens: LLM_MAX_TOKENS,
        stream: false,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'game_config',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: [
                'mood', 'style', 'genre',
                'main_character', 'background', 'color_palette',
                'narrative', 'goal', 'music_prompt',
                'platforms', 'enemy_count',
              ],
              properties: {
                mood: { type: 'string', enum: ['surreal_calm','dark_fantasy','cozy_dream','nightmare','cyber_dream','ethereal','whimsical','cosmic'] },
                style: { type: 'string', enum: ['surreal','dark','cozy','nightmare','cyberpunk','watercolor','cosmic'] },
                genre: { type: 'string', const: '3d_platformer' },
                main_character: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['description', 'color'],
                  properties: {
                    description: { type: 'string' },
                    color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                  },
                },
                background: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['sky_color', 'ground_color'],
                  properties: {
                    sky_color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                    ground_color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                  },
                },
                color_palette: {
                  type: 'array',
                  minItems: 4, maxItems: 4,
                  items: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
                },
                narrative: { type: 'string' },
                goal: { type: 'string' },
                music_prompt: { type: 'string' },
                platforms: { type: 'integer', minimum: 5, maximum: 12 },
                enemy_count: { type: 'integer', minimum: 0, maximum: 8 },
              },
            },
          },
        },
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LM Studio error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as LLMChatResponse;
    const rawContent: string = data.choices?.[0]?.message?.content ?? '';

    let rawObj: unknown;
    try {
      rawObj = parseJsonFromLLM(rawContent);
    } catch (parseErr) {
      console.error('[analyze] JSON parse failed; raw content was:\n---\n%s\n---', rawContent.slice(0, 2000));
      throw parseErr;
    }
    const normalized = parseGameConfigExtended(rawObj, dream);
    return NextResponse.json(normalized, { status: 200 });
  } catch (err) {
    logApiError('analyze', err);
    // Graceful degradation: never crash the demo. `buildFallback` is canonical
    // and trusted, so no further normalization is required.
    return NextResponse.json(buildFallback(dream), { status: 200 });
  }
}

/**
 * Extract a JSON object from an LLM response string.
 *
 * Defense-in-depth: strips `<think>...</think>` blocks and markdown fences
 * even though the SYSTEM_PROMPT forbids them, then slices from the first `{`
 * to the last `}` and runs `JSON.parse`. May throw — callers must handle it.
 */
function parseJsonFromLLM(text: string): unknown {
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const cleaned = noThink.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in LLM response');
  return JSON.parse(cleaned.slice(start, end + 1));
}
