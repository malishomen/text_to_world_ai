# agent.md — AI-agent operating manual for DreamCraft (text_to_world_ai)

> **Purpose:** rules and operational protocol for AI agents working on this project.
>
> **Three context sources:**
> 1. [`docs/PROJECT_MAP.yaml`](docs/PROJECT_MAP.yaml) — **static**: what exists
> 2. [`memory.md`](memory.md) — **dynamic**: history, decisions, current state
> 3. **`agent.md` (this file)** — **behavior**: how to act
>
> Before any task: read in order `agent.md` → `memory.md` → relevant `PROJECT_MAP.yaml` section.

---

## 0. Bootstrap (mandatory at session start)

```
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1.  Read agent.md (this file) — rules                       │
│  STEP 2.  Read memory.md — § 1 invariants, § 2 issues, § 5 state  │
│           Scan § 4 for similar past requests.                     │
│  STEP 3.  Find relevant section in docs/PROJECT_MAP.yaml          │
│           — use § 2 table below.                                  │
│  STEP 4.  Now start the task.                                     │
│  STEP 5.  At session end — § 5 ritual:                            │
│           A) Sync PROJECT_MAP.yaml against git diff               │
│           B) Atomic entry in memory.md § Session log              │
└──────────────────────────────────────────────────────────────────┘
```

---

## 1. Hard rules (do not violate)

### 1.0. `PROJECT_MAP.yaml` syncs WITHOUT user reminders ⚠️ CRITICAL

**Law:** any change affecting any section of `docs/PROJECT_MAP.yaml`
**must be paired with an update of that section in the same session**.

**Triggers (what change → which section to update):**

| Change in code/system | Section to update |
|---|---|
| New / removed API route handler | `api.endpoints`, `frontend.pages` if linked |
| New file in `web/app/api/` | `api.endpoints`, `directory_structure` |
| New file in `web/app/<route>/` | `frontend.pages`, `directory_structure` |
| New file in `web/components/` | `directory_structure` |
| New file in `web/lib/` | `directory_structure` |
| New `process.env.X` reference | `env.required_always` or `env.optional` |
| New runtime process / external service | `architecture.runtime_processes`, `external_services` |
| New / changed deploy path | `deploy`, `deploy_rules` |
| Project version bump | `project.current_version` |
| Discovered pitfall + workaround | `known_issues` (or `memory.md § 2` if transient) |
| New dependency in `package.json` | `tech_stack` |
| Branch policy change | `deploy_rules.branch_discipline` |

**Self-check before ending session:**
```bash
git diff --stat test -- ':(exclude)docs/PROJECT_MAP.yaml' ':(exclude)memory.md' ':(exclude)agent.md'
python -c "import yaml; yaml.safe_load(open('docs/PROJECT_MAP.yaml', encoding='utf-8'))"
```

**No duplication.** Static facts → PROJECT_MAP.yaml. History/causes → memory.md.

### 1.1. Branch discipline — `main` is sacred
- Work only in `test`.
- Push `test` freely.
- **Merge `test` → `main` ONLY** when the user types the literal phrase `merge main now`.
  - No "looks ready", no "I think you wanted me to merge", no merging "since the work is done".
  - The phrase must appear verbatim in the user's message.
- Before any `git push` → run `git status` first.
- Force-push to `main` is forbidden.

### 1.2. Deploy
- Canonical: `cd web && npm install && npm run dev` (local dev).
- Production: Vercel (planned, not yet wired).
- AI services (Qwen/SD/TRELLIS) always run on the user's local machine,
  not on Vercel — by design.

### 1.3. Secrets
- `.env`, `.env.local`, any `.env.*` except `*.example` → never committed.
  `.gitignore` enforces this; double-check after `git add -A`.
- HF_TOKEN, model API keys — never in logs, never in PR descriptions.

### 1.4. AGENTS.md / Next.js 16 caveat
- `web/AGENTS.md`: "This is NOT the Next.js you know. APIs, conventions,
  and file structure may differ. Read the relevant guide in
  `node_modules/next/dist/docs/` before writing any code."
- Don't blindly apply Next 13/14 patterns.
- Don't touch `next.config.ts` without explicit need + verification.

### 1.5. `/loading-dream` discipline
- A single `goPlay(reason)` function owns all navigation.
- A `navigated.current` ref guards against double `router.push`.
- A hard timer (`NEXT_PUBLIC_MAX_GENERATION_MS`) is the ultimate fallback.
- AbortError on fetch cancel is expected — never surfaced to user.
- Never overwrite an existing `localStorage.gameConfig` with fallback.

