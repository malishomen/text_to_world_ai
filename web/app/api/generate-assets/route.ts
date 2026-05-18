import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const SD_BASE_URL = process.env.SD_BASE_URL || 'http://127.0.0.1:7860';
const ASSETS_DIR = path.join(process.cwd(), 'public', 'generated');

interface GameConfig {
  style: string;
  mood: string;
  main_character: { description: string; color: string };
  background: { sky_color: string; ground_color: string };
  color_palette: string[];
}

// Ensure public/generated dir exists
function ensureDir() {
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

async function generateImage(prompt: string, negative: string, filename: string): Promise<string | null> {
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
    const data = await res.json();
    const base64 = data.images?.[0];
    if (!base64) return null;

    ensureDir();
    const filePath = path.join(ASSETS_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    return `/generated/${filename}`;
  } catch {
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
      filename: 'background.png',
    },
    character: {
      prompt: `${styleKeywords}, 2D game character sprite, ${config.main_character?.description || 'dream wanderer'}, full body, transparent background, game art`,
      negative: negPrompt + ', background scenery',
      filename: 'character.png',
    },
    platform: {
      prompt: `${styleKeywords}, game platform tile, ${config.style} style, simple rectangular shape, ${config.color_palette?.[1] || '#7c3aed'} color`,
      negative: negPrompt,
      filename: 'platform.png',
    },
  };
}

export async function POST(req: NextRequest) {
  const { config } = await req.json();
  if (!config) return NextResponse.json({ error: 'No config' }, { status: 400 });

  // Cheap probe so we don't waste 3×25 s timeouts when SD isn't even running.
  const sdOk = await fetch(`${SD_BASE_URL}/sdapi/v1/options`,
    { signal: AbortSignal.timeout(2000) }).then(r => r.ok).catch(() => false);
  if (!sdOk) {
    return NextResponse.json({
      background_url: null,
      character_url: null,
      platform_url: null,
      generated: false,
      message: 'Stable Diffusion offline — using procedural visuals',
    }, { status: 200 });
  }

  const prompts = buildPrompts(config as GameConfig);
  const results: Record<string, string | null> = {};

  // Generate all three assets concurrently
  const [bgUrl, charUrl, platUrl] = await Promise.all([
    generateImage(prompts.background.prompt, prompts.background.negative, prompts.background.filename),
    generateImage(prompts.character.prompt, prompts.character.negative, prompts.character.filename),
    generateImage(prompts.platform.prompt, prompts.platform.negative, prompts.platform.filename),
  ]);

  results.background_url = bgUrl;
  results.character_url = charUrl;
  results.platform_url = platUrl;

  const anyGenerated = Object.values(results).some(Boolean);
  return NextResponse.json({
    ...results,
    generated: anyGenerated,
    message: anyGenerated
      ? 'Assets generated successfully'
      : 'Stable Diffusion unavailable — using procedural visuals',
  });
}
