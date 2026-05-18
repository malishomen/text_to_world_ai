# DreamCraft — Fix Plan (audited, final)

> Source: full audit of `loading-dream`, `play`, `DreamGame3D`, `analyze`,
> `generate-3d`, `generate-assets`. Symptom being fixed:
> **page `/loading-dream` hangs indefinitely; generation never completes.**

---

## Root cause (one-liner)

`loading-dream/page.tsx` calls `router.push('/play')` only after
`Promise.allSettled([generate-3d, generate-assets])` resolves. `Client.connect`
and `client.predict` from `@gradio/client` v2 have **no timeout**. If the
HF Space is sleeping or queued, the page hangs forever; the step animation
freezes at "Launching Godot engine..." after ~23 s.

Three independent timeout gaps stack:
1. Client: no hard timeout on `Promise.allSettled`.
2. API `/generate-3d`: no timeout on Gradio calls (can be minutes).
3. API `/analyze`: 60 s timeout, but `max_tokens: 1024` can truncate JSON →
   parser throws → fallback returned (good), but client already waited 60 s.

---

## Phases

| Phase | What | Time | Blocks demo? |
|---|---|---|---|
| **A** | Client-side stop-cock + unified fallback + dev mode | 20 min | **Yes** |
| **B** | Server-side timeouts (3d / assets / analyze) | 25 min | Desirable |
| **C** | `/play` defenses + env example | 15 min | No |
| **D** | Game restart + collision counter + stable enemy refs | 30 min | No |
| **E** | Polish: parallel TRELLIS on self-host, GODOT_DIR opt-in | — | No |

---

## Phase A — Stop-cock (MUST for demo)

### A.1 `loading-dream/page.tsx` — centralized navigation

```ts
const MAX_MS = Number(process.env.NEXT_PUBLIC_MAX_GENERATION_MS ?? 75000);
const started   = useRef(false);
const navigated = useRef(false);

useEffect(() => {
  if (started.current) return;
  started.current = true;

  const dream = localStorage.getItem('dreamText');
  if (!dream) { router.replace('/'); return; }

  const ac     = new AbortController();
  const timers: ReturnType<typeof setTimeout>[] = [];

  const goPlay = (_reason: 'ok' | 'timeout' | 'error') => {
    if (navigated.current) return;
    navigated.current = true;
    if (!localStorage.getItem('gameConfig')) {
      localStorage.setItem('gameConfig', JSON.stringify(buildFallback(dream)));
    }
    router.replace('/play');
  };

  timers.push(setTimeout(() => goPlay('timeout'), MAX_MS));
  runStepAnimation(timers, setCurrentStep, setProgress);

  if (process.env.NEXT_PUBLIC_DEV_FAKE_AI === '1') {
    timers.push(setTimeout(() => goPlay('ok'), 3000));
    return;
  }

  generateGame(dream, ac.signal)
    .then(() => goPlay('ok'))
    .catch((err) => {
      if (err?.name !== 'AbortError') console.error(err);
      goPlay('error');
    });

  return () => {
    ac.abort();
    timers.forEach(clearTimeout);
    started.current = false;   // important for Fast Refresh
  };
}, [router]);
```

Rules:
- never overwrite `gameConfig` if it already exists in `localStorage`;
- `AbortError` is expected, do not surface as "Something went wrong";
- single navigation guard via `navigated.current` (avoids double `push`).

### A.2 `web/lib/fallback-config.ts`
Move `getFallbackConfig` / `generateFallback` here. Use in
`loading-dream/page.tsx`, `analyze/route.ts`, `play/page.tsx`.
**Fix `genre` → `'3d_platformer'`** in every branch (it was `2d_platformer`
even though the game is 3D — sidebar showed the wrong label).

### A.3 Dev mode `NEXT_PUBLIC_DEV_FAKE_AI=1`
Skip LLM/SD/TRELLIS, navigate after 3 s with fallback. Required to verify
Phase A independently of external services.

### A.4 Heartbeat after 30 s
```tsx
{elapsedSec > 30 && (
  <p className="text-purple-400/60 text-xs mt-2">
    Still working… {elapsedSec}s / {Math.round(MAX_MS/1000)}s
  </p>
)}
```

**Acceptance:**
- ✅ LM Studio off + Wi-Fi off → user reaches `/play` within ≤75 s with fallback.
- ✅ `/api/analyze` is called exactly once in dev (StrictMode safe).
- ✅ Leaving the page mid-load → no "setState on unmounted" warnings.
- ✅ `NEXT_PUBLIC_DEV_FAKE_AI=1` → `/play` in 3 s, default scene.

---

## Phase B — Server timeouts

### B.1 `web/lib/with-timeout.ts`
```ts
export const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
  Promise.race([p, new Promise<T>((_, r) =>
    setTimeout(() => r(new Error(`${label} timed out after ${ms}ms`)), ms))]);
```

### B.2 `app/api/generate-3d/route.ts`
- HF Space probe *before* `Client.connect`:
  `fetch('https://huggingface.co/api/spaces/' + TRELLIS_URL, { signal: AbortSignal.timeout(3000) })`.
  If `runtime.stage !== 'RUNNING'` → return `{ fallback: true }` immediately.