### 1.6. `genre: '3d_platformer'` everywhere in fallback paths
- The game is 3D. Any fallback `GameConfig` must use `genre: '3d_platformer'`.
- Single source of truth: `web/lib/fallback-config.ts`.

---

## 2. Where to find what

| What you need | Look in |
|---|---|
| API route list | `PROJECT_MAP.yaml#api.endpoints` |
| Page routes | `PROJECT_MAP.yaml#frontend.pages` |
| Env vars list | `PROJECT_MAP.yaml#env` |
| External services + URLs | `PROJECT_MAP.yaml#external_services` |
| Deploy targets | `PROJECT_MAP.yaml#deploy` |
| Directory layout | `PROJECT_MAP.yaml#directory_structure` |
| Workflows (happy path / fallback) | `PROJECT_MAP.yaml#workflows` |
| Persistent architectural issues | `PROJECT_MAP.yaml#known_issues` |
| Eternal project invariants | `memory.md § 1` |
| Current bugs + workarounds | `memory.md § 2` |
| Past architectural decisions | `memory.md § 3` |
| Past session history | `memory.md § 4` |
| What's running right now | `memory.md § 5` |
| Frequently used commands | `memory.md § 6` |
| Full audited fix plan | `FIX_PLAN.md` |

---

## 3. Playbooks (common tasks)

### 3.1. Add a new API route
1. Create `web/app/api/<name>/route.ts` exporting `POST` / `GET` etc.
2. Use `AbortSignal.timeout(N)` on every outbound `fetch` to external services.
3. Always return JSON with status 200 + `{fallback:true}` on graceful degradation,
   not 5xx — the client expects a usable body.
4. Update `PROJECT_MAP.yaml#api.endpoints` and `#directory_structure`.

### 3.2. Add a new page
1. Create `web/app/<route>/page.tsx` (must start with `'use client'` if it
   uses hooks / browser APIs).
2. For pages that mount heavy client-only modules (Three.js, Rapier),
   use `next/dynamic(..., { ssr: false })`.
3. Update `PROJECT_MAP.yaml#frontend.pages`.

### 3.3. Debug "infinite loading" / page hangs on /loading-dream
1. Open browser DevTools → Network. Identify which `/api/*` call is pending.
2. Check terminal where `npm run dev` runs for stack traces.
3. If Network shows `analyze` pending >25s → LM Studio offline or model slow.
   Verify `curl http://localhost:1234/v1/models`.
4. If `generate-3d` pending >15s → HF Space probe failed or Gradio queue stuck.
   Verify `curl https://huggingface.co/api/spaces/<id>` returns `runtime.stage:RUNNING`.
5. If `generate-assets` pending >25s → SD offline. Verify `curl 127.0.0.1:7860/sdapi/v1/options`.
6. After ≤ `NEXT_PUBLIC_MAX_GENERATION_MS` (default 75s) the client MUST navigate.
   If it doesn't → bug in `goPlay()` or `navigated.current` guard. Check `loading-dream/page.tsx`.

### 3.4. Wrap an external call with a timeout (Phase B pattern)
```ts
import { withTimeout } from '@/lib/with-timeout';
const result = await withTimeout(
  client.predict('/image_to_3d', { ... }),
  60_000,
  'image_to_3d'
);
```
- Pick timeout based on realistic worst-case for the operation, not the wall clock budget.
- Total per-request budget belongs at the API route level via a `deadline = Date.now() + N` check.

### 3.5. Start local dev from scratch
```bash
cd web
npm install
# (optional) cp .env.local.example .env.local && edit
npm run dev
# open http://localhost:3000
```

### 3.6. Test without external AI services (dev mode)
```bash
# Add to web/.env.local:
echo "NEXT_PUBLIC_DEV_FAKE_AI=1" >> web/.env.local
# Restart npm run dev. Now /loading-dream skips all 3 APIs and uses
# the canonical fallback after 3s.
```

### 3.7. Respond to a "X doesn't work" bug report
1. Don't guess. Capture the exact symptom (screen, action, browser console error).
2. Check terminal of `npm run dev` for the last server error.
3. Reproduce locally with the same dream text if applicable.
4. If repro fails → ask for browser console / network HAR.
5. Only after repro → propose fix.

### 3.8. Multi-step tasks
For 3+ step tasks: use `TaskCreate` + `TaskUpdate`. Mark exactly ONE step
`in_progress` at a time. Mark `completed` immediately, not in batches.

