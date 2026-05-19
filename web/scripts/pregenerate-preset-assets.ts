/**
 * One-off script: hit /api/generate-assets AND /api/generate-mesh for every
 * DEMO_PRESETS entry so the FLUX background + character + platform PNG
 * triple AND the LLaMA-Mesh OBJ character are cached on disk under
 * web/public/generated/{2d,3d}/<generationId>/ BEFORE the demo.
 *
 * Idempotent: both endpoints short-circuit when their per-id files exist.
 * Re-running is safe and free.
 *
 * Run while `npm run dev` is up AND LM Studio has `llama-mesh` loaded:
 *   npx tsx scripts/pregenerate-preset-assets.ts
 */

import { DEMO_PRESETS } from '../lib/demo-presets';

const BASE = process.env.PREGEN_BASE_URL || 'http://localhost:3000';

async function generate2d(presetId: string, config: unknown, generationId: string) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/generate-assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, generationId }),
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (!r.ok) {
      console.error(`[${presetId}] 2D HTTP ${r.status} in ${dt}s`);
      return false;
    }
    const data = (await r.json()) as {
      background_url?: string | null;
      character_url?: string | null;
      platform_url?: string | null;
      message?: string;
    };
    const filled = [
      data.background_url ? 'bg' : null,
      data.character_url ? 'char' : null,
      data.platform_url ? 'plat' : null,
    ].filter(Boolean).join('+');
    console.log(`[${presetId}] 2D OK in ${dt}s — ${filled} (${data.message ?? ''})`);
    return true;
  } catch (err) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[${presetId}] 2D threw in ${dt}s:`, (err as Error)?.message);
    return false;
  }
}

interface PresetConfigLite {
  mood?: string;
  style?: string;
  main_character?: { description?: string };
}

async function generateMesh(presetId: string, config: PresetConfigLite, generationId: string) {
  const t0 = Date.now();
  const description = config.main_character?.description || 'dream wanderer';
  try {
    const r = await fetch(`${BASE}/api/generate-mesh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description,
        mood: config.mood,
        style: config.style,
        generationId,
      }),
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (!r.ok) {
      console.error(`[${presetId}] mesh HTTP ${r.status} in ${dt}s`);
      return false;
    }
    const data = (await r.json()) as {
      character_obj_url?: string | null;
      generated?: number;
      fallback?: boolean;
    };
    if (!data.character_obj_url) {
      console.warn(`[${presetId}] mesh null in ${dt}s (fallback=${data.fallback})`);
      return false;
    }
    console.log(`[${presetId}] mesh OK in ${dt}s — ${data.character_obj_url}`);
    return true;
  } catch (err) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[${presetId}] mesh threw in ${dt}s:`, (err as Error)?.message);
    return false;
  }
}

(async () => {
  console.log(`Pregenerating preset assets via ${BASE}`);
  console.log(`Targets: ${DEMO_PRESETS.length} presets × (2D triple + OBJ mesh)\n`);

  let ok2d = 0;
  let okMesh = 0;
  for (const p of DEMO_PRESETS) {
    if (await generate2d(p.id, p.config, p.generationId)) ok2d += 1;
    if (await generateMesh(p.id, p.config as PresetConfigLite, p.generationId)) okMesh += 1;
  }

  console.log(
    `\nDone: 2D ${ok2d}/${DEMO_PRESETS.length}, mesh ${okMesh}/${DEMO_PRESETS.length} cached.`,
  );
  process.exit(ok2d === DEMO_PRESETS.length && okMesh === DEMO_PRESETS.length ? 0 : 1);
})();
