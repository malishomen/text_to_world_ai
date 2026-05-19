# memory.md — DreamCraft persistent memory

> **Purpose:** persistent memory between AI-agent sessions. Holds what
> **cannot be derived by reading code** — history of decisions, discovered
> pitfalls, current operational snapshot.
>
> **Trinity partners:**
> - [`docs/PROJECT_MAP.yaml`](docs/PROJECT_MAP.yaml) — static map (what exists)
> - [`agent.md`](agent.md) — behavior rules (how to act)
> - **`memory.md` (this file)** — dynamic state and history
>
> **Update rule:** after each meaningful session, append a new entry to
> `## 4. Session log` at the bottom — WITHOUT rewriting old ones.

---

## 0. How to read

| What you need | Section |
|---|---|
| Eternal truths about this project | § 1. Key invariants |
| Current bugs and workarounds | § 2. Known issues & workarounds |
| Why was it done this way | § 3. Decisions & rationale |
| History of past sessions | § 4. Session log (append-only) |
| What works/doesn't right now | § 5. Current operational state |
| Frequently used commands | § 6. Quick reference |

---

## 1. Key invariants

### 1.1. Branch discipline — `main` is sacred
- Active development happens **only in `test`**.
- Merge `test` → `main` requires user's **literal explicit signal**: the phrase `merge main now`.
- No "I assume you wanted to merge". Ever.
- Force-push to `main` is forbidden.

### 1.2. `/loading-dream` MUST always navigate
- Page must reach `/play` (or back to `/`) within `NEXT_PUBLIC_MAX_GENERATION_MS` (default 75s).
- The single source of navigation is `goPlay(reason)` with a `navigated.current` guard — no double `router.push`.
- If `gameConfig` already exists in localStorage when timeout fires → do NOT overwrite with fallback.
- AbortError from cancelled fetch is expected — do not surface as user-facing error.
- Reference: `web/app/loading-dream/page.tsx`, `FIX_PLAN.md § Phase A.1`.

### 1.3. `genre` field is `3d_platformer` everywhere
- The game IS 3D (Three.js + Rapier). Every fallback config must use `genre: '3d_platformer'`.
- Pre-Phase-A code had `2d_platformer` in 3 fallback paths — caused wrong sidebar label.
- Single source of truth: `web/lib/fallback-config.ts` (Phase A.2).

### 1.4. Secrets never in git
- `.env`, `.env.local`, anything matching `.env.*` (except `.env.*.example`) — gitignored.
- HF_TOKEN, any future API keys — never logged, never committed.

### 1.5. `PROJECT_MAP.yaml` syncs without reminders ⚠️
- Any code/schema/deploy change affecting map content **must update PROJECT_MAP.yaml in the same session**.
- User is not obliged to remind — agent's responsibility.
- Triggers and self-check — in `agent.md § 1.0`.
- If map drifts from code = bug requiring immediate correction.

### 1.6. AGENTS.md warning about Next.js 16
- `web/AGENTS.md` explicitly says: "This is NOT the Next.js you know. APIs, conventions, and file structure may differ. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code."
- Do not assume Next 13/14 patterns work.
- Do not touch `next.config.ts` casually.

---

## 2. Known issues & workarounds

### 2.1. lucide-react@^1.16.0 — suspicious version
**Symptom:** version 1.x is unusual (mainline is 0.46x).
**Cause:** unknown — may be a fork or a typo in package.json.
**Workaround:** works; icons render. **Do not upgrade before demo.**
**Permanent fix:** post-demo, verify `npm ls lucide-react` and align with `lucide-react@latest` if safe.

### 2.2. CRLF warnings on `git add` (Windows)
**Symptom:** Git prints "LF will be replaced by CRLF" for every file.
**Cause:** Default `core.autocrlf` on Windows.
**Workaround:** Ignore — content unchanged; only line endings on checkout.
**Permanent fix:** N/A. Optional `.gitattributes` to pin LF for source files.

---

## 3. Decisions & rationale

### 3.1. Single repo, no submodules
The `web/` folder had its own `.git` from `create-next-app` with one boilerplate
commit. Removed to keep one history and avoid submodule confusion in a hackathon.
**Alternatives:** keep as submodule (overhead not worth it for a 3-day project).
**Reference:** see initial commit `94f530a`.

