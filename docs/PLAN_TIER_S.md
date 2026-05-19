# Tier S — Demo-readiness plan

> **Goal:** transform DreamCraft from a silent procedural tech demo into a
> cinematic "AI understood my dream" experience that wins the hackathon.
> Targets the emotional/sensory layer the current build lacks — audio,
> presets, and narrative ceremony — not raw render quality.
>
> **Baseline:** `test @ d489c36`. Tier 1 atmosphere shipped, TRELLIS.2 wired
> (gated on SD), LLM rich-prompts active.
>
> **Constraint:** no dependency on external API keys. Everything works
> offline against the user's LM Studio. (FLUX/fal.ai stays a separate
> upgrade — Tier A, not in this plan.)

---

## What's in / what's out

### IN (Tier S, this plan)

1. **TTS narrative** — Web Speech API reads `config.narrative` aloud on
   `/play` mount. Per-mood voice tuning (rate, pitch). Mute control in HUD.
2. **Procedural mood-driven ambient audio** — Web Audio API synthesises an
   ambient drone per mood (root note, modulation, layered sines, noise).
   Zero external assets, zero licensing risk, parameters match
   `moodPresetFor()`.
3. **Loading-dream narrative reveal** — replace the decorative step list
   with a word-by-word typewriter rendering of the LLM's `narrative` as
   soon as `/api/analyze` settles. Keeps the hard-timeout navigation.
4. **Demo presets on landing** — 6 one-click dream cards with pre-validated
   `gameConfig` baked in. Click → write to localStorage → skip
   `/loading-dream` straight to `/play`. Judges don't type.

### OUT (deferred to Tier A or post-hackathon)

- FLUX via fal.ai for SD-step unlock (separate, requires API key + funds).
- Pre-generated TRELLIS.2 PBR character GLB asset bank (requires Tier A done first).
- Camera shake, mobile touch controls, share-link encoding.
- Hunyuan3D-2.1 / FLUX local installs.

---

## Phase 0 — Pre-flight (orchestrator, ~10 min)

1. `git status` clean, baseline `d489c36`.
2. Create directory `web/lib/audio/` for the synth engine.
3. Note the four LLM mood enum values that **must** all map to an audio
   preset and a voice tuning: `surreal_calm | dark_fantasy | cozy_dream |
   nightmare | cyber_dream | ethereal | whimsical | cosmic`.
4. Confirm `localStorage` keys we'll use: existing
   (`dreamText | gameConfig | gameAssets | generationId`) + new
   (`audioMuted`, default `false`).
5. Confirm autoplay-policy stance: Chrome blocks audio context until first
   user gesture. **Click on landing's "Craft My Game" / preset card is the
   user gesture.** Pages that mount audio on `/play` must guard with
   `audioContext.state === 'suspended'` → `resume()` on first interaction.
6. **Contract sheet** (`.agent-tier-s-contract.md`, temporary): file paths,
   types, and the forbidden zone. Each agent reads it.

**Output of Phase 0:** empty audio directory + contract sheet.

---

## Phase 1 — Parallel sub-agents (~60 min wall time)

Four agents, all `isolation: "worktree"`, all launched in the same message
so they run concurrently. Each owns ONE new file or scope; the
orchestrator integrates after.

### Agent T — TTS narrative

**Subagent type:** `general-purpose`
**Scope:** new file `web/lib/audio/tts.ts` + minor edit to
`web/app/play/page.tsx` (allowed; only this page).

**Deliverable:**
- `web/lib/audio/tts.ts` exporting:
  ```ts
  export interface TtsOptions {
    text: string;
    mood: string;
    onStart?: () => void;
    onEnd?: () => void;
  }
  export function speakNarrative(opts: TtsOptions): () => void; // returns canceller
  export function cancelAllSpeech(): void;
  export function isTtsAvailable(): boolean;
  ```
- Per-mood `voiceTuningFor(mood)` returning `{ rate, pitch, volume }`.
  - nightmare: rate 0.85, pitch 0.7, volume 0.9
  - cozy_dream: rate 0.95, pitch 1.15, volume 0.85
  - cyber_dream: rate 1.05, pitch 0.95, volume 0.85
  - cosmic: rate 0.85, pitch 0.9, volume 0.8
  - dark_fantasy: rate 0.9, pitch 0.75, volume 0.9
  - ethereal: rate 0.85, pitch 1.2, volume 0.7
  - whimsical: rate 1.1, pitch 1.25, volume 0.85
  - surreal_calm / default: rate 0.95, pitch 1.0, volume 0.85
