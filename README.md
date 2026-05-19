# DreamCraft — Dream → Playable 3D World

> Hackathon AI orchestrator: type a dream → get a playable 3D platformer in <90 seconds.
> Status: development. Main demo path is browser-based (Next.js 16 + React 19 + Three.js + Rapier).

---

## What is this?

DreamCraft turns a free-form dream description into a tiny playable 3D platformer
that runs entirely in the browser. The user types (or speaks) a dream, an LLM
analyses it into a structured `GameConfig` (mood, palette, narrative, character
description, enemy count, etc.), an optional Stable Diffusion pass generates 2D
PNG sprites, an optional TRELLIS pass turns reference images into 3D GLB models,
and a Three.js + Rapier scene assembles the final playable level.

Everything that is "external AI" (LLM, SD, TRELLIS) is **optional**. If a service
is offline the orchestrator degrades gracefully: it returns a sensible fallback
config derived from keyword heuristics and the scene falls back to procedural
visuals. The result: a hackathon demo that never gets stuck on a loading screen.

---

## Assets are decorative — the game never blocks on them

The 3D playable scene is **procedural by default**. The `GameConfig` produced
by `/api/analyze` (or by the keyword fallback when the LLM is offline) is
sufficient on its own to render a complete, playable level — platforms, player,
enemies, portal, palette, and music prompt. The LLM, Stable Diffusion, and
TRELLIS layers exist only to *enrich* what is already a working scene.

When SD or TRELLIS eventually produce assets (PNG textures, GLB models), they
are applied to the running scene via React Suspense fallbacks. `DreamGame3D`
uses `useGLTF` and `useTexture` from `@react-three/drei`, both of which
suspend the consuming component until the asset is ready and substitute the
procedural placeholder until then. **The game never blocks on asset loading.**
A failed network fetch, a 404, or a slow CDN response simply leaves the
procedural placeholder in place; the game keeps playing.

---

## Late asset delivery — assets that arrive after `/play` mounts

The asset jobs (`/api/generate-3d` for GLBs, `/api/generate-assets` for PNGs)
are slow: 30-90 seconds each for the full TRELLIS pipeline. They almost always
finish AFTER the user has navigated from `/loading-dream` to `/play`. Phase P0
rebuilt the asset pipeline so this is no longer a problem:

1. `/api/analyze` returns the normalized `GameConfig` in 2-25 seconds.
2. `/loading-dream` fires `/api/generate-assets` and `/api/generate-3d` as
   **fire-and-forget** requests — no `AbortSignal` tied to the navigation. The
   requests survive the route change to `/play`.
3. When either response lands, the loading page writes the result into
   `localStorage.gameAssets` and dispatches a `dreamAssetsUpdated`
   `CustomEvent` on `window`.
4. `/play` registers two listeners on mount: a `window` listener for the
   `dreamAssetsUpdated` event (same-tab updates) **and** a `storage` listener
   (cross-tab updates from `localStorage` changes). Both push the new assets
   into `DreamGame3D` as props.
5. `DreamGame3D` re-renders. `useGLTF` / `useTexture` suspend on the new URLs,
   show the procedural placeholder while loading, then swap in the real asset.

**No page reload is required.** Open DevTools → Application → Local Storage to
watch `gameAssets` get written, then look at the canvas — the textures swap
in over the procedural fallback within one frame of the network response.

---

## Demo paths

There are four ways to run the demo, ranging from "nothing required" to "full AI stack".

### 1. Main: Web MVP, no AI services (recommended for first-time setup)

This is the fastest and most reliable path. Suitable for testing the 3D scene,
the UI flow, and the overall feel without installing LM Studio / Ollama / SD / TRELLIS.

```bash
cd web
npm ci
echo "NEXT_PUBLIC_DEV_FAKE_AI=1" > .env.local
npm run dev
# open http://localhost:3000
```

With `NEXT_PUBLIC_DEV_FAKE_AI=1` the loading screen waits ~3 seconds, then jumps
straight to `/play` with a keyword-derived fallback `GameConfig`. No external
calls are made. Use this to verify the install before bringing AI services online.

### 2. Optional: with a local LLM (LM Studio or Ollama)

Add an OpenAI-compatible LLM. The **code default is LM Studio at `:1234`**, not
Ollama at `:11434`. You can point at either.

`web/.env.local`:

```env
QWEN_BASE_URL=http://localhost:1234              # LM Studio default
QWEN_MODEL=qwen3-coder-30b-a3b-instruct-mlx
# Or for Ollama:
# QWEN_BASE_URL=http://localhost:11434
# QWEN_MODEL=qwen2.5:7b
```

Start the model server, then `npm run dev`. The loading screen will now call
`/api/analyze` and use the LLM's `GameConfig` instead of the keyword fallback.

### 3. Optional: with Stable Diffusion (Automatic1111)

Adds PNG sprites for background, character, and platform.

Start Automatic1111 WebUI with the API enabled:

```bash
# inside your stable-diffusion-webui directory:
./webui.sh --api --listen
```

Then in `web/.env.local`:

```env
SD_BASE_URL=http://127.0.0.1:7860
```

If SD is down, `/api/generate-assets` returns nulls in ~2 seconds and the demo
proceeds with procedural visuals — it never blocks `/play`.

### 4. Optional: with TRELLIS (3D GLB generation)

The richest path. Generates per-dream `character.glb`, `prop.glb`, `portal.glb`.

Two ways to run TRELLIS:

- **HuggingFace Space (default):** `TRELLIS_URL=JeffreyXiang/TRELLIS-image-large`
  requires a free token from <https://huggingface.co/settings/tokens>:
  ```env
  HF_TOKEN=hf_xxx
  ```
  The Space sleeps when idle; first call after a cold start takes ~30 seconds.
- **Local Gradio:** TRELLIS requires Linux + NVIDIA CUDA. Run it on `:7861`, then
  set `TRELLIS_URL=http://127.0.0.1:7861`.

Note: TRELLIS is long-running (45-90s per asset). The hard client timeout
(`NEXT_PUBLIC_MAX_GENERATION_MS`, default 75s) will navigate the user to `/play`
before TRELLIS finishes — the 3D models stream into the scene afterwards
(fire-and-forget; see the "Late asset delivery" section above).

---

## Quick start (macOS / Linux, fake-AI mode)

```bash
cd web
npm ci
echo "NEXT_PUBLIC_DEV_FAKE_AI=1" > .env.local
npm run dev
# open http://localhost:3000
```

Flow:

1. Landing page (`/`) — type a dream, click "Craft My Game".
2. Loading screen (`/loading-dream`) — orchestrates the API calls and the hard timer.
3. Play (`/play`) — DreamGame3D Canvas mounts; WASD to move, Space to jump,
   reach the portal to win.

In fake-AI mode the round-trip from input to playable scene takes ~3 seconds.
Useful for testing the 3D scene without LM Studio, SD, or TRELLIS installed
locally.

---

## Environment variables

All vars live in `web/.env.local` (gitignored). See `web/.env.local.example` for
the documented template.

| Variable | Default | Effect |
|---|---|---|
| `QWEN_BASE_URL` | `http://localhost:1234` | OpenAI-compatible LLM base URL (LM Studio default; Ollama at `:11434`). |
| `QWEN_MODEL` | `qwen3-coder-30b-a3b-instruct-mlx` | Model id sent in chat completions. |
| `SD_BASE_URL` | `http://127.0.0.1:7860` | Automatic1111 WebUI API. |
| `TRELLIS_URL` | `JeffreyXiang/TRELLIS-image-large` | HF Space id OR `http://...` for local Gradio. |
| `HF_TOKEN` | _(empty)_ | Required when `TRELLIS_URL` is an HF Space. |
| `NEXT_PUBLIC_MAX_GENERATION_MS` | `75000` | Hard client timeout on `/loading-dream` before navigating. |
| `NEXT_PUBLIC_DEV_FAKE_AI` | `0` | When `1`, skip all AI calls and use fallback after 3 seconds. |
| `WRITE_GODOT_ASSETS` | `0` | When `1`, `/api/generate-3d` also mirrors GLBs into `godot/assets/` and writes `godot/dream_config.json`. |

`NEXT_PUBLIC_*` variables are bundled into the client; everything else is
server-only.

---

## Architecture