### 3.2. Repo root = `web/DreamAI`, not `D:\projects\Hackatton`
The Hackatton folder also contains `__MACOSX/` cruft and an unrelated `V1/`
nesting. Initialized git at `V1/DreamAI` to match the repo name `text_to_world_ai`
and keep history clean.
**Alternatives:** init at Hackatton root (would include `__MACOSX/`, `V1/` shell).

### 3.3. Hard client-side timeout (Phase A) over per-API timeouts only
Even with B's server-side timeouts, an unhandled hang in any API layer would
still block `Promise.allSettled`. The client owns its UX — it is responsible
for never showing a frozen "Launching Godot engine…" screen. Hence dual defense.
**Reference:** `FIX_PLAN.md § Phase A.1`.

### 3.4. `genre` unification via shared lib (Phase A.2)
The same fallback was duplicated in 3 places with diverging `genre` values.
Single `buildFallback(dream)` in `web/lib/fallback-config.ts` eliminates drift.
**Alternatives:** inline per-call (rejected — drift returns).

---

## 4. Session log (append-only, newest at bottom)

### 2026-05-19: 12-phase quality plan shipped (Phases 1–12, 4 commits on `test`)
**Request:** Execute the 12-phase quality plan via subagent decomposition,
ignore concept docs, target macOS dev environment, mark Python/Godot as
legacy (Option A), full audit at the end with all best practices.

**Decomposition:** Wave 0 (parent) + 4 waves × multiple parallel subagents.

**Changes (4 atomic commits on `test`, all green):**
- `ac2a753` fix(phase1): pre-existing lint errors resolved — Math.random in
  Enemy useRef refactored to deterministic phaseSeed prop (parent passes
  via seeded LCG `makeRng` + `hashString`); setState-in-effect cases
  documented with explicit inline disables; eslint config adds
  `argsIgnorePattern: '^_'`. tsc + lint + build all 0.
- `02fa4bf` feat(foundation): four new lib helpers — `game-config-schema.ts`
  (zod 4 strict runtime validation + parseGameConfig normalizer),
  `generation-id.ts` (sticky session id, validator + new/normalize),
  `generated-paths.ts` (path-traversal-safe URL/FS builders),
  `api-errors.ts` (badRequest / unprocessable / fallbackOk / logApiError
  + redactSecrets for hf_*/sk-*/Bearer */token/key fields). Vitest +
  116 unit tests. `docs/PRODUCTION_PLAN.md` (11 sections, 768 lines).
  npm scripts: test, typecheck, check.
- `0735a6e` feat(integration): all three API routes hardened (body
  validation, 5000-char dream cap, structured logs, generationId,
  WRITE_GODOT_ASSETS opt-in gate, wrote_godot in response, no leaked
  stacks); /loading-dream switched to fire-and-forget assets (navigate
  after analyze; assets continue in background) with real status machine;
  /play gains corruption-recovery + responsive mobile layout + Export
  modal (no alert); DreamGame3D seeds level from generationId, mood-driven
  visual variety, canvas focus hint, per-frame Vector3 allocations removed
  in Player + FollowCamera.
- `790ff4f` docs: README rewritten (4 honest demo paths, accurate stack),
  TROUBLESHOOTING.md (build/AI/UI failure modes), LEGACY.md (Python +
  Godot status — Option A), PROJECT_MAP.yaml synced (Convention 2).

**Verification:**
- `npm run lint` → 0 errors, 0 warnings.
- `npx tsc --noEmit` → 0 errors.
- `npm run build` → all 5 routes generate successfully.
- `npm run test` → 116 / 116 tests pass.
- `npm run check` → all three pass in sequence.
- PROJECT_MAP.yaml → YAML valid.

**Current state:**
- `test` at 790ff4f (5 commits ahead of main).
- `main` unchanged at a66d7d9 (awaiting explicit `merge main now`).
- macOS demo path: `cd web && npm ci && echo "NEXT_PUBLIC_DEV_FAKE_AI=1" > .env.local && npm run dev` → /play in 3 s with fallback.
- Full demo path (LM Studio + SD + TRELLIS): graceful degradation at every layer.

**Remaining / artifacts:**
- Optional Phase 11 Playwright smoke (deferred per spec).
- Phase 10 Option B (rehabilitate Python/Godot) — deferred per user.
- User signal `merge main now` to land on production-equivalent branch.