- Wrap every Gradio call in `withTimeout`:
  - `Client.connect` → 15 s
  - `predict('/preprocess_image')` → 20 s
  - `predict('/image_to_3d')` → 60 s local / 90 s HF
  - `predict('/extract_glb')` → 30 s
- Global deadline: `const deadline = Date.now() + 60_000;` → `if (Date.now() > deadline) break;` before each iteration.
- Parallelize 3 assets **only** when `!IS_HF_SPACE` (HF queue serializes anyway).

### B.3 `app/api/generate-assets/route.ts`
- SD health check (`/sdapi/v1/options`, 2 s timeout) → if offline, return
  `{ background_url:null, character_url:null, platform_url:null, generated:false }`
  without firing the 3 txt2img calls.
- Lower per-call timeout 60 s → 25 s; lower `steps` 20 → 15.

### B.4 `app/api/analyze/route.ts`
- `AbortSignal.timeout(60000)` → `25000`.
- `max_tokens: 1024` → `1500` (safety margin against JSON truncation).

**Acceptance:**
- ✅ HF Space sleeping → `/api/generate-3d` returns within ≤3.5 s.
- ✅ SD offline → `/api/generate-assets` returns within ≤2.5 s.
- ✅ LM Studio offline → `/api/analyze` returns within ≤25 s (status 200, fallback body).
- ✅ Worst case client wall time ≤ ~30 s.

---

## Phase C — `/play` defenses

### C.1 Always ≥4 palette colors
```ts
const palette = useMemo(() => {
  const base = config?.color_palette ?? [];
  return [...base, '#a855f7', '#7c3aed', '#4c1d95', '#1e1b4b'].slice(0, 4);
}, [config]);
```

### C.2 Guard on empty localStorage
`useEffect`: if `gameConfig` is missing → `router.replace('/')` (not `push`).

### C.3 `web/.env.local.example`
```
QWEN_BASE_URL=http://localhost:1234
QWEN_MODEL=qwen3-coder-30b-a3b-instruct-mlx
SD_BASE_URL=http://127.0.0.1:7860
TRELLIS_URL=JeffreyXiang/TRELLIS-image-large
HF_TOKEN=
NEXT_PUBLIC_MAX_GENERATION_MS=75000
NEXT_PUBLIC_DEV_FAKE_AI=0
WRITE_GODOT_ASSETS=0
```

**Acceptance:**
- ✅ Direct hit on `/play` without `gameConfig` → redirect to `/`.
- ✅ Scene does not crash on minimal fallback config.

---

## Phase D — Game (post-demo polish)

### D.1 Restart without recreating `<Canvas>`
Drop `key={sceneKey}`. In `restart()`:
```ts
playerRef.current?.setTranslation({ x: 0, y: 4, z: 0 }, true);
playerRef.current?.setLinvel({ x: 0, y: 0, z: 0 }, true);
playerRef.current?.wakeUp();
endedRef.current = false;          // lifted into DreamScene
```

### D.2 Lift `ended` ref into `DreamScene`
So the parent can reset it on restart.

### D.3 Grounded via contact counter
```ts
const contacts = useRef(0);
onCollisionEnter={() => { contacts.current++; grounded.current = true; }}
onCollisionExit ={() => {
  contacts.current = Math.max(0, contacts.current - 1);
  grounded.current = contacts.current > 0;
}}
```

### D.4 Stable `enemyPositions`
Create one `Vector3` per enemy in the same `useMemo` that builds `enemies`.
No more rebuilt array in `useEffect`, no race with `Player.useFrame`.

---

## Phase E — Polish

- Parallel TRELLIS on self-host.
- `WRITE_GODOT_ASSETS=1` opt-in for the GODOT_DIR write.
- Optional structured logger `lib/log.ts`.

---

## Risk matrix

| Change | Risk | Mitigation |
|---|---|---|
| A.1 hard-timeout | double navigation | `navigated.current` guard |
| A.1 cleanup resets `started` | none in prod (no StrictMode) | by design for Fast Refresh |
| A.2 unified fallback | import cycle `route.ts` ↔ `lib/` | `lib/` is pure, no app deps |
| B.2 HF probe | huggingface.co down → false negative | `try/catch` → proceed anyway |
| B.4 analyze 25 s | slow local LM Studio | `ANALYZE_TIMEOUT_MS` env |
| D.1 restart-in-place | stale Rapier velocity | `setLinvel(0,0,0)` + `wakeUp()` |

---

## Out of scope (do **not** touch before demo)

- `next.config.ts` — `AGENTS.md` warns "this is NOT the Next.js you know".
- React StrictMode — guard against double-mount, do not disable.
- `lucide-react@1.16.0` upgrade — works, don't risk breaking icons.

---

## Branching

- `main` — protected, only merged on explicit "merge main now".
- `test` — active development branch.
- All Phase A/B/C/D/E work commits land on `test` first.
