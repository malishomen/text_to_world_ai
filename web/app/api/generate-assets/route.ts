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
} from '@/lib/generated-paths';

import { badRequest, fallbackOk, logApiError } from '@/lib/api-errors';
import { type GameConfig } from '@/lib/fallback-config';
import { parseGameConfig } from '@/lib/game-config-schema';

const SD_BASE_URL = process.env.SD_BASE_URL || 'http://127.0.0.1:7860';

type AssetFilename = 'background.png' | 'character.png' | 'platform.png';

async function generateImage(
  prompt: string,
  negative: string,
  filename: AssetFilename,
  generationId: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${SD_BASE_URL}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        negative_prompt: negative,
        width: 512,
        height: 512,
        steps: 15,
        cfg_scale: 7,
        sampler_name: 'Euler a',
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return null;
    const data: { images?: string[] } = await res.json();
    const base64 = data.images?.[0];
    if (!base64) return null;

    const filePath = buildAssetFsPath({
      cwd: process.cwd(),
      kind: '2d',
      generationId,
      filename,
    });
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

    return buildAssetUrl({ kind: '2d', generationId, filename });
  } catch (err) {
    logApiError('generate-assets/sd', err);
    return null;
  }
}

function buildPrompts(config: GameConfig) {
  const styleMap: Record<string, string> = {
    surreal: 'surrealist digital art, dreamlike, floating, ethereal',
    dark: 'dark fantasy, gothic, ominous, moody lighting',
    cozy: 'cozy illustration, warm colors, soft lighting, whimsical',
    nightmare: 'horror dreamscape, distorted, dark, glitchy',
    cyberpunk: 'cyberpunk neon, synthwave, glowing, futuristic',
    watercolor: 'watercolor painting, soft edges, pastel',
    pixel: '16-bit pixel art, retro game style',
    cosmic: 'cosmic space, nebula, stars, mystical glow',
  };

  const styleKeywords = styleMap[config.style] || styleMap['surreal'];
  const negPrompt = 'text, watermark, ugly, blurry, realistic photo, human face';

  return {
    background: {
      prompt: `${styleKeywords}, game background, 2D platformer landscape, no characters, ${config.mood?.replace(/_/g, ' ')} atmosphere, sky and ground`,
      negative: negPrompt,
      filename: 'background.png' as const,
    },
    character: {
      prompt: `${styleKeywords}, 2D game character sprite, ${config.main_character?.description || 'dream wanderer'}, full body, transparent background, game art`,
      negative: negPrompt + ', background scenery',
      filename: 'character.png' as const,
    },
    platform: {
      prompt: `${styleKeywords}, game platform tile, ${config.style} style, simple rectangular shape, ${config.color_palette?.[1] || '#7c3aed'} color`,
      negative: negPrompt,
      filename: 'platform.png' as const,
    },
  };
}

export async function POST(req: NextRequest) {
  // ---- Phase 5: parse + shallow-validate the body --------------------------
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (typeof body !== 'object' || body === null) {
    return badRequest('Invalid JSON body');
  }

  const bodyObj = body as { config?: unknown; generationId?: unknown };

  if (
    typeof bodyObj.config !== 'object' ||
    bodyObj.config === null ||
    Array.isArray(bodyObj.config)
  ) {
    return badRequest('Field "config" is required', { field: 'config' });
  }

  // ---- Phase 3: resolve generationId ---------------------------------------
  let generationId: string;
  if (typeof bodyObj.generationId === 'string') {
    const normalized = normalizeGenerationId(bodyObj.generationId);
    if (!normalized) {
      return badRequest('Invalid generationId format');
    }
    generationId = normalized;
  } else if (bodyObj.generationId === undefined) {
    generationId = newGenerationId();
    console.log(
      '[generate-assets] generationId not provided, generated:',
      generationId,
    );
  } else {
    return badRequest('Invalid generationId format');
  }

  // ---- SD health check (preserved): cheap 2s probe -------------------------
  const sdOk = await fetch(`${SD_BASE_URL}/sdapi/v1/options`, {
    signal: AbortSignal.timeout(2000),
  })
    .then((r) => r.ok)
    .catch(() => false);

  if (!sdOk) {
    return fallbackOk({
      background_url: null,
      character_url: null,
      platform_url: null,
      generated: false,
      generationId,
      message: 'Stable Diffusion offline — using procedural visuals',
    });
  }

  // ---- Phase 3: ensure per-id output dir exists ----------------------------
  ensureAssetDir({ cwd: process.cwd(), kind: '2d', generationId });

  const config: GameConfig = parseGameConfig(bodyObj.config, '');
  const prompts = buildPrompts(config);

  // Generate all three assets concurrently (preserved).
  const [bgUrl, charUrl, platUrl] = await Promise.all([
    generateImage(
      prompts.background.prompt,
      prompts.background.negative,
      prompts.background.filename,
      generationId,
    ),
    generateImage(
      prompts.character.prompt,
      prompts.character.negative,
      prompts.character.filename,
      generationId,
    ),
    generateImage(
      prompts.platform.prompt,
      prompts.platform.negative,
      prompts.platform.filename,
      generationId,
    ),
  ]);

  const anyGenerated = Boolean(bgUrl || charUrl || platUrl);

  return NextResponse.json({
    background_url: bgUrl,
    character_url: charUrl,
    platform_url: platUrl,
    generated: anyGenerated,
    generationId,
    message: anyGenerated
      ? 'Assets generated successfully'
      : 'No assets produced',
  });
}
