import { NextRequest, NextResponse } from 'next/server';
import { buildFallback } from '@/lib/fallback-config';
import { parseGameConfigExtended } from '@/lib/game-config-schema';
import { badRequest, logApiError } from '@/lib/api-errors';

const LM_BASE_URL = process.env.QWEN_BASE_URL || 'http://localhost:1234';
const LM_MODEL = process.env.QWEN_MODEL || 'qwen3-coder-30b-a3b-instruct-mlx';

const MAX_DREAM_LENGTH = 5000;
const LLM_TIMEOUT_MS = 25000;
const LLM_MAX_TOKENS = 1500;

const SYSTEM_PROMPT = `You are DreamCraft AI — a cinematic game director converting dreams into AAA 3D game configurations.

Analyze the dream deeply: extract mood, atmosphere, color palette, key visual symbols, emotional tone.
Output a rich JSON configuration that drives a Godot 4 Forward+ (Vulkan) game with realistic lighting.

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no <think> tags. Exact schema:
{
  "mood": "one of: surreal_calm | dark_fantasy | cozy_dream | nightmare | cyber_dream | ethereal | whimsical | cosmic",
  "style": "one of: surreal | dark | cozy | nightmare | cyberpunk | watercolor | cosmic",
  "genre": "3d_platformer",
  "main_character": {
    "description": "3-5 word evocative character description for 3D model prompt",
    "color": "#hexcolor — main character emissive/albedo color"
  },
  "background": {
    "sky_color": "#hexcolor — dark sky base color",
    "ground_color": "#hexcolor — terrain low-level color"
  },
  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "narrative": "2-3 sentence poetic story. Sets the scene. Appears in loading screen.",
  "goal": "Poetic 8-word win condition shown as HUD objective",
  "music_prompt": "Detailed music description: genre, BPM, instruments, emotion, 10-15 words",
  "platforms": 8,
  "enemy_count": 4,
  "weather": "one of: clear | rain | storm | light_fog",
  "time_of_day": "one of: dawn | day | dusk | night | deep_night",
  "fog_density": 0.02,
  "terrain_height_scale": 18.0,
  "meshy_character_prompt": "Detailed Meshy.ai text-to-3D prompt for the character model, 15-25 words",
  "meshy_environment_prompt": "Detailed Meshy.ai prompt for a key environment prop, 15-25 words",
  "godot_environment_hints": {
    "sdfgi_energy": 1.2,
    "bloom_intensity": 1.0,
    "volumetric_fog_density": 0.02,
    "dof_far_distance": 80.0,
    "exposure": 1.1,
    "saturation": 1.1,
    "contrast": 1.05
  }
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
            content: `Dream: "${dream}"\n\nGenerate the game configuration JSON.`,
          },
        ],
        temperature: 0.7,
        max_tokens: LLM_MAX_TOKENS,
        stream: false,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LM Studio error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as LLMChatResponse;
    const rawContent: string = data.choices?.[0]?.message?.content ?? '';

    const rawObj = parseJsonFromLLM(rawContent);
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