---

### 2026-05-19: merge test → main (Phase A–D + trinity landed)
**Request:** User signal `merge main now` — explicit authorization to land
all `test` work onto `main`.

**Changes:**
- `git checkout main && git merge --no-ff test` → merge commit `a66d7d9`.
- Pushed `origin/main`.
- Fast-forwarded `test` to match (both branches now at `a66d7d9`).

**Current state:**
- `main` and `test` aligned at `a66d7d9`.
- Phase A–D + trinity now in production-equivalent branch.

**Remaining / artifacts:**
- Next user-driven session continues on `test` (branch discipline unchanged).
- Phase E polish still deferred.

---

### 2026-05-19: Phase A–D shipped (infinite-loading killed, server bounded, game restart in-place)
**Request:** Execute FIX_PLAN.md Phases A–D via subagent decomposition, then
full audit + final report.

**Findings:**
- All 4 phases had non-overlapping file scopes — ideal for parallel execution.
- Shared `GameConfig` type needed a canonical home; centralized in
  `web/lib/fallback-config.ts` so all paths (UI, API, fallback) agree.
- Phase D subagent introduced one new lint anti-pattern (`enemyRefs.current = arr`
  during render); fixed by switching to a plain `enemyPositions: THREE.Vector3[]`
  prop — cleaner than the ref wrapper anyway.
- Pre-existing lint warnings (Math.random in Enemy useRef init, setConfig in
  /play effect, etc.) remain; out of scope for this PR.

**Changes (commit 1b5ab79 on `test`):**
- `web/lib/fallback-config.ts` — created (canonical `buildFallback` + `GameConfig` type).
- `web/lib/with-timeout.ts` — created (generic `Promise.race` wrapper).
- `web/app/loading-dream/page.tsx` — rewrote with hard timeout (`MAX_GENERATION_MS`,
  default 75s), single `goPlay()` gate, AbortController, StrictMode + navigation
  guards, full timer cleanup, heartbeat, dev fake-AI shortcut. Saves `gameConfig`
  before parallel asset jobs.
- `web/app/api/analyze/route.ts` — timeout 60s→25s, max_tokens 1024→1500,
  uses unified fallback.
- `web/app/api/generate-3d/route.ts` — HF Space probe (3s) before connect; every
  Gradio call wrapped in `withTimeout` (connect 15s, preprocess 20s, image_to_3d
  60s local / 90s HF, extract_glb 30s); 60s per-request deadline skips remaining
  prompts.
- `web/app/api/generate-assets/route.ts` — SD health check (2s) returns nulls
  if SD offline; per-call timeout 60s→25s; SD steps 20→15.
- `web/app/play/page.tsx` — palette guaranteed 4 colors via `useMemo`;
  `router.push` → `router.replace` on missing config.
- `web/components/DreamGame3D.tsx` — restart without `<Canvas>` re-key (uses
  `restartToken` + `setTranslation`/`wakeUp`); `endedRef` lifted to `DreamScene`;
  grounded via contact counter (eliminates 120ms ghost-jump); per-enemy `Vector3`
  owned by useMemo, mutated in place; Player accepts plain `enemyPositions[]`.
  GameConfig type re-exported from `@/lib/fallback-config`.
- `web/.env.local.example` — created with every `process.env.*` referenced.
- `.gitignore` + `web/.gitignore` — allowlisted `.env.example`/`.env.local.example`.

**Current state:**
- `test` at commit 1b5ab79. `npx tsc --noEmit` passes 0 errors. Lint: 2 pre-existing
  errors + 2 warnings unchanged; no new errors from this PR.
- `main` unchanged at 94f530a (awaiting explicit `merge main now`).
- Loading screen now ALWAYS reaches `/play` within ≤75s, even with every
  AI service offline.

**Remaining / artifacts:**
- Manual smoke test by user (dev server + browser).
- Phase E (post-demo polish): parallel TRELLIS on self-host, `WRITE_GODOT_ASSETS`
  env gate, structured logger.
- Pre-existing lint cleanup (post-demo).
- User signal `merge main now` → fast-forward `test` → `main` and push.

---

### 2026-05-19: merge test → main (P0–P4 + e2e landed)
**Request:** User signal `merge main now` — explicit authorization to land
all `test` work onto `main`.

