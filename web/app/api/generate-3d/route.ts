import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@gradio/client';
import * as fs from 'fs';
import * as path from 'path';
import { withTimeout } from '@/lib/with-timeout';
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
import { generateImage, getImageGenProvider } from '@/lib/image-gen';
import {
  parseGameConfigExtended,
  type ExtendedGameConfig,
} from '@/lib/game-config-schema';

// ─── Config ───────────────────────────────────────────────────────────────────
// TRELLIS_URL = HuggingFace Space ID  →  "microsoft/TRELLIS.2" (v2, PBR-materials,
//                                          512/1024/1536 resolution presets)
//             = HuggingFace Space ID  →  "JeffreyXiang/TRELLIS-image-large" (v1)
//             = local Gradio server   →  "http://127.0.0.1:7861"
const TRELLIS_URL  = process.env.TRELLIS_URL  || 'microsoft/TRELLIS.2';
const SD_URL       = process.env.SD_BASE_URL  || 'http://127.0.0.1:7860';
const HF_TOKEN     = process.env.HF_TOKEN     || '';
// Image generator behind TRELLIS is dispatched in web/lib/image-gen.ts.

// Feature flag for the entire TRELLIS pipeline. Set TRELLIS_ENABLED=1 in
// .env.local to attempt 3D generation; default OFF because all known
// Microsoft TRELLIS HF Spaces are currently in RUNTIME_ERROR / CONFIG_ERROR
// (May 2026 outage). With the flag off this route returns a clean
// fallbackOk({provider_status: 'unavailable'}) and the client uses the
// existing LLaMA-Mesh OBJ + procedural mood-shape chain. When Microsoft
// fixes the Space, set TRELLIS_ENABLED=1 to revive the pipeline — no code
// changes required.
const TRELLIS_ENABLED = process.env.TRELLIS_ENABLED === '1';

const IS_HF_SPACE  = !TRELLIS_URL.startsWith('http');

// v1 (JeffreyXiang/TRELLIS-image-large) and v2 (microsoft/TRELLIS.2) share the
// same Gradio endpoint NAMES (/preprocess_image, /image_to_3d, /extract_glb)
// but the v2 image_to_3d signature is a 15-element positional list driving a
// 3-stage shape+PBR pipeline, and /extract_glb renamed `mesh_simplify_ratio`
// to a `Decimation Target` integer. We auto-detect v2 by URL substring.
const IS_TRELLIS_V2 = /trellis\.?2/i.test(TRELLIS_URL);

const GODOT_DIR    = path.join(process.cwd(), '..', '..', 'godot', 'assets');

// Image generation moved to web/lib/image-gen.ts (shared with /api/generate-assets).

