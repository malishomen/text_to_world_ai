import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@gradio/client';
import * as fs from 'fs';
import * as path from 'path';
import { withTimeout } from '@/lib/with-timeout';

// ─── Config ───────────────────────────────────────────────────────────────────
// TRELLIS_URL = HuggingFace Space ID  →  "JeffreyXiang/TRELLIS-image-large"
//             = local Gradio server   →  "http://127.0.0.1:7861"
const TRELLIS_URL  = process.env.TRELLIS_URL  || 'JeffreyXiang/TRELLIS-image-large';
const SD_URL       = process.env.SD_BASE_URL  || 'http://127.0.0.1:7860';
const HF_TOKEN     = process.env.HF_TOKEN     || '';

const IS_HF_SPACE  = !TRELLIS_URL.startsWith('http');

const ASSETS_DIR   = path.join(process.cwd(), 'public', 'generated3d');
const GODOT_DIR    = path.join(process.cwd(), '..', '..', 'godot', 'assets');

function ensureDirs() {
  [ASSETS_DIR, GODOT_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

// ─── Step 1: Generate reference image via Stable Diffusion ───────────────────
async function generateSDImage(prompt: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${SD_URL}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `${prompt}, isolated object, white background, no shadows, centered, product photo`,
        negative_prompt: 'background scenery, environment, blurry, text, watermark, multiple objects',
        width: 512,
        height: 512,
        steps: 25,
        cfg_scale: 7.5,
        sampler_name: 'DPM++ 2M Karras',
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const b64 = data.images?.[0];
    if (!b64) return null;
    return Buffer.from(b64, 'base64');
  } catch (err) {
    console.error('SD image gen failed:', err);
    return null;
  }
}

// ─── Step 2: TRELLIS image → GLB ─────────────────────────────────────────────
async function trellisImageToGlb(imageBuffer: Buffer, filename: string): Promise<string | null> {
  try {
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

    // Step B: Image → 3D Gaussian Splatting + mesh
    // (result not consumed — TRELLIS keeps session state for /extract_glb)
    await withTimeout(
      client.predict('/image_to_3d', {
        image:                   processedImage,
        seed:                    Math.floor(Math.random() * 65536),
        randomize_seed:          true,
        ss_guidance_strength:    7.5,   // Structure strength
        ss_sampling_steps:       12,    // 12 = fast, 20 = quality
        slat_guidance_strength:  3.0,   // Texture guidance
        slat_sampling_steps:     12,
      }),
      IS_HF_SPACE ? 90000 : 60000,
      'image_to_3d',
    );

    // Step C: Extract GLB with texture baking
    const glbResult = await withTimeout(
      client.predict('/extract_glb', {
        mesh_simplify_ratio: 0.95,  // keep 95% of geometry
        texture_size:        1024,  // 1024 for fast, 2048 for quality
      }),
      30000,
      'extract_glb',
    );

    // Download the GLB file from the Gradio temp URL
    const glbData = (glbResult.data as { url?: string; path?: string }[])[0];
    const glbUrl  = glbData?.url || glbData?.path;
    if (!glbUrl) return null;

    // Gradio returns local paths or full URLs depending on local vs HF Space
    let glbBuffer: Buffer;
    if (glbUrl.startsWith('http')) {
      const glbRes = await fetch(glbUrl, { signal: AbortSignal.timeout(30000) });
      glbBuffer = Buffer.from(await glbRes.arrayBuffer());
    } else {
      // Local Gradio temp file path
      glbBuffer = fs.readFileSync(glbUrl);
    }

    ensureDirs();
    const webPath   = path.join(ASSETS_DIR, filename);
    const godotPath = path.join(GODOT_DIR, filename);
    fs.writeFileSync(webPath, glbBuffer);
    fs.writeFileSync(godotPath, glbBuffer);

    console.log(`TRELLIS: Generated ${filename} (${(glbBuffer.length / 1024).toFixed(0)} KB)`);
    return `/generated3d/${filename}`;

  } catch (err) {
    console.error(`TRELLIS failed for ${filename}:`, err);
    return null;
  }
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
interface GameConfig {
  mood: string;
  style: string;
  main_character?: { description?: string; color?: string };
  meshy_character_prompt?: string;
  meshy_environment_prompt?: string;
}

function buildSDPrompts(config: GameConfig) {
  const mood = config.mood || 'surreal_calm';
  const style = config.style || 'surreal';
  const charDesc = config.main_character?.description || 'dream wanderer';

  const moodWords: Record<string, string> = {
    nightmare:    'dark sinister glowing horror',
    cozy_dream:   'warm glowing magical fairy-tale soft',
    cyber_dream:  'neon futuristic holographic metallic',
    dark_fantasy: 'gothic mystical ancient ornate',
    cosmic:       'ethereal cosmic nebula crystalline',
    surreal_calm: 'surreal dreamlike crystalline iridescent',
  };
  const kw = moodWords[mood] || 'magical dreamlike glowing';

  // Use Meshy prompts if AI already generated them (they're better)
  const charPrompt  = config.meshy_character_prompt
    || `${kw} ${style} 3D game character, ${charDesc}, detailed PBR, hero, full body`;
  const propPrompt  = config.meshy_environment_prompt
    || `${kw} ${style} magical floating crystal prop, game asset, ornate`;
  const portalPrompt = `${kw} glowing portal vortex, spinning rings, energy, game asset`;

  return [
    { sdPrompt: charPrompt,   filename: 'character.glb' },
    { sdPrompt: propPrompt,   filename: 'prop.glb' },
    { sdPrompt: portalPrompt, filename: 'portal.glb' },
  ];
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { config } = await req.json();
  if (!config) return NextResponse.json({ error: 'No config' }, { status: 400 });

  // For HF Space, check token; for local, ping the server
  if (IS_HF_SPACE && !HF_TOKEN) {
    return NextResponse.json({
      error: 'HF_TOKEN not set',
      message: 'Get a free token at huggingface.co/settings/tokens, then add HF_TOKEN=hf_xxx to .env.local',
      fallback: true,
    }, { status: 200 });
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
          return NextResponse.json({
            error: `HF Space stage: ${info.runtime.stage}`,
            message: 'TRELLIS HF Space is not running (sleeping/building). Try again in ~30s.',
            fallback: true,
          }, { status: 200 });
        }
      }
    } catch { /* probe failed — proceed anyway */ }
  }

  const sdOk = await fetch(`${SD_URL}/sdapi/v1/options`, { signal: AbortSignal.timeout(3000) })
    .then(r => r.ok).catch(() => false);

  if (!IS_HF_SPACE) {
    const localOk = await fetch(`${TRELLIS_URL}/info`, { signal: AbortSignal.timeout(3000) })
      .then(r => r.ok).catch(() => false);
    if (!localOk) {
      return NextResponse.json({
        error: 'Local TRELLIS not running',
        message: `Note: TRELLIS requires Linux + NVIDIA CUDA GPU. On macOS use HF Space instead: set TRELLIS_URL=JeffreyXiang/TRELLIS-image-large`,
        fallback: true,
      }, { status: 200 });
    }
  }

  const prompts = buildSDPrompts(config as GameConfig);
  const results: Record<string, string | null> = {};
  const log: string[] = [`TRELLIS OK, SD ${sdOk ? 'OK' : 'offline'}`];

  // Hard ceiling for the whole request — abandons remaining prompts if exceeded.
  const deadline = Date.now() + 60_000;

  // Sequential generation (TRELLIS is stateful between steps A/B/C per session)
  for (const { sdPrompt, filename } of prompts) {
    if (Date.now() > deadline) {
      log.push(`deadline reached, skipping rest`);
      break;
    }
    try {
      // 1. Generate reference image
      let imgBuffer: Buffer | null = null;
      if (sdOk) {
        imgBuffer = await generateSDImage(sdPrompt);
        if (imgBuffer) log.push(`SD → ${filename.replace('.glb', '.png')} OK`);
      }

      if (!imgBuffer) {
        // Fallback: 1×1 white pixel — TRELLIS will still try but quality will be poor
        log.push(`SD failed for ${filename}, using placeholder`);
        // Skip this asset rather than waste TRELLIS credits
        results[filename.replace('.glb', '_url')] = null;
        continue;
      }

      // 2. TRELLIS: image → GLB
      const glbUrl = await trellisImageToGlb(imgBuffer, filename);
      results[filename.replace('.glb', '_url')] = glbUrl;
      if (glbUrl) log.push(`TRELLIS → ${filename} OK`);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(`Error ${filename}: ${msg}`);
      results[filename.replace('.glb', '_url')] = null;
    }
  }

  // Write final config + asset URLs for Godot
  const finalConfig = { ...config, assets: results };
  ensureDirs();
  const publicCfg = path.join(process.cwd(), 'public', 'dream_config.json');
  fs.writeFileSync(publicCfg, JSON.stringify(finalConfig, null, 2));
  try {
    const godotCfg = path.join(GODOT_DIR, '..', 'dream_config.json');
    fs.writeFileSync(godotCfg, JSON.stringify(finalConfig, null, 2));
  } catch { /* godot dir may not exist */ }

  const generated = Object.values(results).filter(Boolean).length;
  return NextResponse.json({
    ...results,
    generated,
    total: prompts.length,
    log,
    message: `${generated}/${prompts.length} 3D assets generated via TRELLIS`,
  });
}
