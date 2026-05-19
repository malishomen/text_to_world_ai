// POST /api/generate-assets
//
// 2D image asset generator — mood-tinted background, character card, and
// SEAMLESS TILEABLE platform texture. Driven by the shared image-gen lib
// (fal.ai FLUX schnell or local A1111). Writes three PNGs under
// web/public/generated/<generationId>/{background,character,platform}.png.
//
// Cache: if all three files already exist for a generationId, return cached
// URLs without calling the image generator (idempotent — supports preset
// pre-generation + page reloads not burning budget).
//
// Failure semantics: NEVER 500. fallbackOk on any branch that can't produce
// images so /play degrades to procedural visuals.

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
import {
  generateImage,
  getImageGenProvider,
  type ImageGenOptions,
} from '@/lib/image-gen';

type AssetFilename = 'background.png' | 'character.png' | 'platform.png';

// ---------------------------------------------------------------------------
// Mood-driven style anchors. Same family as /api/generate-3d but tuned for
// 2D wide-format / tileable contexts rather than isolated 3D subjects.
// ---------------------------------------------------------------------------

const MOOD_STYLE_ANCHOR: Record<string, string> = {
  nightmare:    'dark cinematic horror art, crimson and obsidian palette, harsh chiaroscuro, gothic dread, oil-painted realism',
  dark_fantasy: 'gothic fantasy concept art, ornate medieval detail, candlelit shadows, oil-painted realism, deep purple and gold',
  cozy_dream:   'Studio Ghibli aesthetic, soft hand-painted watercolor, warm pastels, gentle morning light, storybook charm',
  cyber_dream:  'cyberpunk concept art, neon cyan and magenta glow, holographic edges, dystopian futurism, rim lighting',
  cosmic:       'cosmic nebula art, ethereal starfield aura, deep violet and silver, celestial wonder, weightless drift',
  ethereal:     'ethereal glass art, soft pastel haze, dreamlike translucence, opalescent shimmer, weightless beauty',
  whimsical:    'whimsical illustration, vibrant candy colors, playful exaggerated proportions, cheerful charm',
  surreal_calm: 'surreal dream art, muted lavender and silver, soft drifting fog, magical realism, gentle stillness',
};
const DEFAULT_MOOD = 'surreal_calm';

function styleAnchorFor(mood: string | undefined): string {
  return MOOD_STYLE_ANCHOR[mood ?? DEFAULT_MOOD] ?? MOOD_STYLE_ANCHOR[DEFAULT_MOOD];
}

// Per-mood seamless-texture descriptor. Drives the platform PNG (tiled on
// the Three.js Platform mesh via useTexture).
const MOOD_PLATFORM_TEXTURE: Record<string, string> = {
  nightmare:    'cracked black obsidian floor with crimson veins',
  dark_fantasy: 'ancient mossy stone tiles with rune carvings',
  cozy_dream:   'lush green moss patches scattered with tiny pastel flowers',
  cyber_dream:  'neon-lit hexagonal circuit floor tiles with glowing seams',
  cosmic:       'starfield with cosmic dust and faint nebula swirls',
  ethereal:     'frosted glass tiles with iridescent rainbow shimmer',
  whimsical:    'candy-colored striped tile pattern in pink and mint',
  surreal_calm: 'silver mist swirls on smooth dark stone',
};
function platformTextureFor(mood: string | undefined): string {
  return MOOD_PLATFORM_TEXTURE[mood ?? DEFAULT_MOOD] ?? MOOD_PLATFORM_TEXTURE[DEFAULT_MOOD];
}

// ---------------------------------------------------------------------------
// Prompt engineering — separate from /api/generate-3d because these aren't
// TRELLIS inputs. Background is wide-format atmosphere; character is a
// portrait card; platform is a SEAMLESS TILEABLE texture (no perspective,
// no isolated subject, no shadows that break at edges).
// ---------------------------------------------------------------------------

interface AssetPlan {
  prompt: string;
  filename: AssetFilename;
  size: ImageGenOptions['size'];
}

function buildAssetPlans(config: GameConfig): AssetPlan[] {
  const anchor = styleAnchorFor(config.mood);
  const charDesc = (config.main_character?.description || 'dream wanderer').trim();
  const platformDesc = platformTextureFor(config.mood);

  return [
    {
      filename: 'background.png',
      size: 'landscape_16_9',
      prompt:
        `${anchor}, wide cinematic ${(config.mood || DEFAULT_MOOD).replace(/_/g, ' ')} atmosphere ` +
        `panoramic landscape backdrop, distant horizon, no characters, no foreground objects, ` +
        `painterly concept art, suitable as a game skybox backdrop`,
    },
    {
      filename: 'character.png',
      size: 'portrait_4_3',
      prompt:
        `${anchor}, portrait card of ${charDesc}, full body hero pose, ` +
        `centered subject, isolated on a smooth neutral light-grey studio backdrop, ` +
        `soft three-point lighting, sharp focus, clean silhouette, no text`,
    },
    {
      filename: 'platform.png',
      size: 'square_hd',
      prompt:
        `seamless tileable texture, top-down orthographic view of ${platformDesc}, ` +
        `${anchor}, uniform lighting with no directional shadows, tiles cleanly at every edge, ` +
        `no characters, no foreground subject, no text, no logos, photorealistic detail`,
    },
  ];
}

