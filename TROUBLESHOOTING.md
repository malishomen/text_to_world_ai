# DreamCraft — Troubleshooting

Common failure modes for the web MVP, ranked roughly by how often we hit them.
For background on _why_ the system behaves this way see `memory.md` and `FIX_PLAN.md`.

---

## Build / install issues

### `npm ci` fails with platform-specific native package errors

**Symptom:** errors involving `sharp`, `esbuild`, `@next/swc-*` after cloning on
a different OS than the lockfile was generated on (typical when the lockfile
was created on macOS and you are on Windows, or vice-versa).

**Fix:**

```bash
cd web
rm -rf node_modules package-lock.json
npm install
```

**Long term:** the project is **macOS-primary**; Windows is best-effort. Some
GLB tools and the TRELLIS local Gradio path are Linux/macOS-only.

### `npm run build` fails with "Module not found: @/lib/..."

**Cause:** TypeScript path-alias misconfiguration. The `@/*` alias is defined
in `web/tsconfig.json` and Next.js picks it up automatically.

**Fix:**

1. Verify `tsconfig.json` has `"paths": { "@/*": ["./*"] }` under `compilerOptions`.
2. Restart the dev server — Next.js caches path resolution.
3. If you renamed a file under `web/lib/`, confirm the import path matches the
   actual filename (case-sensitive on Linux / macOS).

### `npm run lint` fails with rules from `react-hooks/*`

Common cases and fixes:

- **`setState` in effect on hydration boundaries** — acceptable when reading
  `localStorage`. Use an inline disable with a brief comment explaining the
  SSR/hydration reason.
- **`Math.random()` during render** — refactor to a `useRef` lazy init, or use
  a seeded RNG (see `makeRng` in `DreamGame3D.tsx` for the deterministic-seed
  pattern introduced in Phase 6).
- **Missing dependency in `useEffect`** — usually a real bug. Add the dep, or
  capture the latest value via a ref.

### TypeScript "strict mode" errors after pulling

**Fix:** run `npx tsc --noEmit` from `web/` to see every error in one pass.
Most often it's a missing import after a refactor — fix the import.

---

## AI service issues

### LM Studio (or Ollama) offline

**Symptom:** `/loading-dream` waits up to ~25s, then the user lands on `/play`
with a fallback `GameConfig` whose mood/style/palette were derived from keyword
heuristics in `lib/fallback-config.ts`.

**Cause:** Nothing is listening on `QWEN_BASE_URL` (default `http://localhost:1234`,
which is LM Studio's port — **not** Ollama's `:11434`).

**Fix (choose one):**

1. Start LM Studio with the `qwen3-coder-30b-a3b-instruct-mlx` model loaded.
2. Switch to Ollama: set `QWEN_BASE_URL=http://localhost:11434` and
   `QWEN_MODEL=qwen2.5:7b` (or any model you have pulled).
3. Skip the LLM entirely with `NEXT_PUBLIC_DEV_FAKE_AI=1` for UI / scene work.

### Stable Diffusion offline

**Symptom:** `/play` shows procedural visuals only — no PNG textures applied.

**Cause:** Nothing on `SD_BASE_URL` (default `http://127.0.0.1:7860`). The route
performs a 2s health probe and returns nulls immediately if SD is unreachable —
it does **not** block `/play`.

**Fix:** in your `stable-diffusion-webui` directory:

```bash
./webui.sh --api --listen
```

The `--api` flag is required; `--listen` lets the API accept connections from
the dev server.

### `HF_TOKEN` missing

**Symptom:** `/api/generate-3d` returns
`{ fallback: true, error: "HF_TOKEN not set", ... }`.

**Cause:** `TRELLIS_URL` defaults to a HuggingFace Space
(`JeffreyXiang/TRELLIS-image-large`), and HF requires a token for programmatic
access.

**Fix:**

1. Sign in to <https://huggingface.co/settings/tokens>.
2. Create a free **Read** token.
3. Add it to `web/.env.local`:
   ```env
   HF_TOKEN=hf_xxx
   ```
4. Restart the dev server (env vars are read at process start).

### TRELLIS HF Space sleeping

**Symptom:** `/api/generate-3d` returns
`{ fallback: true, error: "HF Space stage: SLEEPING", ... }`.

**Cause:** HF's autoscaler put the Space to sleep. Cold start ~30 seconds.

**Fix:** open <https://huggingface.co/spaces/JeffreyXiang/TRELLIS-image-large>
in a browser to warm it up, wait until the "Running" badge appears, then retry.

### TRELLIS local server unreachable

**Symptom:** `/api/generate-3d` returns
`{ fallback: true, error: "Local TRELLIS not running", ... }`.

**Cause:** `TRELLIS_URL` is set to an `http://...` URL and the route's 3-second
`/info` probe failed.

