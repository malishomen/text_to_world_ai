/**
 * One-off script: hit /api/generate-assets for every DEMO_PRESETS entry so
 * the FLUX background + character + platform texture triple is cached on
 * disk under web/public/generated/2d/<generationId>/ BEFORE the demo.
 *
 * Idempotent: /api/generate-assets short-circuits when all three PNGs
 * already exist. Re-running is safe and free.
 *
 * Run while `npm run dev` is up:
 *   npx tsx scripts/pregenerate-preset-assets.ts
 */

import { DEMO_PRESETS } from '../lib/demo-presets';

const BASE = process.env.PREGEN_BASE_URL || 'http://localhost:3000';

async function generateOne(presetId: string, config: unknown, generationId: string) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}/api/generate-assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, generationId }),
    });
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    if (!r.ok) {
      console.error(`[${presetId}] HTTP ${r.status} in ${dt}s`);
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
    console.log(
      `[${presetId}] OK in ${dt}s — ${filled} (${data.message ?? ''})`,
    );
    return true;
  } catch (err) {
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.error(`[${presetId}] threw in ${dt}s:`, (err as Error)?.message);
    return false;
  }
}

(async () => {
  console.log(`Pregenerating preset assets via ${BASE}/api/generate-assets`);
  console.log(`Targets: ${DEMO_PRESETS.length} presets\n`);

  // Sequential so we don't blow the fal.ai rate ceiling or spam logs.
  let ok = 0;
  for (const p of DEMO_PRESETS) {
    const success = await generateOne(p.id, p.config, p.generationId);
    if (success) ok += 1;
  }

  console.log(`\nDone: ${ok}/${DEMO_PRESETS.length} presets cached.`);
  process.exit(ok === DEMO_PRESETS.length ? 0 : 1);
})();