**Changes:**
- `git checkout main && git merge --no-ff test` → merge commit `ba1c9a2`.
- Pushed `origin/main`.
- Fast-forwarded `test` to match (both branches now at `ba1c9a2`).

**Current state:**
- `main` and `test` aligned at `ba1c9a2`.
- P0–P4 + Playwright e2e + 213 unit tests now in production-equivalent branch.

**Remaining / artifacts:**
- P5 (production worker / queue / S3 / auth / observability) — separate
  milestone per user spec; not started.
- Continue daily work on `test`; main stays at `ba1c9a2` until next
  literal `merge main now` signal.

---

### 2026-05-19: P0–P4 quality plan shipped (real bugs closed, e2e green)
**Request:** Execute the 12-phase quality plan (P0–P5) audit; fix every real
bug found; ship green tests and green e2e; defer P5 to a later milestone.

**Findings (root-cause survey across the 12 phases):**
- P0.1 — `/api/generate-3d` deep-trusted body.config (no schema validation).
- P0.2 — `/api/generate-assets` deep-trusted body.config likewise.
- P0.3 — `/loading-dream` tied its fire-and-forget asset fetches to an
  AbortController that fired on navigation, so the assets were aborted
  the moment we navigated to /play.
- P0.4 — `/play` only read gameAssets from localStorage on mount; assets
  that arrived after mount were invisible without a manual refresh.
- P1.5 — `normalizeGenre()` had branching logic; could in theory return
  a non-3D value if an LLM produced a string we recognized.
- P1.6 — analyze route silently dropped extended LLM fields (meshy_*,
  weather, time_of_day, fog_density, etc.) on the floor.
- P1.7 — DreamGame3D held character_url ambiguity: same field name used
  for both /generated/<id>/character.png (2D) and /generated3d/<id>/character.glb (3D).
- P1.8 — Missing a11y: textarea/mic on `/` and Export modal on `/play`.
- P2.9 — No test coverage for the parseGameConfigExtended path.
- P2.11 — No explicit attack-surface tests for buildAssetFsPath / buildAssetUrl.
- P2.12 — No e2e smoke coverage at all (Playwright was "planned").
- P3.13 — README pre-dated the P0 work; "assets are decorative" not
  documented anywhere; "Late asset delivery" pipeline undocumented.
- P3.14 — TROUBLESHOOTING.md still listed the late-asset-pickup as an
  unresolved limitation.
- P4 — PROJECT_MAP.yaml + memory.md out of sync with shipped behavior.

**Changes:**
- P0.1 fix — `/api/generate-3d` now runs body.config through
  parseGameConfigExtended; rejects non-object configs at the door.
- P0.2 fix — `/api/generate-assets` now runs body.config through
  parseGameConfig; rejects non-object configs.
- P0.3 fix — `/loading-dream` removes the AbortSignal from the asset
  fetches. Requests survive navigation. On settle they write
  localStorage.gameAssets via mergeAssetResponses and dispatch a
  CustomEvent('dreamAssetsUpdated') on window.
- P0.4 fix — `/play` registers two listeners on mount:
  - window 'dreamAssetsUpdated' (same-tab updates)
  - window 'storage' (cross-tab updates)
  Both push the new assets into DreamGame3D, which re-renders. drei's
  useGLTF / useTexture suspend on the new URLs and swap procedural →
  real asset via React Suspense (no reload).
- P1.5 — `normalizeGenre()` is now unconditional `return '3d_platformer'`.
- P1.6 — `analyze` returns the extended GameConfig shape; new
  `parseGameConfigExtended` preserves meshy_*, weather, time_of_day,
  fog_density, terrain_height_scale, godot_environment_hints.
- P1.7 — New `web/lib/game-assets.ts`: GameAssets type, NO_ASSETS,
  DREAM_ASSETS_UPDATED_EVENT constant, isGameAssets guard,
  mergeAssetResponses. Disambiguates 2D vs 3D character_url between routes.
- P1.8 — a11y on textarea + mic on `/`; Export modal a11y on `/play`;
  mobile touch hint in DreamGame3D.
- P2.9 — `parseGameConfigExtended` test block in
  web/lib/__tests__/game-config-schema.test.ts (7 cases).