// ─── Step 2: TRELLIS image → GLB ─────────────────────────────────────────────
async function trellisImageToGlb(
  imageBuffer: Buffer,
  filename: string,
  generationId: string,
  writeGodot: boolean,
): Promise<{ url: string | null; wroteGodot: boolean }> {
  try {
    // Defensive — filename must be one of the safe basenames we control.
    if (!isSafeFilename(filename)) {
      throw new Error(`unsafe filename: ${filename}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const connectOpts: any = HF_TOKEN ? { hf_token: HF_TOKEN } : {};
    const client = await withTimeout(
      Client.connect(TRELLIS_URL, connectOpts),
      15000,
      'gradio_connect',
    );

    const imageBlob = new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' });

    // Step A: Preprocess image (TRELLIS removes background, centers object)
    const preprocessed = await withTimeout(
      client.predict('/preprocess_image', { image: imageBlob }),
      20000,
      'preprocess_image',
    );
    const processedImage = (preprocessed.data as unknown[])[0];

    // Step B: Image → 3D shape (+ PBR materials in v2).
    // v2 takes 15 positional args driving 3 sub-stages (shape -> PBR layer A
    // -> PBR layer B). v1 takes the original 7-key named object. Defaults
    // copied from the Space's UI sliders.
    const seed = Math.floor(Math.random() * 65536);
    if (IS_TRELLIS_V2) {
      await withTimeout(
        client.predict('/image_to_3d', [
          processedImage,        // [ 0] Image Prompt
          seed,                  // [ 1] Seed
          '512',                 // [ 2] Resolution — "512"|"1024"|"1536".
                                 //      512 = ~3s on H100; HF Space's free Zero
                                 //      GPU runs slower so we pick smallest.
          7.5,  0.7, 12, 5.0,    // [ 3-6 ] Stage 1: shape — gs / gr / steps / rescaleT
          7.5,  0.5, 12, 3.0,    // [ 7-10] Stage 2: PBR pass A
          1.0,  0.0, 12, 3.0,    // [11-14] Stage 3: PBR pass B
        ]),
        IS_HF_SPACE ? 120000 : 60000,
        'image_to_3d',
      );
    } else {
      await withTimeout(
        client.predict('/image_to_3d', {
          image:                   processedImage,
          seed,
          randomize_seed:          true,
          ss_guidance_strength:    7.5,
          ss_sampling_steps:       12,
          slat_guidance_strength:  3.0,
          slat_sampling_steps:     12,
        }),
        IS_HF_SPACE ? 90000 : 60000,
        'image_to_3d',
      );
    }

    // Step C: Extract GLB with texture baking.
    // v2 renamed `mesh_simplify_ratio` (0..1 float, "keep this fraction") to
    // `Decimation Target` (integer face count target). v2 default 300000;
    // we drop to 60000 so resulting GLBs stay light enough for late-asset
    // streaming into the browser.
    const glbResult = await withTimeout(
      IS_TRELLIS_V2
        ? client.predict('/extract_glb', [
            null,    // [0] state — gradio_client passes the prior call's
                     //     session output automatically when null
            60000,   // [1] Decimation Target — face count
            1024,    // [2] Texture Size
          ])
        : client.predict('/extract_glb', {
            mesh_simplify_ratio: 0.95,
            texture_size:        1024,
          }),
      45000,
      'extract_glb',
    );

    // Download the GLB file from the Gradio temp URL
    const glbData = (glbResult.data as { url?: string; path?: string }[])[0];
    const glbUrl  = glbData?.url || glbData?.path;
    if (!glbUrl) return { url: null, wroteGodot: false };

    // Gradio returns local paths or full URLs depending on local vs HF Space
    let glbBuffer: Buffer;
    if (glbUrl.startsWith('http')) {
      const glbRes = await fetch(glbUrl, { signal: AbortSignal.timeout(30000) });
      glbBuffer = Buffer.from(await glbRes.arrayBuffer());
    } else {
      // Local Gradio temp file path
      glbBuffer = fs.readFileSync(glbUrl);
    }

    // Ensure the per-generation directory exists and write under it.
    ensureAssetDir({ cwd: process.cwd(), kind: '3d', generationId });
    const webPath = buildAssetFsPath({
      cwd: process.cwd(),
      kind: '3d',
      generationId,
      filename,
    });
    fs.writeFileSync(webPath, glbBuffer);

    let wroteGodot = false;
    if (writeGodot) {
      if (!fs.existsSync(GODOT_DIR)) fs.mkdirSync(GODOT_DIR, { recursive: true });
      const godotPath = path.join(GODOT_DIR, filename);
      fs.writeFileSync(godotPath, glbBuffer);
      wroteGodot = true;
    }

    const publicUrl = buildAssetUrl({ kind: '3d', generationId, filename });
    console.log(`TRELLIS: Generated ${filename} (${(glbBuffer.length / 1024).toFixed(0)} KB)`);
    return { url: publicUrl, wroteGodot };

  } catch (err) {
    logApiError('generate-3d/trellis', err);
    return { url: null, wroteGodot: false };
  }
}

// ─── Prompt engineering for FLUX-schnell (and SD-A1111 fallback) ─────────────
// Three concerns drive every prompt:
//
//   1. TRELLIS-friendliness — TRELLIS preprocesses the image by removing
//      background and centering the subject. Prompts MUST produce a single
//      subject on a neutral isolated backdrop. Hard requirement.
//   2. Mood identity — 8 distinct visual styles so judges instantly see the
//      dream's tone in the generated character/prop. Per-mood anchor below.
//   3. FLUX schnell quirks — 4-step distilled model, prefers concise prompts
//      (40-70 tokens), ignores negative prompts, responds to cinematic /
//      photographic vocabulary ("studio lighting", "concept art", "soft
//      cinematic", etc). Avoid SD-isms like "detailed PBR" or "8k masterpiece".

const MOOD_STYLE_ANCHOR: Record<string, string> = {
  nightmare:    'dark cinematic horror art, crimson and obsidian palette, harsh chiaroscuro lighting, gothic dread, oil-painted realism',
  dark_fantasy: 'gothic fantasy concept art, ornate medieval detail, dramatic candlelit shadows, oil-painted realism, deep purple and gold',
  cozy_dream:   'Studio Ghibli aesthetic, soft hand-painted watercolor, warm pastels, gentle morning light, storybook charm',
  cyber_dream:  'cyberpunk concept art, neon cyan and magenta glow, holographic edges, dystopian futurism, rim lighting',
  cosmic:       'cosmic nebula art, ethereal starfield aura, deep violet and silver, celestial wonder, weightless drift',
  ethereal:     'ethereal glass art, soft pastel haze, dreamlike translucence, weightless beauty, opalescent shimmer',
  whimsical:    'whimsical illustration, vibrant candy colors, playful exaggerated proportions, cheerful charm, soft toy texture',
  surreal_calm: 'surreal dream art, muted lavender and silver, soft drifting fog, magical realism, gentle stillness',
};

// Per-mood "world prop" so the prop slot doesn't always show a generic crystal.
const MOOD_PROP: Record<string, string> = {
  nightmare:    'broken cursed obelisk dripping shadow tendrils',
  dark_fantasy: 'ancient runestone shrine with glowing engraved sigils',
  cozy_dream:   'large glowing magical mushroom with soft lantern cap',
  cyber_dream:  'holographic data crystal floating above a neon pedestal',
  cosmic:       'geometric cosmic monolith carved from starlight',
  ethereal:     'spiraling glass dreamlight orb wrapped in slow ribbons',
  whimsical:    'candy spiral lollipop tower with swirling stripes',
  surreal_calm: 'drifting silver feather sculpture suspended in mist',
};

// TRELLIS-friendly composition scaffold — appended to every prompt.
const ISOLATION_SCAFFOLD =
  'centered single subject, isolated on a smooth neutral light-grey studio backdrop, ' +
  'soft three-point cinematic lighting, sharp focus, clean silhouette, no other objects, no text, no UI';

function styleAnchorFor(mood: string): string {
  return MOOD_STYLE_ANCHOR[mood] ?? MOOD_STYLE_ANCHOR.surreal_calm;
}
function propKindFor(mood: string): string {
  return MOOD_PROP[mood] ?? MOOD_PROP.surreal_calm;
}

interface AssetPrompt {
  /** What FLUX/SD sees. */
  sdPrompt: string;
  /** Output filename in the per-generation 3D directory. */
  filename: string;
}

function buildSDPrompts(config: ExtendedGameConfig): AssetPrompt[] {
  const mood = config.mood || 'surreal_calm';
  const anchor = styleAnchorFor(mood);
  const charDesc = (config.main_character?.description || 'dream wanderer').trim();
  const propKind = propKindFor(mood);

  // Character — hero full-body, used as TRELLIS source for the player mesh.
  const characterPrompt =
    `${anchor}, of ${charDesc}, full body hero pose, ${ISOLATION_SCAFFOLD}`;

  // Prop — mood-themed environment object, used as InstancedProps source or
  // as a decorative scatter element in future iterations.
  const propPrompt =
    `${anchor}, of a small mystical floating ${propKind}, intricate detail, ${ISOLATION_SCAFFOLD}`;

  // Portal — the final-platform goal mesh. Always a glowing vortex but tinted
  // by the mood's anchor palette.
  const portalPrompt =
    `${anchor}, of a glowing magical portal vortex with concentric spinning ` +
    `energy rings and mysterious depth, ${ISOLATION_SCAFFOLD}`;

  return [
    { sdPrompt: characterPrompt, filename: 'character.glb' },
    { sdPrompt: propPrompt,      filename: 'prop.glb' },
    { sdPrompt: portalPrompt,    filename: 'portal.glb' },
  ];
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const writeGodot = process.env.WRITE_GODOT_ASSETS === '1';
  console.log('[generate-3d] WRITE_GODOT_ASSETS =', writeGodot ? 'on' : 'off');

  // Feature flag — TRELLIS HF Spaces are currently broken upstream
  // (microsoft/TRELLIS.2 RUNTIME_ERROR, microsoft/TRELLIS CONFIG_ERROR,
  // JeffreyXiang/TRELLIS-image-large removed). Default OFF.
  // When Microsoft restores the Space, set TRELLIS_ENABLED=1 in .env.local.
  if (!TRELLIS_ENABLED) {
    return fallbackOk({
      provider_status: 'unavailable',
      reason: 'TRELLIS HF Space outage; pipeline gated behind TRELLIS_ENABLED env flag',
      message:
        'Player + props + portal will use the LLaMA-Mesh / procedural fallback chain. ' +
        'Set TRELLIS_ENABLED=1 in web/.env.local when the upstream Space is fixed.',
      character_url: null,
      prop_url: null,
      portal_url: null,
      generated: 0,
      total: 3,
      wrote_godot: false,
    });
  }

  // 1. Parse + validate request body.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (body === null || typeof body !== 'object') {
    return badRequest('Invalid JSON body');
  }

  const b = body as { config?: unknown; generationId?: unknown };

  if (!b.config || typeof b.config !== 'object') {
    return badRequest('Field "config" is required', { field: 'config' });
  }
  const config = parseGameConfigExtended(b.config, '');

  // 2. Resolve generationId.
  let generationId: string;
  if (b.generationId === undefined) {
    generationId = newGenerationId();
    console.log('[generate-3d] generationId not provided, generated:', generationId);
  } else {
    const normalized = normalizeGenerationId(b.generationId);
    if (!normalized) {
      return badRequest('Invalid generationId format');
    }
    generationId = normalized;
  }

  // For HF Space, check token; for local, ping the server
  if (IS_HF_SPACE && !HF_TOKEN) {
    return fallbackOk({
      error: 'HF_TOKEN not set',
      message: 'Get a free token at huggingface.co/settings/tokens, then add HF_TOKEN=hf_xxx to .env.local',
      wrote_godot: false,
      generationId,
    });
  }

  // Cheap probe to detect sleeping/building HF Spaces before paying the Gradio
  // handshake cost. Probe failures are non-fatal — we still attempt the call.
  if (IS_HF_SPACE) {
    try {
      const probe = await fetch(`https://huggingface.co/api/spaces/${TRELLIS_URL}`,
        { signal: AbortSignal.timeout(3000) });
      if (probe.ok) {
        const info = await probe.json();
        if (info?.runtime?.stage && info.runtime.stage !== 'RUNNING') {
          return fallbackOk({
            error: `HF Space stage: ${info.runtime.stage}`,
            message: 'TRELLIS HF Space is not running (sleeping/building). Try again in ~30s.',
            wrote_godot: false,
            generationId,
          });
        }
      }
    } catch { /* probe failed — proceed anyway */ }
  }

  // Image-generator availability — handled by shared lib.
  const imgProvider = getImageGenProvider();
  const sdOk = imgProvider.status !== 'unavailable';

  if (!IS_HF_SPACE) {
    const localOk = await fetch(`${TRELLIS_URL}/info`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok).catch(() => false);
    if (!localOk) {
      return fallbackOk({
        error: 'Local TRELLIS not running',
        message: `Note: TRELLIS requires Linux + NVIDIA CUDA GPU. On macOS use HF Space instead: set TRELLIS_URL=JeffreyXiang/TRELLIS-image-large`,
        wrote_godot: false,
        generationId,
      });
    }
  }

  try {
    const prompts = buildSDPrompts(config);
    const results: Record<string, string | null> = {};
    const log: string[] = [
      `TRELLIS OK, image-gen=${imgProvider.backend}${sdOk ? '' : ' offline'}`,
    ];
    let wroteGodotAny = false;

    // Hard ceiling for the whole request — abandons remaining prompts if exceeded.
    const deadline = Date.now() + 120_000;  // fal pipeline is faster but TRELLIS still slow

    // Sequential generation (TRELLIS is stateful between steps A/B/C per session)
    for (const { sdPrompt, filename } of prompts) {
      if (Date.now() > deadline) {
        log.push(`deadline reached, skipping rest`);
        break;
      }
      try {
        // 1. Generate reference image via shared lib (fal or a1111).
        let imgBuffer: Buffer | null = null;
        if (sdOk) {
          imgBuffer = await generateImage({
            prompt: sdPrompt,
            size: 'square_hd',
            label: filename,
          });
          if (imgBuffer) {
            log.push(
              `${imgProvider.backend} → ${filename.replace('.glb', '.png')} OK ` +
                `(${(imgBuffer.length / 1024).toFixed(0)} KB)`,
            );
          }
        }

        if (!imgBuffer) {
          log.push(`${imgProvider.backend} failed for ${filename}, skipping`);
          results[filename.replace('.glb', '_url')] = null;
          continue;
        }

        // 2. TRELLIS: image → GLB
        const { url: glbUrl, wroteGodot: gw } =
          await trellisImageToGlb(imgBuffer, filename, generationId, writeGodot);
        results[filename.replace('.glb', '_url')] = glbUrl;
        if (gw) wroteGodotAny = true;
        if (glbUrl) log.push(`TRELLIS → ${filename} OK`);

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.push(`Error ${filename}: ${msg}`);
        results[filename.replace('.glb', '_url')] = null;
      }
    }

    // Write final config + asset URLs for Godot
    const finalConfig = { ...config, assets: results, generationId };
    const publicCfg = path.join(process.cwd(), 'public', 'dream_config.json');
    fs.writeFileSync(publicCfg, JSON.stringify(finalConfig, null, 2));

    if (writeGodot) {
      try {
        if (!fs.existsSync(GODOT_DIR)) fs.mkdirSync(GODOT_DIR, { recursive: true });
        const godotCfg = path.join(GODOT_DIR, '..', 'dream_config.json');
        fs.writeFileSync(godotCfg, JSON.stringify(finalConfig, null, 2));
        wroteGodotAny = true;
      } catch (err) {
        logApiError('generate-3d/godot-config', err);
      }
    }

    const generated = Object.values(results).filter(Boolean).length;
    return NextResponse.json({
      ...results,
      generated,
      total: prompts.length,
      log,
      generationId,
      wrote_godot: wroteGodotAny,
      message: `${generated}/${prompts.length} 3D assets generated via TRELLIS`,
    });
  } catch (err) {
    const safe = logApiError('generate-3d/unhandled', err);
    return fallbackOk({
      error: safe.name,
      message: safe.message,
      wrote_godot: false,
      generationId,
    });
  }
}