- Voice selection: prefer first `en-US` female voice, fallback to first
  `en-*` available, fallback to default voice.
- `/play/page.tsx` integration: on mount, if `config.narrative` exists and
  `!muted`, call `speakNarrative({ text, mood: config.mood })`. Cleanup
  cancels speech on unmount.
- HUD mute button toggle in the top bar (next to "New Dream" and "Export"),
  persists to `localStorage.audioMuted`.

**Constraints:**
- DO NOT touch `web/components/DreamGame3D.tsx`.
- DO NOT install new packages.
- Cancel on `beforeunload` + on `/play` unmount.
- Handle the case `window.speechSynthesis === undefined` (older browsers).

**Verification:** `npx tsc --noEmit` clean; mute toggle persists across
reload.

### Agent A — Procedural ambient audio

**Subagent type:** `general-purpose`
**Scope:** new files `web/lib/audio/AmbientEngine.ts` + `web/lib/audio/moods.ts`,
plus minor edit to `web/app/play/page.tsx` (allowed; same edit zone as TTS).

**Deliverable:**
- `web/lib/audio/moods.ts` exporting `audioPresetFor(mood: string)`:
  ```ts
  export interface AudioPreset {
    rootHz: number;          // base drone frequency
    fifthHz: number;         // harmonic layer
    octaveHz: number;
    lfoHz: number;           // tremolo modulation rate
    lfoDepth: number;        // 0..1
    noiseLevel: number;      // 0..0.3, low-freq pink noise blend
    pluckIntervalSec: number; // 0 disables; otherwise an occasional pluck note
    pluckPitchHz: number;
    filterCutoffHz: number;
    masterGain: number;      // 0..0.5 (low — ambient under TTS)
  }
  ```
  Plus eight presets matching the LLM mood enum.
- `web/lib/audio/AmbientEngine.ts` exporting a class:
  ```ts
  export class AmbientEngine {
    constructor(preset: AudioPreset);
    start(): void;       // requires existing AudioContext.resume() called by caller
    stop(): void;        // ramps gain to 0, then disconnects all nodes
    setPreset(p: AudioPreset, crossfadeSec?: number): void; // smooth transition
    setMasterGain(g: number): void;
    setMuted(muted: boolean): void;
    dispose(): void;     // hard close, audioContext.close()
  }
  ```
  Internals: 2-3 layered `OscillatorNode` (sine + triangle) → `BiquadFilterNode`
  (lowpass) → `GainNode` (master). LFO via another oscillator modulating
  gain. `AudioBufferSourceNode` for soft pink noise. Pluck via short
  `OscillatorNode` with exponential gain envelope every `pluckIntervalSec`.
- `/play/page.tsx` integration: create an AudioContext on first mount
  (after a user gesture flag), instantiate `AmbientEngine` with mood
  preset, `start()` on mount, `stop() + dispose()` on unmount. Mute
  syncs with the TTS mute control (single `localStorage.audioMuted`).

**Constraints:**
- DO NOT touch `DreamGame3D.tsx`, `loading-dream/page.tsx`, or any
  component under `web/components/scene/`.
- ZERO external audio assets — pure Web Audio synthesis.
- Engine must respond to Chrome's autoplay policy gracefully:
  if AudioContext is suspended on instantiation, queue a `resume()` call
  for the next user pointerdown on document.
- No `setInterval` leaks — use a single scheduler tied to AudioContext
  `currentTime` for plucks; cancel via `dispose()`.

**Verification:** `npx tsc --noEmit` clean; no `eval`/`new Function`; no
deps added.

### Agent L — Loading-screen narrative reveal

**Subagent type:** `general-purpose`
**Scope:** edit `web/app/loading-dream/page.tsx` only.

**Deliverable:**
- When `setNarrative(text)` is called inside `runPipeline()` (already
  happens), the existing UI must:
  1. Hide the decorative step list (fade out via opacity transition).
  2. Reveal the narrative word-by-word with a 60-80ms typewriter cadence.
  3. Keep the hard `MAX_GENERATION_MS` navigate timer untouched — if the
     reveal hasn't finished by `T - 1.5s`, fast-forward to full text.
- New props for the reveal: a `<NarrativeReveal text={narrative} done={...}>`
  inner component. When `done` fires, schedule a 1.5s pause before
  `goPlay('ok')`. This pause is INSIDE the existing 75s budget — wrap with
  `Math.min(now + 1500, MAX_GENERATION_MS deadline)` so we never overrun.