- P2.11 — "Path security — explicit attack surface" block in
  web/lib/__tests__/generated-paths.test.ts (22 cases covering filename
  attack, generationId attack, cwd attack, and URL builder attacks).
- P2.12 — `web/playwright.config.ts` + `web/e2e/smoke.spec.ts` (11 cases:
  home, loading, play, modal, responsive, redirects). New scripts:
  test:e2e, test:e2e:install, check:full. devDep @playwright/test 1.49.
- P3.13 — README.md rewritten: "Assets are decorative" section,
  "Late asset delivery" pipeline, drei useGLTF/useTexture in tech stack,
  full 10-script table, known non-blocking warnings (THREE.Clock,
  PCFSoftShadowMap), dev-mode shortcut clarified.
- P3.14 — TROUBLESHOOTING.md: late-asset-pickup section flagged
  **(RESOLVED)** with the new pipeline + DevTools verification steps.
  New sections: Playwright browser not installed, mobile hint on desktop,
  GLB CORS/404 fallback.
- P4 — PROJECT_MAP.yaml: added game-assets.ts, e2e/smoke.spec.ts,
  playwright.config.ts entries; updated api.endpoints.generation to
  reflect schema validation; testing.backend.runners gained test:e2e
  + check:full; testing.frontend.automation now lists Playwright 1.49;
  workflows.dream_to_world rewritten step-by-step around the
  dreamAssetsUpdated pipeline. memory.md: this entry + § 5 refreshed.

**Current state:**
- 213 unit tests + 11 e2e smoke cases — all green.
- `npm run check` passes (lint + typecheck + vitest).
- `npm run check:full` passes (above + Playwright).
- `npm run build` succeeds with 0 type errors, 0 lint errors.
- Branch HEAD: `test` at `(post-commit)` (parent will fill exact hash).

**Remaining / artifacts:**
- P5 deferred (separate milestone — production hardening, telemetry,
  audio playback for music_prompt, structured logger, parallel TRELLIS).

---

### 2026-05-19: Trinity installed + audited FIX_PLAN committed + repo bootstrapped
**Request:** Audit existing project, find the cause of "infinite generation/render",
write a full fix plan, initialize GitHub repo with `test` and `main` branches,
work in `test` only, merge `main` only on `merge main now` signal. Apply
project-memory-trinity skill.

**Findings:**
- Root cause of infinite loading: `loading-dream/page.tsx` waits on `Promise.allSettled`
  with no hard timeout; `@gradio/client` calls in `/api/generate-3d` have no timeout.
- Stacked timeout gaps: client (none), generate-3d (none on Gradio), analyze (60s
  but truncatable JSON), generate-assets (60s × 3 concurrent).
- Genre mismatch: all 3 fallback paths use `'2d_platformer'` for a 3D game.
- `web/.git` from `create-next-app` was nested inside the parent — removed.
- `lucide-react@^1.16.0` looks suspicious but works.
- `next.config.ts` is empty; `AGENTS.md` warns "this is NOT the Next.js you know".

**Changes:**
- `.gitignore` — created (covers .env, node_modules, .next, generated/, __MACOSX, etc).
- `FIX_PLAN.md` — created with 5 phases (A–E), acceptance criteria, risk matrix.
- `docs/PROJECT_MAP.yaml` — created (this trinity).
- `memory.md` — created (this file).
- `agent.md` — created (next).
- Initial commit `94f530a` on `main`, pushed.
- Branch `test` created from `main`, pushed. HEAD now on `test`.

**Current state:**
- Repo live at https://github.com/malishomen/text_to_world_ai
- Both branches at `94f530a` (trinity adds will be the first divergence on `test`).
- No code fix applied yet — Phase A/B/C/D queued.

**Remaining / artifacts:**
- Execute Phase A (frontend stop-cock) — Subagent 1.
- Execute Phase B (server timeouts) — Subagent 2.
- Execute Phase C (/play defenses + env example) — Subagent 3.
- Execute Phase D (game restart + collisions) — Subagent 4.
- After all 4 subagents complete: typecheck + lint + commit on `test` + audit report.

---

### 2026-05-19: Render unblocked — ACES tonemapping, Z-handedness, LLM JSON-schema, per-mood scene identity
**Request:** "запусти проект локально" → multi-stage debug as the demo failed at each layer.
Final goal: win the hackathon — visible, distinct scenes per dream, real LLM in the loop.