**Fix:** TRELLIS requires **Linux + NVIDIA CUDA**. On macOS or Windows, switch
back to the HF Space:
```env
TRELLIS_URL=JeffreyXiang/TRELLIS-image-large
```

---

## `/loading-dream` issues

### Page stuck on "Launching Godot engine..." (or similar)

**Should never happen.** Post-FIX_PLAN Phase A the client hard-timer at
`NEXT_PUBLIC_MAX_GENERATION_MS` (default 75 000 ms) always navigates to `/play`,
even if every API hangs.

**If it does happen:**

1. Open DevTools → Console — look for thrown errors blocking the navigation.
2. DevTools → Sources — search for `goPlay(` to confirm the timer's navigate
   call is wired up.
3. As a last resort, manually navigate to `/play` and check that `gameConfig`
   exists in `localStorage`.

### `/loading-dream` navigates immediately

**Cause:** `NEXT_PUBLIC_DEV_FAKE_AI=1` is set. Working as designed — the page
short-circuits after ~3s and uses `buildFallback(dream)`.

---

## `/play` issues

### Direct hit on `/play` → bounces back to `/`

**Expected behaviour.** `/play` requires `gameConfig` in `localStorage`; the
guard redirects to the landing page if absent. Phase C and Phase 7 of the
12-phase plan introduced and refined this redirect.

### "Loading dream world…" stays forever

**Cause:** corrupt `gameConfig` in `localStorage` that the Phase 2/7 normaliser
could not heal.

**Fix:** in DevTools → Application → Storage → Local Storage →
`http://localhost:3000`, delete the `gameConfig`, `gameAssets`, and
`generationId` keys, then refresh.

### Canvas is blank / black

**Causes:**

- WebGL2 is not supported (very old browser).
- `@react-three/rapier`'s WASM module failed to load (cached 404).

**Fix:** open Console — look for `WebAssembly` or `WebGL` errors. Hard-refresh
(Ctrl/Cmd-Shift-R) to clear cached WASM. Try a Chromium-based browser (Chrome,
Edge, Brave) — they have the best WebGL2 + WASM coverage.

### WASD / Space don't work

**Cause:** keyboard focus is on the sidebar instead of the Canvas.

**Fix:** click anywhere inside the Canvas. Phase 8 of the 12-phase plan added
an on-screen hint ("Click here to give canvas focus") for first-time users.

---

## Generated assets

### Cleaning up `public/generated/` and `public/generated3d/`

These directories grow unbounded across development sessions. Phase 3 isolated
each generation into its own subdir (`<generationId>/`), but nothing prunes
old subdirs automatically.

Safe to wipe at any time — the directories are recreated on the next generation:

```bash
rm -rf web/public/generated web/public/generated3d
```

### Old assets visible in `/play` after clicking "New Dream"

**Expected behaviour: should not happen.** Phase 3 plus the "New Dream" button
clear `localStorage` (including `generationId`), forcing the next run to mint a
fresh id.

**If it does happen:**

1. Run the cleanup command above.
2. Hard-refresh.
3. Confirm DevTools → Application → Storage shows no stale `generationId`.

---

## Godot (experimental)

Reminder: Godot is **not the demo path** — see `LEGACY.md`. These notes apply
only when you have explicitly opted in with `WRITE_GODOT_ASSETS=1`.

### `WRITE_GODOT_ASSETS=1` doesn't write to `godot/assets/`

**Cause:** `web/app/api/generate-3d/route.ts` checks the literal string `'1'`:

```ts
const writeGodot = process.env.WRITE_GODOT_ASSETS === '1';
```

**Fix:** confirm the value in `.env.local` is exactly `1` (no quotes, no `true`,
no `yes`). Restart the dev server.

### `godot/dream_config.json` is stale

That file is rewritten **only** on a successful `/api/generate-3d` run with
`WRITE_GODOT_ASSETS=1`. Delete it manually if you want a clean slate before the
next run.

---

## Where to look when something else breaks

| Symptom | First place to look |
|---|---|
| Network failures, hung requests | DevTools Network tab + terminal output of `npm run dev`. |
| API 4xx/5xx | Terminal output — `lib/api-errors.ts` produces structured, redacted logs. |
| 3D scene errors | Browser Console (R3F prints rich messages on shader/geometry issues). |
| Schema / parse issues | `web/lib/game-config-schema.ts` is the source of truth for accepted shapes. |
| "Why did it fall back?" | Check the response body — `{ fallback: true, error, message }` is the contract. |
| Verification commands | `memory.md` § 6 (quick verification commands). |

For anything not covered here, capture the exact error text + the terminal
output of `npm run dev` and add it to `memory.md § 7` (the session log).