```
                        Browser (Next.js client)
                                 |
                       1. POST /api/analyze
                                 |  (dream:string, ≤5000 chars)
                                 v
                    LLM  ◄── OpenAI-compatible HTTP API
                                 |
                          GameConfig JSON
                                 |
        +------------------------+------------------------+
        |                                                 |
        v                                                 v
  2. POST /api/generate-3d                  3. POST /api/generate-assets
        |  (fire-and-forget — no AbortSignal)              |  (fire-and-forget)
        |  (config, generationId)                          |  (config, generationId)
        v                                                  v
  SD → reference PNG                          SD → PNG sprites
  TRELLIS → 3 GLBs                            background/character/platform.png
  public/generated3d/<id>/                    public/generated/<id>/
        |                                                  |
        +----- localStorage.gameAssets + dreamAssetsUpdated event -----+
                                  |
                  Hard timer at NEXT_PUBLIC_MAX_GENERATION_MS
                  OR /api/analyze settles — whichever first
                                  |
                                  v
                              /play
                                  |
                       DreamGame3D mounts (procedural)
                                  |
                       dreamAssetsUpdated arrives
                                  |
                       <Suspense> swaps in real assets
                       (R3F + Rapier + drei useGLTF/useTexture)
```

Notes:

- The hard client timer at `/loading-dream` **always** navigates to `/play`,
  even if every API hangs. The post-FIX_PLAN invariant is: no infinite loading.
- Per-generation isolation via `generationId`: assets land in
  `public/generated/<id>/` and `public/generated3d/<id>/` so concurrent or
  re-tried generations cannot stomp on each other.
- `/play` requires `gameConfig` in `localStorage`; direct hits bounce back to `/`.
- Asset delivery is fully decoupled from navigation. See "Late asset delivery".

---

## Branch discipline

- Active development: `test`.
- Protected: `main`. Merged **only** on the literal user signal `merge main now`.
- See `agent.md § 1.1` for the full rule.
- Before any `git push`: `git status` is mandatory.

---

## Project layout

```
DreamAI/
├── web/                       # Next.js 16 web app (PRIMARY demo path)
│   ├── app/                   # App Router pages and API routes
│   │   ├── page.tsx           # Landing — dream input
│   │   ├── loading-dream/     # Orchestrator + hard timer + fire-and-forget assets
│   │   ├── play/              # 3D game shell + dreamAssetsUpdated listener
│   │   └── api/
│   │       ├── analyze/       # POST → GameConfig via LLM (incl. extended fields)
│   │       ├── generate-3d/   # POST → GLBs via TRELLIS (parseGameConfigExtended)
│   │       └── generate-assets/  # POST → PNGs via SD (parseGameConfig)
│   ├── components/
│   │   └── DreamGame3D.tsx    # R3F Canvas: Player, Platforms, Portal (useGLTF/useTexture)
│   ├── lib/                   # Pure helpers (no I/O at import time)
│   │   ├── fallback-config.ts     # GameConfig type + buildFallback
│   │   ├── with-timeout.ts        # Promise timeout wrapper
│   │   ├── game-config-schema.ts  # zod schema + parseGameConfig / parseGameConfigExtended
│   │   ├── generation-id.ts       # ID validation + newGenerationId
│   │   ├── generated-paths.ts     # path-safe builders for public/generated*
│   │   ├── game-assets.ts         # GameAssets type, mergeAssetResponses, dreamAssetsUpdated event name
│   │   └── api-errors.ts          # badRequest / fallbackOk / logApiError
│   ├── e2e/                   # Playwright smoke specs (smoke.spec.ts)
│   ├── playwright.config.ts   # Headless Chromium config; webServer auto-starts dev
│   ├── public/
│   │   ├── generated/         # 2D output — gitignored, per-id subdirs
│   │   └── generated3d/       # 3D output — gitignored, per-id subdirs
│   └── .env.local.example
├── agents/                    # EXPERIMENTAL / LEGACY — Python orchestrator v1
├── godot/                     # EXPERIMENTAL / LEGACY — Godot 4 export shell
├── main.py                    # EXPERIMENTAL / LEGACY — Python entrypoint
├── requirements.txt           # Python deps (legacy path)
├── docs/
│   ├── PROJECT_MAP.yaml       # Structural map (single source of truth)
│   └── PRODUCTION_PLAN.md     # Future production architecture (NOT YET implemented)
├── README.md                  # this file
├── TROUBLESHOOTING.md         # common errors + fixes
├── LEGACY.md                  # what is experimental, why, how to use today
├── FIX_PLAN.md                # audited 5-phase fix plan (shipped)
├── agent.md                   # AI-agent operating manual
└── memory.md                  # persistent agent memory
```