**Findings:**
- `gl={{ toneMapping: 3 /* ACESFilmic */ }}` was a **lie**: in Three.js 0.184 the numeric `3`
  is `CineonToneMapping` (deprecated). Combined with the scene's strong ambient + directional
  + 2 point lights, Cineon at default exposure clipped the entire canvas to pure white.
- Camera lived at `(0, 12, -18)` looking toward +Z while the level extended in +Z. In Three's
  right-handed coords this maps world +X to screen LEFT — every dream rendered mirrored
  (3D narrative text read backwards, A/D inverted). Fixing controls alone could not fix
  the mirror — required full Y-axis rotation of the world (camera+level+W/S).
- Bumped ambient/directional/point-light intensities ~3× to compensate for moving from
  the overexposing Cineon to physically-correct ACES. Old intensities (ambient 0.5, dir 2,
  point 3+2) were tuned to the broken pipeline; under ACES the scene was nearly black.
- `/api/analyze` had `LLM_TIMEOUT_MS=25000` hardcoded with a SYSTEM_PROMPT asking for 20+
  deeply nested fields (meshy prompts, godot env hints, weather, fog, etc.) the React
  scene does not consume. Every call timed out at exactly 25.0s and silently fell back
  to `buildFallback(dream)` — the "AI" the user saw was the keyword router, not the LLM.
- After bumping the timeout, Qwen3-class models emit `<think>` blocks by default and ate
  the 500-token budget before reaching valid JSON. Three things together fixed it:
  (1) `response_format: { type: 'json_schema', json_schema: { strict: true, schema: {...} } }`
  — LM Studio rejects OpenAI's `json_object` with "must be 'json_schema' or 'text'";
  (2) `chat_template_kwargs: { enable_thinking: false }` + `/no_think` in the user message;
  (3) prompt trimmed to the 11 fields actually rendered. Result: real LLM responds in
  ~15-19s vs no response in 25s.
- Landing's `handleSubmit` only wrote `dreamText` to localStorage and did NOT clear
  `gameConfig`/`gameAssets`/`generationId`. `/loading-dream` had sticky-id logic that
  reused the same `generationId` across dreams → `generateLevel(generationId)` produced
  the same platform layout for every new dream forever.
- Scene was visually identical across dreams even when LLM produced different `mood/style/
  palette` — only palette colors and platform counts changed; geometry was hardcoded.

**Changes (chronological, all on `test`):**
- `web/components/DreamGame3D.tsx`:
  - Tone mapping: `gl={{ toneMapping: THREE.ACESFilmicToneMapping }}` + `onCreated` sets
    `gl.toneMappingExposure = 1.2`. Never pass numeric values for tone mapping.
  - Camera & level flipped to standard right-handed convention: camera initial
    `[0, 12, 18]`, follow target `t.z + 16`, `level z` extends in `-Z` (starts at `-7`,
    decrements), `W: vz -= speed`, `S: vz += speed`. Sparkles and narrative-text z signs
    inverted to match.
  - Light intensities raised: ambient 0.5→1.5, directional 2→5, points 3→80 and 2→60
    (post-r155 physical units).
  - Enter/NumpadEnter/Space restart from win/dead overlays (was mouse-only).
  - `MoodPreset` extended with `playerShape | platformDecoration | enemyShape | enemyColor |
    skyTopColor | skyBottomColor | groundColor`; 8 presets cover the full LLM enum.
  - New components: `SkyDome` (custom back-side sphere fragment shader, zenith→horizon
    gradient — replaces flat `<color attach="background">`), `GroundPlane` (optional
    per-mood floor), `PlatformDecoration` (crystal/spire/orb/mushroom/neon meshes,
    non-physics, on every non-spawn platform).
  - `ProceduralBall`, `Player`, `Enemy` accept `shape` + (for Enemy) `color` props.
- `web/app/page.tsx`: `handleSubmit` clears `gameConfig`/`gameAssets`/`generationId`
  before navigating, so every dream starts from a clean slate.