### 3.9. Subagent decomposition
When a task has independent file-scope chunks (e.g., Phase A touches
`loading-dream` and `lib/fallback-config.ts`; Phase B touches `api/*` and
`lib/with-timeout.ts`; Phase D touches `DreamGame3D.tsx`):
1. Define a strict file scope per subagent — no overlap.
2. Define the API contract for any shared module up front (export names,
   signatures) so all subagents can code against it.
3. Run subagents in parallel via a single message with multiple Agent tool uses.
4. After all complete: typecheck + lint + git diff inspection from the parent agent.

---

## 4. Anti-patterns

| Don't | Why | Do instead |
|---|---|---|
| `git push origin main` without `merge main now` signal | Violates the only hard branch rule | Push `test` only; surface a question if unclear |
| `git add -A` then commit blindly | May include `.env` or generated assets | Inspect `git status --short` first |
| Add new `process.env.X` without updating `PROJECT_MAP.yaml#env` | Map drifts; future agent won't know var exists | Update PROJECT_MAP.yaml in same commit |
| Use `Promise.allSettled` without a hard outer timer | One slow service blocks the whole UI | Wrap with `Promise.race([..., timeout])` |
| Show "Something went wrong" on `AbortError` | Aborts are intentional during cleanup | `if (err.name !== 'AbortError') ...` |
| `setTimeout` in a React effect without cleanup | Calls `setState` on unmounted component | Track ids in `useRef<number[]>([])`, clear in cleanup |
| Trigger generation twice in StrictMode dev | Doubles API load + can race localStorage | `useRef(false)` guard at top of effect |
| Recreate `<Canvas>` via `key={...}` to restart | Recompiles all shaders + resets Rapier | `bodyRef.setTranslation(...)` + reset `ended` ref |
| Duplicate the fallback config inline | Drifts (the `2d_platformer` bug) | Import from `@/lib/fallback-config` |
| Touch `next.config.ts` without reading `node_modules/next/dist/docs/` | Next 16 != Next 14 | Read first, change second |
| Skip typecheck before commit | Demo-day surprise | `npx tsc --noEmit` |

---

## 5. After-session ritual (mandatory)

**Step A — Sync `PROJECT_MAP.yaml`:**
```
1. git diff --name-only test -- ':(exclude)docs/PROJECT_MAP.yaml' ':(exclude)memory.md' ':(exclude)agent.md'
2. For each changed file → determine via § 1.0 triggers table which YAML section.
3. Update PROJECT_MAP.yaml.
4. Validate:
   python -c "import yaml; yaml.safe_load(open('docs/PROJECT_MAP.yaml', encoding='utf-8'))"
```

**Step B — Atomic entry in `memory.md § 4. Session log`:**
```markdown
### YYYY-MM-DD: <short searchable title>
**Request:** ...

**Findings:**
- ...

**Changes:**
- <file>: <change>

**Current state:**
- ...

**Remaining / artifacts:**
- ...
```

Rules:
- Atomic — each entry self-contained.
- Append-only — never edit old entries.
- Date = actual session-end date (today: per `currentDate`).
- Title — short, greppable.

---

## 6. Response style

- Brief, direct, no fluff.
- Markdown tables for comparisons.
- Reference files as `path/to/file.ext:LINE`.
- Before destructive ops → ask.
- Don't duplicate PROJECT_MAP.yaml in replies — reference the section.

---

## 7. When to ask vs when to act

| Risk level | Examples | Action |
|---|---|---|
| 0. Read-only | grep, file reads, log inspection, healthcheck | Act |
| 1. Local code edit | Edit one file in `test`, add a route | Act; show diff at end |
| 2. Multi-step feature | Cross-file refactor, new workflow | Plan, agree, then act |
| 3. Dependency change | `npm install`, `npm update`, version bumps | Ask first |
| 4. Destructive | `git reset --hard`, force-push, delete branches | **Always ask** |
| 5. External / shared | Push to `main`, open PR, deploy | **Always ask**; for `main` specifically — require the `merge main now` phrase |

---

## 8. Verification cheat-sheet

### Web up?
```bash
curl -s http://localhost:3000 | head -5
```

### Typecheck / lint
```bash
cd web && npx tsc --noEmit
cd web && npm run lint
```

### YAML map valid?
```bash
python -c "import yaml; yaml.safe_load(open('docs/PROJECT_MAP.yaml', encoding='utf-8')); print('OK')"
```

### What changed in this session?
```bash
git diff --stat
git log --oneline -10
```

### External services
```bash
curl -s http://localhost:1234/v1/models                              # LM Studio
curl -s http://127.0.0.1:7860/sdapi/v1/options | head -20            # SD
curl -s https://huggingface.co/api/spaces/JeffreyXiang/TRELLIS-image-large | head -30  # HF
```