- Keep the loading screen's background ambience and bg-pulse — only the
  central text region changes.
- Preserve the elapsedSec heartbeat (still useful when LLM is slow).

**Constraints:**
- DO NOT touch `/play/page.tsx`, the API routes, or any component.
- DO NOT introduce new fetches.
- DO NOT change the navigation contract (still must go to `/play` within
  `MAX_GENERATION_MS`).

**Verification:** `npx tsc --noEmit` clean; manual smoke: with a real
LLM response in 15s, the narrative typewriters out over ~5-8s, then
1.5s breath, then navigate — total under 25s end-to-end.

### Agent P — Demo presets on landing

**Subagent type:** `general-purpose`
**Scope:** new file `web/lib/demo-presets.ts` + edit to
`web/app/page.tsx` only.

**Deliverable:**
- `web/lib/demo-presets.ts` exporting 6 hand-tuned `DemoPreset` entries.
  Each preset bundles:
  ```ts
  export interface DemoPreset {
    id: string;                 // stable kebab-case id
    label: string;              // short button label
    dream: string;              // full dream text (60-180 chars)
    config: GameConfig;         // pre-validated config matching the dream
    generationId: string;       // deterministic id so the same preset always
                                // builds the same level layout
  }
  ```
- The 6 presets cover six moods (skip ethereal + dark_fantasy for now to
  keep the menu compact): nightmare, cozy_dream, cyber_dream, cosmic,
  whimsical, surreal_calm. Use the example prompts I gave earlier in the
  session as the seed text; expand each `config` by hand to look
  legitimately LLM-generated (narrative 2 sentences, music_prompt 12-16
  words, palette aligned with mood, platforms 6-8, enemy_count 3-4).
- Landing `app/page.tsx`:
  - Replace the existing static `exampleDreams` text-only list with a
    grid of 6 preset cards. Each card shows the mood label + a 1-line
    teaser from the narrative.
  - Clicking a preset card writes:
    ```ts
    localStorage.removeItem('gameConfig');
    localStorage.removeItem('gameAssets');
    localStorage.removeItem('generationId');
    localStorage.setItem('dreamText', preset.dream);
    localStorage.setItem('gameConfig', JSON.stringify(preset.config));
    localStorage.setItem('generationId', preset.generationId);
    router.push('/play');  // SKIP loading-dream entirely
    ```
  - Keep the textarea + "Craft My Game" button — that's the custom path
    using the real LLM.

**Constraints:**
- DO NOT touch any other page or component.
- DO NOT call any API at click time.
- Cards must be styled consistent with the existing landing aesthetic
  (purple gradient, soft cards). Use Tailwind classes already present in
  the page.

**Verification:** `npx tsc --noEmit` clean; clicking a preset lands on
`/play` in < 500ms with the matching mood scene.

---

## Phase 2 — Integration (orchestrator, ~25 min)