See [LEGACY.md](LEGACY.md) for the canonical statement on which parts of the
repo are experimental / not in the main demo path.

---

## Tech stack (truthful)

- **Frontend:** Next.js **16**.2 (App Router, React **19**.2), Three.js 0.184,
  `@react-three/fiber` 9, `@react-three/rapier` 2, `@react-three/drei` 10
  (with `useGLTF` and `useTexture` consumers for late-arriving 3D / 2D assets),
  Tailwind CSS 4, Framer Motion 12, `lucide-react`.
- **Schema:** `zod` 4 (`web/lib/game-config-schema.ts`).
- **LLM:** OpenAI-compatible HTTP API. **Default is LM Studio at `:1234`**;
  Ollama also works at `:11434`.
- **Image gen (optional):** Automatic1111 SD WebUI at `:7860`.
- **3D gen (optional):** TRELLIS via HuggingFace Space (default) or local Gradio.
- **Unit tests:** **Vitest 4** (213 cases in `web/lib/__tests__/`, all green).
- **E2E tests:** **`@playwright/test` 1.49** (11 smoke cases in `web/e2e/`,
  headless Chromium, see `web/playwright.config.ts`).
- **Experimental / legacy:** Python orchestrator under `agents/` and Godot 4
  export shell under `godot/`. Not in the demo path — see `LEGACY.md`.

---

## Scripts

From `web/package.json`:

| Script | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server on port 3000 with HMR. |
| `npm run build` | Production build. |
| `npm run start` | Serve the production build. |
| `npm run lint` | Run ESLint (`eslint-config-next`). |
| `npm run typecheck` | Run TypeScript in `--noEmit` mode (no JS output). |
| `npm run test` | Run Vitest in one-shot mode (CI-friendly). |
| `npm run test:watch` | Run Vitest in watch mode (rerun on file changes). |
| `npm run test:e2e` | Run Playwright e2e suite (headless Chromium). |
| `npm run test:e2e:install` | Install Chromium browser binary required by Playwright. |
| `npm run check` | `lint && typecheck && test` — the standard CI gate. |
| `npm run check:full` | `check && test:e2e` — full CI gate including e2e. |

---

## Known non-blocking console warnings

You may see these in the browser DevTools console when running `/play`. Both
come from `@react-three/drei` / Three.js internals (not our code) and are
non-blocking:

- `THREE.Clock: getDelta() ... deprecated` — from the R3F render loop.
- `THREE.PCFSoftShadowMap is deprecated` — drei uses it under the hood for soft
  shadows.

Both are scheduled for removal in future Three.js / drei releases. No action
required on our side.

---

## Documentation

- `docs/PROJECT_MAP.yaml` — structural map (single source of truth for layout,
  env vars, API surface, dataflow). Updated in the same session as code changes.
- `docs/PRODUCTION_PLAN.md` — production architecture plan; **NOT yet implemented**.
- `memory.md` — persistent agent memory (history + decisions, append-only log).
- `agent.md` — AI-agent operating manual.
- `FIX_PLAN.md` — audited initial fix plan (phases A-E) for the infinite-loading bug.
- `TROUBLESHOOTING.md` — common errors and their fixes.
- `LEGACY.md` — status of the Python orchestrator and Godot shell.

---

## Hackathon context

DreamCraft is hackathon-grade software. The original prototype shipped with an
infinite-loading bug on `/loading-dream` whenever any of the three AI services
hung. The audited `FIX_PLAN.md` (phases A through D) stabilised the flow with a
hard client timer, graceful fallbacks, and unified `genre: '3d_platformer'`. A
follow-up 12-phase plan added zod-based schema validation (Phase 2),
`generationId` isolation for per-run asset directories (Phase 3), API hardening
with structured errors and secret redaction (Phase 5), responsive UI fixes
(Phase 7-8), deterministic level seeding (Phase 6 — `makeRng` in
`DreamGame3D`), Vitest tests for `lib/` helpers (Phase 11), and these docs
(Phases 9-10). The most recent **P0–P4 quality plan** added the
`dreamAssetsUpdated` event pipeline for late-arriving assets, strict
`parseGameConfigExtended` validation in `/api/generate-3d`, the `game-assets.ts`
module with `GameAssets` type + `mergeAssetResponses`, 35 additional unit
tests (213 total), and the 11-case Playwright smoke suite.

---

## License

Not specified. (No `LICENSE` file present in the repository.)