// ---------------------------------------------------------------------------
// Cache helper — full hit means we can skip the image generator entirely.
// ---------------------------------------------------------------------------

function cachedUrls(generationId: string): {
  background: string | null;
  character: string | null;
  platform: string | null;
  count: number;
} {
  const slots: AssetFilename[] = ['background.png', 'character.png', 'platform.png'];
  let count = 0;
  const out: Record<string, string | null> = {
    'background.png': null,
    'character.png':  null,
    'platform.png':   null,
  };
  for (const f of slots) {
    const fp = buildAssetFsPath({ cwd: process.cwd(), kind: '2d', generationId, filename: f });
    if (fs.existsSync(fp)) {
      out[f] = buildAssetUrl({ kind: '2d', generationId, filename: f });
      count += 1;
    }
  }
  return {
    background: out['background.png'],
    character:  out['character.png'],
    platform:   out['platform.png'],
    count,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // ---- 1. Parse + validate body -------------------------------------------
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

  // ---- 2. Resolve generationId --------------------------------------------
  let generationId: string;
  if (typeof bodyObj.generationId === 'string') {
    const normalized = normalizeGenerationId(bodyObj.generationId);
    if (!normalized) {
      return badRequest('Invalid generationId format');
    }
    generationId = normalized;
  } else if (bodyObj.generationId === undefined) {
    generationId = newGenerationId();
    console.log('[generate-assets] generationId not provided, generated:', generationId);
  } else {
    return badRequest('Invalid generationId format');
  }

  // ---- 3. Cache short-circuit ---------------------------------------------
  const cached = cachedUrls(generationId);
  if (cached.count === 3) {
    return NextResponse.json({
      background_url: cached.background,
      character_url: cached.character,
      platform_url: cached.platform,
      generated: true,
      generationId,
      message: 'Cached assets (no image-gen call)',
    });
  }

  // ---- 4. Image-gen availability ------------------------------------------
  const provider = getImageGenProvider();
  if (provider.status === 'unavailable') {
    return fallbackOk({
      background_url: cached.background,
      character_url: cached.character,
      platform_url: cached.platform,
      generated: cached.count > 0,
      generationId,
      provider_status: provider.status,
      message: `Image generator unavailable (${provider.reason ?? 'no provider'}); using procedural visuals`,
    });
  }

  // ---- 5. Ensure per-id dir exists, then generate (concurrent) -----------
  ensureAssetDir({ cwd: process.cwd(), kind: '2d', generationId });

  const config: GameConfig = parseGameConfig(bodyObj.config, '');
  const plans = buildAssetPlans(config);

  const log: string[] = [`image-gen=${provider.backend}`];

  const results = await Promise.all(
    plans.map(async (plan) => {
      // Per-asset cache check (one of the three may already exist).
      const existingFp = buildAssetFsPath({
        cwd: process.cwd(),
        kind: '2d',
        generationId,
        filename: plan.filename,
      });
      if (fs.existsSync(existingFp)) {
        log.push(`${plan.filename} cached`);
        return {
          filename: plan.filename,
          url: buildAssetUrl({ kind: '2d', generationId, filename: plan.filename }),
        };
      }
      const buf = await generateImage({
        prompt: plan.prompt,
        size: plan.size,
        label: plan.filename,
      });
      if (!buf) {
        log.push(`${plan.filename} failed`);
        return { filename: plan.filename, url: null };
      }
      try {
        fs.writeFileSync(existingFp, buf);
        log.push(`${plan.filename} OK (${(buf.length / 1024).toFixed(0)} KB)`);
        return {
          filename: plan.filename,
          url: buildAssetUrl({ kind: '2d', generationId, filename: plan.filename }),
        };
      } catch (err) {
        logApiError('generate-assets/write', err);
        log.push(`${plan.filename} write-failed`);
        return { filename: plan.filename, url: null };
      }
    }),
  );

  const byFile: Record<AssetFilename, string | null> = {
    'background.png': null,
    'character.png':  null,
    'platform.png':   null,
  };
  for (const r of results) byFile[r.filename] = r.url;

  const generatedCount = results.filter((r) => r.url).length;

  return NextResponse.json({
    background_url: byFile['background.png'],
    character_url:  byFile['character.png'],
    platform_url:   byFile['platform.png'],
    generated: generatedCount > 0,
    generationId,
    provider_status: provider.status,
    log,
    message: generatedCount === 3
      ? 'All 2D assets generated'
      : `${generatedCount}/3 assets generated`,
  });
}