1. Merge the four worktrees into `test`:
   - `cp` files from agent worktrees to main tree.
   - Resolve `web/app/play/page.tsx` if both Agent T and Agent A
     edited it (use the contract sheet's section markers).
2. Verify `npx tsc --noEmit` and `npm run test` (213+ unit tests, none
   should regress).
3. Run dev server. Manual smoke:
   - Custom path: type a dream → loading screen prints narrative
     letter-by-letter → /play with TTS reading aloud + mood-tuned drone.
   - Preset path: click "nightmare" card → /play in <1s with TTS + drone.
   - Mute button: stops TTS + drone, persists across reload.
4. Commit. Conventional commit message:
   `feat(tier-s): TTS narrative + procedural ambient + loading reveal + demo presets`.

---

## Phase 3 — Mandatory post-audit (~20 min)

Spawn one audit sub-agent (`general-purpose`, foreground, no worktree).

**Audit prompt:** reviews all four new files + the page edits + the
`/play/page.tsx` merge point. Specifically checks:

- **Audio lifecycle:** `AudioContext` always closed on unmount;
  `OscillatorNode.stop()` called for every started oscillator; no
  setInterval/setTimeout leaks.
- **TTS lifecycle:** `speechSynthesis.cancel()` on unmount AND on
  `beforeunload`; no double-speak on /play remount.
- **Autoplay policy:** on Chrome with strict autoplay, the AudioContext is
  resumed by a user gesture; on /play direct-load (preset path),
  the click on the preset card on the landing page IS the gesture, so
  the context inherits autoplay grant.
- **Narrative reveal race:** if `/api/analyze` returns AFTER the hard
  timer fires (impossible in current code but defensive), the reveal
  must abort cleanly.
- **Preset config validity:** each of the 6 hand-tuned `GameConfig` objects
  passes `parseGameConfig(preset.config, preset.dream)` round-trip
  without losing fields.
- **Memory leaks under React strict mode double-mount:** Engine's
  `dispose()` is idempotent.
- **Tab-hidden behavior:** when `document.hidden`, the engine should
  reduce gain to 0 (not stop oscillators — restart latency is bad). On
  visible, ramp back up.

Output: CRITICAL / HIGH / MEDIUM / LOW + SHIP|FIX-CRITICAL|REWORK.

Fix CRITICAL+HIGH in a follow-up commit. MEDIUM/LOW → `memory.md § 2`.

---

## Phase 4 — Trinity sync + push (~5 min)

- `docs/PROJECT_MAP.yaml`:
  - Add `web/lib/audio/` directory entry with three files described.
  - Add `web/lib/demo-presets.ts` description.
  - Update `frontend.pages` for `app/page.tsx` (preset cards) and
    `loading-dream/page.tsx` (narrative reveal).
  - Note new localStorage key `audioMuted`.
- `memory.md`:
  - § 4 atomic entry covering this whole Tier S execution
    (Phase 0-3 results, audit findings).
  - § 1 (invariants): add "Audio is opt-in (mute button), default ON;
    AudioContext lifecycle owned by `/play/page.tsx`".
- `python -c "import yaml; yaml.safe_load(open('docs/PROJECT_MAP.yaml', encoding='utf-8')); print('OK')"`
- `git push origin test`.
- `main` is NOT merged unless user types `merge main now`.

---

## Summary table

| Phase | Owner | Time | Output |
|---|---|---:|---|
| 0 Pre-flight | orchestrator | 10 min | `.agent-tier-s-contract.md`, `web/lib/audio/` |
| 1 Parallel ×4 | sub-agents | 60 min | 4-6 new files, 2 page edits |
| 2 Integration | orchestrator | 25 min | One feat commit |
| 3 Post-audit | 1 sub-agent + orchestrator | 20 min | Audit report + 0-1 fix commits |
| 4 Trinity sync | orchestrator | 5 min | PROJECT_MAP + memory + push |
| **Total** | | **~120 min** | 2-3 commits on `test` |

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chrome blocks AudioContext autoplay | Resume on landing button-click (which always precedes /play). On preset path, the card click counts. On reload of /play, suspend → display "click to start audio" microcopy that disappears on first interaction. |
| TTS voice "weird" on user's OS | Fallback chain: en-US female → en-* → default. Mute button always available. |
| Procedural drone sounds too video-gamey | Audit Phase tunes filter cutoff + LFO depth per mood; lean toward sub-bass + reverb-feel via filter Q rather than synthwave brightness. |
| Preset `GameConfig` drift if schema changes | Each preset round-tripped through `parseGameConfig` in the audit phase. Type safety guarantees field names. |
| Two `/play/page.tsx` edits (TTS + Audio) collide | Contract sheet places TTS hook inside an explicit `// TIER-S: TTS` marker block, Audio inside `// TIER-S: AMBIENT`; orchestrator merges by section. |
| TTS reading after navigate to landing | `useEffect` cleanup cancels on unmount; `beforeunload` belt-and-suspenders. |
| Audio cost on slow devices | Single AudioContext, 3-5 oscillators max, lowpass filter. Should be < 1% CPU on any 2020+ machine. |
| Audit finds CRITICAL | Fix in Phase 3 follow-up commit; ship may slip but quality stays. |

---

## Acceptance criteria (Phase 4 "Done")

1. `npx tsc --noEmit` clean.
2. `npm run test` 213+ passes, no regressions.
3. Manual: custom dream → /play hears narrative read aloud over mood drone.
4. Manual: click preset card → /play in <1s with matching audio.
5. Mute button visible on /play, toggles both TTS and drone, persists.
6. `docs/PROJECT_MAP.yaml` describes audio dir + demo-presets.
7. `memory.md § 4` has one atomic Tier S entry.
8. `test` branch pushed; `main` unchanged.

---

## Author / authorship discipline

Plan written by Claude Opus 4.7 (1M context) at user's request as a fixed
reference for the Tier S execution sweep. Updates to this plan during
execution should be appended as `### Addendum YYYY-MM-DD: <topic>` sections
at the bottom, not by editing earlier sections.