- `web/app/api/analyze/route.ts`:
  - `LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60000` (was hardcoded 25000).
  - `LLM_MAX_TOKENS = 1500` (was 500 — too tight when thinking can't be fully disabled).
  - SYSTEM_PROMPT slimmed to the 11 rendered fields.
  - Body adds `response_format: { type: 'json_schema', json_schema: { strict: true,
    schema: {...} } }` AND `chat_template_kwargs: { enable_thinking: false }`.
  - User message ends with `/no_think`.
  - Raw model content logged on JSON parse failure for future diagnostics.
- `web/.env.local` (gitignored, user machine only):
  - `NEXT_PUBLIC_DEV_FAKE_AI=0`
  - `NEXT_PUBLIC_MAX_GENERATION_MS=90000`
  - `LLM_TIMEOUT_MS=60000`
  - `QWEN_MODEL=qwen3-8b-gemini-3-pro-preview-distill` (was the MLX default that won't
    run on Windows; this is a Q6_K GGUF that works in LM Studio 0.4.2 on the user's box)

**Commits:**
- `c75ea92` fix(3d): correct tone mapping, flip Z handedness, bump lights, Enter to restart
- `2b6e2fe` feat(analyze): force structured JSON via LM Studio json_schema, slim prompt
- `44352b0` feat(scene): per-mood visual identity — player shape, decorations, sky gradient, ground

`c75ea92` was merged to `main` on user's `merge main now`. `2b6e2fe` and `44352b0`
sit on `test` only — no main merge yet.

**Current state:**
- Demo path end-to-end works: dream input → real LLM (Qwen3 8B Gemini 3 Pro Preview
  Q6_K, ~15-19s response) → distinct per-mood scene with gradient sky, shaped player,
  decorated platforms, themed enemies → playable on /play.
- All visible AI is real; SD and TRELLIS still off, assets pipeline returns nulls
  fast, scene renders procedurally without blocking.
- Branch `test` ahead of `main` by 2 commits.

**Remaining / artifacts:**
- External-model decision pending: Meshy.ai (paid, ~30s, PBR-quality GLB, requires
  API key) vs LLaMA-Mesh (local, free, OBJ-only, low-poly, would need its own LM Studio
  slot alongside Qwen3) vs status quo (TRELLIS via HF Space).
- Trinity catch-up (this entry) — PROJECT_MAP.yaml updated to reflect new env vars,
  the ACES/coordinate convention, and the per-mood preset system; memory.md gets this
  log entry. **Convention 2 was violated for 3 commits before this fix-up — agent must
  do the trinity sync inside the same session as the code change in future.**

---

## 5. Current operational state

**Live environments (as of 2026-05-19, post-P0–P4):**
| Component | Status | Location |
|---|---|---|
| GitHub repo | ✅ live | https://github.com/malishomen/text_to_world_ai |
| `main` branch | ✅ at ba1c9a2 (P0–P4 + e2e merged) | origin/main |
| `test` branch | ✅ at ba1c9a2 (aligned with main, HEAD here) | origin/test |
| Next.js dev server | ⏸ not started in this session | `cd web && npm run dev` |
| LM Studio (Qwen3-coder) | ❓ unknown — depends on user | localhost:1234 |
| Stable Diffusion A1111 | ❓ unknown | 127.0.0.1:7860 |
| TRELLIS | ❓ unknown — HF Space cold | JeffreyXiang/TRELLIS-image-large |
| Phase A — client stop-cock | ✅ shipped | web/app/loading-dream/page.tsx |
| Phase B — server timeouts | ✅ shipped | web/app/api/*, web/lib/with-timeout.ts |
| Phase C — /play defenses | ✅ shipped | web/app/play/page.tsx, web/.env.local.example |
| Phase D — game refactor | ✅ shipped | web/components/DreamGame3D.tsx |
| Phase E — polish | ⏸ deferred (post-demo) | — |
| **P0.1** — /api/generate-3d schema validation | ✅ shipped | web/app/api/generate-3d/route.ts (parseGameConfigExtended) |
| **P0.2** — /api/generate-assets schema validation | ✅ shipped | web/app/api/generate-assets/route.ts (parseGameConfig) |
| **P0.3** — fire-and-forget assets survive navigation | ✅ shipped | web/app/loading-dream/page.tsx (no AbortSignal on asset fetches) |
| **P0.4** — /play receives late-arriving assets | ✅ shipped | web/app/play/page.tsx (dreamAssetsUpdated + storage listeners) |
| **P1.5** — normalizeGenre unconditional 3d_platformer | ✅ shipped | web/lib/game-config-schema.ts |
| **P1.6** — analyze returns extended GameConfig | ✅ shipped | web/app/api/analyze/route.ts (parseGameConfigExtended) |
| **P1.7** — game-assets.ts disambiguates 2D/3D character_url | ✅ shipped | web/lib/game-assets.ts (GameAssets, NO_ASSETS, mergeAssetResponses) |
| **P1.8** — a11y on textarea, mic, Export modal + mobile hint | ✅ shipped | web/app/page.tsx, web/app/play/page.tsx, web/components/DreamGame3D.tsx |
| **P2.9** — parseGameConfigExtended test coverage | ✅ shipped | web/lib/__tests__/game-config-schema.test.ts (+7 cases) |
| **P2.11** — path-security attack-surface tests | ✅ shipped | web/lib/__tests__/generated-paths.test.ts (+22 cases) |
| **P2.12** — Playwright smoke suite | ✅ shipped | web/playwright.config.ts, web/e2e/smoke.spec.ts (11 cases) |
| **P3.13** — README rewritten (P0 pipeline + 10 scripts) | ✅ shipped | README.md |
| **P3.14** — TROUBLESHOOTING (late-asset gap RESOLVED) | ✅ shipped | TROUBLESHOOTING.md |
| **P4** — PROJECT_MAP.yaml + memory.md synced | ✅ shipped | docs/PROJECT_MAP.yaml, memory.md |
| **P5** — production hardening | ⏸ **DEFERRED** (separate milestone) | — |

**Test counts (after recovery):**
- Vitest: 213 / 213 passing (7 files).
- Playwright: 11 / 11 passing (1 spec, headless Chromium).
- `npm run check` — all three pass.
- `npm run check:full` — all four pass (lint + typecheck + vitest + playwright).

**What's missing / deferred (P5 — separate milestone):**
- Production hardening (rate limits, request signing, structured JSON logs).
- Audio (`music_prompt` field is generated but never played).
- Parallel TRELLIS on self-host (currently sequential).
- Telemetry / observability for the asset-arrival pipeline.

**Where to look when X breaks:**
- "/loading-dream never reaches /play" → `agent.md § 3.3` + `FIX_PLAN.md § Phase A`.
- "Sidebar shows 2d platformer" → `web/lib/fallback-config.ts` (Phase A.2).
- "Gradio Client hangs" → `web/lib/with-timeout.ts` + `agent.md § 3.4`.
- "Scene crashes on restart" → `FIX_PLAN.md § Phase D`.
- "Late asset never appears on /play" → `TROUBLESHOOTING.md § Fire-and-forget assets (RESOLVED)` + `web/app/play/page.tsx` listeners.
- "Playwright browser not installed" → `cd web && npm run test:e2e:install` (one-time per machine).
- "GLB returns 404 — fallback expected" → `TROUBLESHOOTING.md § 3D asset GLB fails to load`.

---

## 6. Quick reference

### Start the stack / verify health
```bash
cd web && npm install                       # first time
cd web && npm run dev                       # localhost:3000
curl -s http://localhost:3000 | head -5     # is it up?
```

### Run typecheck / lint
```bash
cd web && npx tsc --noEmit
cd web && npm run lint
```

### Dev shortcut: skip AI services
```bash
# Set in web/.env.local:
NEXT_PUBLIC_DEV_FAKE_AI=1
# /loading-dream will navigate to /play in 3s with fallback config
```

### Git workflow
```bash
git status
git diff --name-only test                   # what changed vs test
git add <specific files>                    # not -A blindly
git commit -m "<type>: <desc>"
git push origin test                        # NEVER push to main without 'merge main now'
```

### Merge test → main (only on `merge main now`)
```bash
git checkout main
git merge --no-ff test -m "merge: test → main"
git push origin main
git checkout test
```

### Validate PROJECT_MAP.yaml
```bash
python -c "import yaml; yaml.safe_load(open('docs/PROJECT_MAP.yaml', encoding='utf-8')); print('OK')"
```

### External service smoke tests
```bash
curl -s http://localhost:1234/v1/models                              # LM Studio
curl -s http://127.0.0.1:7860/sdapi/v1/options | head -20            # SD A1111
curl -s https://huggingface.co/api/spaces/JeffreyXiang/TRELLIS-image-large | head -50  # HF Space
```
