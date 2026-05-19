import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import {
  normalizeGenerationId,
  newGenerationId,
} from '@/lib/generation-id';
import {
  buildAssetFsPath,
  buildAssetUrl,
  ensureAssetDir,
  isSafeFilename,
} from '@/lib/generated-paths';
import { badRequest, fallbackOk, logApiError } from '@/lib/api-errors';

// LLaMA-Mesh runs in the SAME LM Studio server as the analysis LLM
// (multi-model loading, LM Studio 0.4+). Defaults match QWEN_BASE_URL.
const LM_BASE_URL = process.env.QWEN_BASE_URL || 'http://localhost:1234';
const MESH_MODEL  = process.env.MESH_MODEL    || 'llama-mesh';

// LLaMA-Mesh emits OBJ token-by-token. ~50-200 vertices + faces fit in 3000
// tokens; bumping higher just wastes time on slower hardware.
const MESH_TIMEOUT_MS = Number(process.env.MESH_TIMEOUT_MS) || 120000;
const MESH_MAX_TOKENS = 3000;

const SYSTEM_PROMPT = `You are LLaMA-Mesh, a 3D mesh generator.
Output ONLY OBJ format: lines starting with "v" (vertex: v x y z) and "f" (face: f i j k).
No explanation. No markdown. No commentary. No <think> tags. Just OBJ lines.

Match the requested aesthetic in the topology choices you make:
- sharp / nightmare / cyber → angular, faceted, hard edges, fewer smooth surfaces
- cozy / whimsical → round, soft silhouettes, gentle curves
- ethereal / cosmic → crystalline, symmetric, geometric
- dark_fantasy → elongated, asymmetric, heavy bases
The character should be recognisable from its silhouette. Center it near
the origin and keep the bounding box roughly cubic.
Keep the mesh low-poly: 50-150 vertices, 80-300 faces.`;

interface LLMChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Extract OBJ text from an LLM response. Strips markdown fences and any
 * leading prose ("Here is the mesh..."), keeps only lines that start with
 * `v `, `vn `, `vt `, `f `, `g `, `o ` or `#`.
 */
function extractObj(raw: string): string | null {
  const noThink = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const noFence = noThink.replace(/```(?:obj)?\n?/gi, '').replace(/```/g, '');
  const lines = noFence
    .split('\n')
    .filter((l) => /^(v |vn |vt |f |g |o |#)/.test(l.trim()));
  if (lines.length < 4) return null;
  const obj = lines.join('\n') + '\n';
  // Cheap sanity check — must have at least one vertex and one face line.
  if (!/^v /m.test(obj) || !/^f /m.test(obj)) return null;
  return obj;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }
  if (!body || typeof body !== 'object') {
    return badRequest('Invalid body');
  }

  const b = body as {
    description?: unknown;
    generationId?: unknown;
    mood?: unknown;
    style?: unknown;
  };
  const description =
    typeof b.description === 'string' && b.description.trim().length > 0
      ? b.description.trim().slice(0, 300)
      : 'a magical floating crystal';
  const mood =
    typeof b.mood === 'string' && b.mood.trim().length > 0
      ? b.mood.trim().slice(0, 40)
      : '';
  const style =
    typeof b.style === 'string' && b.style.trim().length > 0
      ? b.style.trim().slice(0, 40)
      : '';

  const generationId = normalizeGenerationId(b.generationId) ?? newGenerationId();
  const filename = 'character.obj';
  if (!isSafeFilename(filename)) {
    return badRequest('Unsafe filename');
  }

  // Cache short-circuit: if character.obj already exists for this id,
  // return its URL without hitting LM Studio. Critical for the preset
  // flow where the same generationId is requested every demo click —
  // without this, every click pays a 40-90 s LLM round-trip.
  const existingFp = buildAssetFsPath({
    cwd: process.cwd(),
    kind: '3d',
    generationId,
    filename,
  });
  if (fs.existsSync(existingFp)) {
    const cachedUrl = buildAssetUrl({ kind: '3d', generationId, filename });
    return NextResponse.json(
      { character_obj_url: cachedUrl, generationId, generated: 1, cached: true },
      { status: 200 },
    );
  }

  try {
    const res = await fetch(`${LM_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MESH_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content:
              `Create a 3D OBJ mesh of: ${description}.` +
              (mood ? ` Mood: ${mood}.` : '') +
              (style ? ` Style: ${style}.` : '') +
              ` Low-poly. Center near origin. OBJ only.`,
          },
        ],
        temperature: 0.7,
        max_tokens: MESH_MAX_TOKENS,
        stream: false,
      }),
      signal: AbortSignal.timeout(MESH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LM Studio mesh error ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = (await res.json()) as LLMChatResponse;
    const rawContent = data.choices?.[0]?.message?.content ?? '';
    const obj = extractObj(rawContent);
    if (!obj) {
      console.error('[generate-mesh] no OBJ in response:\n%s', rawContent.slice(0, 500));
      throw new Error('OBJ not found in model response');
    }

    ensureAssetDir({ cwd: process.cwd(), kind: '3d', generationId });
    const fsPath = buildAssetFsPath({
      cwd: process.cwd(),
      kind: '3d',
      generationId,
      filename,
    });
    fs.writeFileSync(fsPath, obj, 'utf-8');

    const publicUrl = buildAssetUrl({ kind: '3d', generationId, filename });
    console.log(`[generate-mesh] saved ${filename} (${(obj.length / 1024).toFixed(1)} KB)`);

    return NextResponse.json(
      { character_obj_url: publicUrl, generationId, generated: 1 },
      { status: 200 },
    );
  } catch (err) {
    logApiError('generate-mesh', err);
    return fallbackOk({
      character_obj_url: null,
      generationId,
      generated: 0,
      fallback: true,
    });
  }
}
