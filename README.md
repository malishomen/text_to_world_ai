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
(fire-and-forget).

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
        |                                                 |
        |  (config, generationId)                         |  (config, generationId)
        v                                                 v
  SD → reference PNG                          SD → PNG sprites
  TRELLIS → 3 GLBs                            background/character/platform.png
  public/generated3d/<id>/                    public/generated/<id>/
        |                                                 |
        +--- (fire-and-forget) ---+--- (fire-and-forget) +
                                  |
                  Hard timer at NEXT_PUBLIC_MAX_GENERATION_MS
                  OR Promise.allSettled — whichever first
                                  |
                                  v
                              /play
                                  |
                       DreamGame3D mounts
                       (R3F + Rapier + drei)
```

Notes:

- The hard client timer at `/loading-dream` **always** navigates to `/play`,
  even if every API hangs. The post-FIX_PLAN invariant is: no infinite loading.
- Per-generation isolation via `generationId`: assets land in
  `public/generated/<id>/` and `public/generated3d/<id>/` so concurrent or
  re-tried generations cannot stomp on each other.
- `/play` requires `gameConfig` in `localStorage`; direct hits bounce back to `/`.

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
│   │   ├── loading-dream/     # Orchestrator + hard timer
│   │   ├── play/              # 3D game shell
│   │   └── api/
│   │       ├── analyze/       # POST → GameConfig via LLM
│   │       ├── generate-3d/   # POST → GLBs via TRELLIS
│   │       └── generate-assets/  # POST → PNGs via SD
│   ├── components/
│   │   └── DreamGame3D.tsx    # R3F Canvas: Player, Platforms, Portal
│   ├── lib/                   # Pure helpers (no I/O at import time)
│   │   ├── fallback-config.ts     # GameConfig type + buildFallback
│   │   ├── with-timeout.ts        # Promise timeout wrapper
│   │   ├── game-config-schema.ts  # zod schema + parseGameConfig
│   │   ├── generation-id.ts       # ID validation + newGenerationId
│   │   ├── generated-paths.ts     # path-safe builders for public/generated*
│   │   └── api-errors.ts          # badRequest / fallbackOk / logApiError
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
  `@react-three/fiber` 9, `@react-three/rapier` 2, `@react-three/drei` 10,
  Tailwind CSS 4, Framer Motion 12, `lucide-react`.
- **Schema:** `zod` 4 (`web/lib/game-config-schema.ts`).
- **LLM:** OpenAI-compatible HTTP API. **Default is LM Studio at `:1234`**;
  Ollama also works at `:11434`.
- **Image gen (optional):** Automatic1111 SD WebUI at `:7860`.
- **3D gen (optional):** TRELLIS via HuggingFace Space (default) or local Gradio.
- **Tests:** Vitest is the chosen runner; tests for `lib/` helpers are added
  alongside the 12-phase plan in `web/lib/__tests__/`.
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

Type checking is available via `npx tsc --noEmit` from `web/`.

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
`DreamGame3D`), Vitest tests for `lib/` helpers (Phase 11), and these docs (Phases 9-10).

---

## License

Not specified. (No `LICENSE` file present in the repository.)
