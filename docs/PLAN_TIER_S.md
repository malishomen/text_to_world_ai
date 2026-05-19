# Tier S — Cinematic demo plan (v2, post-audit)

> **Goal:** deliver one unforgettable moment that wins the hackathon —
> the user types a dream, a narrator's voice reads it aloud over
> mood-tuned music while the world materialises in 3D.
>
> **Baseline:** `test @ 4d83717`. v1 of this plan (`d489c36`) was a
> feature checklist — TTS + procedural synth + typewriter + presets as
> four independent layers. Self-audit found three CRITICAL defects:
> procedural Web Audio sounds technical, browser TTS sounds robotic,
> and the layers never composed into a single cinematic moment.
>
> v2 rewrites the plan around a **cinematic intro choreography**, with
> real audio assets (ambient loops + stinger SFX), broadcast-quality
> narration via ElevenLabs (free tier, ~10k chars/month covers the
> entire hackathon), and a graceful fallback chain at every layer.

---

## The wow moment, frame by frame

This is what the judge experiences. Every component below exists to
deliver THIS choreography — not as a feature list:

```
T=0.0s   Judge clicks "Craft My Game" OR a preset card on landing.
T=0.0s   AudioContext unlocked by the click (autoplay-policy-safe).
T=0.0s   Navigate to /loading-dream.
         Custom path: brief "Crafting your world…" spinner; real LLM
                       call finishes in 15–20 s.
         Preset path: instant pass-through (no LLM, ~50 ms).
T=15s    (custom) or T=0.05s (preset): navigate to /play.
T=A+0    /play mounts. <DreamGame3D> renders WebGL scene UNDERNEATH a
         full-black overlay (CinematicIntro). Ambient loop for the
         dream's mood starts at volume 0.
T=A+0.5  Ambient loop fades in: gain 0 → 0.35 over 1.0 s.
T=A+1.0  First word of narrative appears (typewriter, ~50 ms/word).
T=A+1.0  Narrator audio (.mp3 from /api/generate-narration cache OR
         ElevenLabs streamed OR Web Speech fallback) begins. Audio
         ducks ambient gain to 0.18 for the duration.
T=A+N    Narrator finishes (N = 4–10 s for 30–60 word narrative).
         Typewriter completes synchronously OR fast-forwards if it
         falls behind.
T=A+N+1.0 Stinger "world-open" plays: short rising chord (~1.5 s).
T=A+N+1.0 Black overlay opacity 1 → 0 over 1.5 s; simultaneously
         ambient gain 0.18 → 0.5.
T=A+N+2.5 Overlay unmounts. Scene fully visible. Game playable.
         A subtle "🔊 Mood audio — click to mute" toast appears for
         3 s then fades.
…game…   Ambient continues looping. WASD/arrows + Space respond.
T=WIN    Win stinger plays (bright major chord, ~3 s). Ambient ducks
         to 0.2 for the duration. Win overlay shows after 0.5 s.
T=LOSE   Dread stinger plays (~2 s descending sub-bass + reverb tail).
         Ambient ducks similarly. Dead overlay shows.
T=Restart Enter / NumpadEnter / Space → CinematicIntro does NOT
         replay; just resets player physics. Music continues.
```

This timeline is the **single source of truth** for every agent's work.
If a deliverable doesn't service this sequence, it's out of scope.

---

## What v2 changes vs v1

| v1 (audit-rejected) | v2 (this plan) |
|---|---|
| Procedural Web Audio oscillator drones | Real CC0 / CC-BY ambient loops (8 × ~30–60 s MP3) |
| Web Speech API TTS (robotic) | ElevenLabs API (broadcast-quality), Web Speech as graceful fallback |
| Loading-screen typewriter (separate page) | CinematicIntro typewriter ON /play, sync'd with audio |
| No WIN/LOSE audio | Procedural stinger SFX (one-shot Web Audio — short bursts where synthesis works) |
| 4 independent features ("feature list") | 1 choreographed sequence (timeline above) |
| Preset cards REPLACE exampleDreams | Preset cards ADDED alongside exampleDreams |
| Ambient mixing not specified | Explicit volume map: ambient 0.35→0.18 (ducked)→0.5, narrator 0.85, stingers 0.7 |
| Mute control discoverability ignored | 3-second toast on first /play visit |
| Mobile Safari edge cases ignored | webkitAudioContext fallback, feature-detection |
| Five other audit findings (H/M/L) | All folded into per-agent prompts below |

---

## File inventory

### New files
```
web/lib/audio/AudioEngine.ts          ← Agent T
web/lib/audio/stingers.ts             ← Agent S (procedural Web Audio one-shots)
web/app/api/generate-narration/route.ts  ← Agent N
web/components/CinematicIntro.tsx     ← Agent C
web/lib/demo-presets.ts               ← Agent P
web/public/audio/ambient-<mood>.mp3   ← orchestrator Phase 0 (8 files)
web/public/audio/intro-pad.mp3        ← orchestrator Phase 0 (1 fallback ambient)
web/public/generated-tts/             ← runtime cache (gitignored)
```

### Edited files
```
web/app/page.tsx                  — Agent P (preset cards added)
web/app/play/page.tsx             — orchestrator (wires AudioEngine + CinematicIntro)
web/app/loading-dream/page.tsx    — orchestrator (simplify: remove narrative reveal,
                                    keep timer + heartbeat)
web/components/DreamGame3D.tsx    — orchestrator (2-line: call stingers on onWin/onDead)
web/.env.local                    — orchestrator (add ELEVENLABS_API_KEY documentation)
.gitignore                        — orchestrator (web/public/generated-tts/)
```

### Removed (clean-up)
Nothing existing is deleted. Loading-dream simplification keeps the
hard timeout and progress UI; only the decorative STEPS list visual is
trimmed.

---

## Phase 0 — Pre-flight (orchestrator, ~25 min)

This is the riskiest phase because it depends on EXTERNAL audio
sourcing. If it fails, we fall back gracefully (see Fallback Matrix).

### Phase 0.1 — Audio asset sourcing (orchestrator, 15 min)

Sources, in priority order:
1. **freepd.com** — Kevin MacLeod's public-domain loops. Direct mp3
   URLs, no signup, no rate limits. Reliable.
2. **pixabay.com/music** — CC0 ambient tracks. Browse + verify URL is
   accessible without a session cookie.
3. **freesound.org** — CC0/CC-BY samples; requires picking by ear.

For each of the 8 LLM moods (`surreal_calm | dark_fantasy | cozy_dream |
nightmare | cyber_dream | ethereal | whimsical | cosmic`), I curate one
30–60 s ambient track that matches:

| Mood | Vibe | Search keywords |
|---|---|---|
| nightmare | dark drone, dread | "horror drone", "dark ambient" |
| cozy_dream | warm, soft pads | "warm pad", "lo-fi forest" |
| cyber_dream | synthwave undertone | "synthwave loop", "cyberpunk ambient" |
| cosmic | spacious, slow | "space ambient", "deep space" |
| dark_fantasy | medieval, gothic | "dark fantasy", "gothic ambient" |
| ethereal | airy, glassy | "ethereal pad", "glass texture" |
| whimsical | playful, light | "playful loop", "whimsical music box" |
| surreal_calm | floating, neutral | "ambient pad", "surreal drone" |

Plus one **`intro-pad.mp3`** — a neutral 4 s rising-chord loop used as
the "world-open" stinger fallback if procedural stinger fails.

**Validation gate:** After download, each file must be 100 KB – 2 MB
MP3, valid header (verified via `ffprobe` or `file` command). Total
budget: < 12 MB. If any mood's file is missing, that mood falls back
to enhanced Web Audio synthesis (specified in Agent T below).

### Phase 0.2 — ElevenLabs API key (user, 5 min)

User goes to https://elevenlabs.io → sign up (free) → API key from
profile menu. Adds `ELEVENLABS_API_KEY=sk_...` to `web/.env.local`.

**If user skips this step:** narration falls back to Web Speech API at
runtime. The plan must still complete and ship without ElevenLabs;
quality is degraded but the choreography intact.

### Phase 0.3 — Contract sheet + scaffolding (orchestrator, 5 min)

1. `.agent-tier-s-contract.md` (gitignored): the exact text of the
   timeline above + the `AudioEngine` and narrator-fetch API surfaces
   that agents must consume.
2. `web/public/audio/.gitkeep` so the directory exists in the repo.
3. `web/public/generated-tts/.gitkeep` + add `web/public/generated-tts/*.mp3`
   to `.gitignore`.
4. `git status` clean. Note baseline `4d83717`.

---

## Phase 1 — Five parallel sub-agents (~75 min wall time)

All five launched in ONE message with five `Agent` tool calls. Each
gets `isolation: "worktree"`. Each forbidden to touch
`web/components/DreamGame3D.tsx` and any file owned by another agent.

### Agent T — AudioEngine

**Scope:** new file `web/lib/audio/AudioEngine.ts`.

**Public API (contract that other agents will program against):**

```ts
export type Mood =
  | 'surreal_calm' | 'dark_fantasy' | 'cozy_dream' | 'nightmare'
  | 'cyber_dream'  | 'ethereal'     | 'whimsical'  | 'cosmic';

export interface AudioEngineInit {
  mood: Mood;
  muted?: boolean;     // initial state; default false
}

export class AudioEngine {
  constructor(init: AudioEngineInit);

  /** Unlocks the AudioContext. MUST be called inside a user-gesture
   *  handler (pointerdown/click). Returns the resolved context state. */
  unlock(): Promise<AudioContextState>;

  /** Starts the mood ambient loop. Fades in from 0 to 0.35 over 1 s. */
  startAmbient(): Promise<void>;

  /** Cross-fades to a new mood loop over `crossfadeSec` (default 1.5). */
  setMood(mood: Mood, crossfadeSec?: number): Promise<void>;

  /** Ducks ambient gain to 0.18 for `durationSec`, then ramps back to
   *  whatever the current target gain is. Use when narrator/stinger plays.
   *  Calls stack: subsequent ducks during an active duck extend the duration. */
  duck(durationSec: number): void;

  /** Plays a one-shot audio buffer from a URL. Returns a Promise that
   *  resolves when playback ends. Bypasses ducking — caller decides. */
  playOneShot(url: string, volume?: number): Promise<void>;

  /** Toggle master mute. Persists to localStorage.audioMuted. */
  setMuted(muted: boolean): void;
  isMuted(): boolean;

  /** Stops everything, disconnects nodes, closes the AudioContext. */
  dispose(): Promise<void>;
}
```

**Implementation requirements:**
- Use `window.AudioContext || (window as any).webkitAudioContext`.
- Ambient loop: `fetch(/audio/ambient-${mood}.mp3)` → `decodeAudioData` →
  `AudioBufferSourceNode` with `loop = true`. If fetch 404, fall back to
  the enhanced procedural drone (see below).
- Cross-fade: keep two source nodes, ramp gains via
  `linearRampToValueAtTime`.
- Tab-hidden behaviour: listen to `visibilitychange`, ramp master gain
  to 0 when hidden, back to target when visible.
- Mute persists to `localStorage.audioMuted` (write only when changed).
- Idempotent `dispose()` (React Strict Mode safety).
- All `Promise`s resolve even on error — never crash the consumer.

**Enhanced procedural drone fallback (if MP3 fetch fails):**
- Per mood: 5 detuned `OscillatorNode` (root, fifth, third, octave,
  detuned root) at varying gains.
- `BiquadFilterNode` (lowpass, cutoff per mood: 400 Hz dark / 1.2 kHz
  bright, Q 4).
- `ConvolverNode` with a SYNTHETIC impulse response (4 s decaying
  noise burst with mood-tuned colour — generated in code once via
  `OfflineAudioContext`).
- `OscillatorNode` LFO modulating the lowpass cutoff (0.05–0.15 Hz).
- This is significantly richer than the naive v1 synth and acceptable
  if MP3 sourcing fails. Document the fallback gain values per mood.

**Forbidden:**
- DO NOT touch `DreamGame3D.tsx`, `/play/page.tsx`, `/loading-dream/page.tsx`.
- DO NOT install npm packages.

**Verification:** `cd web && npx tsc --noEmit` clean; export an
internal `__test_smoke()` function that constructs + unlocks +
disposes in 100 ms and use it from a unit test if time permits.

### Agent N — Narration API (ElevenLabs + fallback)

**Scope:** new file `web/app/api/generate-narration/route.ts`.

**Endpoint:**
```
POST /api/generate-narration
body: { narrative: string, mood: string, generationId: string }
→ 200 { audio_url: "/generated-tts/<id>.mp3", source: "elevenlabs" | "fallback", durationSec: number | null }
→ 200 { audio_url: null,                       source: "no-tts",                    durationSec: null }
```

**Behaviour:**
1. If `ELEVENLABS_API_KEY` is set:
   - Call `https://api.elevenlabs.io/v1/text-to-speech/<voice_id>` (POST,
     `Content-Type: application/json`, header `xi-api-key`).
   - Voice ID per mood (use ElevenLabs' default-library voice IDs —
     stable across accounts):
     - nightmare:    `pNInz6obpgDQGcFmaJgB` ("Adam", deep male)
     - cozy_dream:   `EXAVITQu4vr4xnSDxMaL` ("Bella", warm female)
     - cyber_dream:  `21m00Tcm4TlvDq8ikWAM` ("Rachel", clear female)
     - cosmic:       `29vD33N1CtxCmqQRPOHJ` ("Drew", calm male)
     - dark_fantasy: `ErXwobaYiN019PkySvjV` ("Antoni", narrator male)
     - ethereal:     `AZnzlk1XvdvUeBnXmlld` ("Domi", breathy female)
     - whimsical:    `EXAVITQu4vr4xnSDxMaL` ("Bella", playful female)
     - surreal_calm: `21m00Tcm4TlvDq8ikWAM` ("Rachel", neutral)
   - Model: `eleven_turbo_v2_5` (cheapest tier, ~$0.10 per 1k chars).
   - Voice settings: stability 0.55, similarity_boost 0.75; both nudged
     per mood (slow/dramatic for nightmare, bright for whimsical).
   - Stream response → write to `web/public/generated-tts/<generationId>.mp3`.
   - Parse `Content-Duration` header if present, else `null`.
   - Return `source: "elevenlabs"`.
2. If `ELEVENLABS_API_KEY` is missing OR ElevenLabs call fails:
   - Return `source: "fallback", audio_url: null`. Client uses Web
     Speech API as the audio source.

**Constraints:**
- 60 s `AbortSignal.timeout` for the ElevenLabs call.
- `narrative` ≤ 600 chars (truncate with ellipsis if longer).
- Validate `mood` is in the enum; default to `surreal_calm`.
- Validate `generationId` is safe via existing `isValidGenerationId`.
- Use shared `logApiError` + `badRequest` helpers (see existing routes).
- Cache hit: if `generated-tts/<generationId>.mp3` already exists,
  return its URL without calling ElevenLabs (idempotent on preset
  pre-generation in Phase 0.4 below).

**Verification:** `cd web && npx tsc --noEmit` clean.

### Agent C — CinematicIntro overlay

**Scope:** new file `web/components/CinematicIntro.tsx`.

**Component:**
```tsx
export interface CinematicIntroProps {
  narrative: string;
  mood: string;
  generationId: string;
  /** Called when the user can interact with the underlying scene
   *  (i.e., the black overlay has faded out). */
  onComplete: () => void;
  /** Called once with the AudioEngine instance so the parent can
   *  reuse it for stingers and game-over ducking. */
  onEngineReady: (engine: AudioEngine) => void;
}
export default function CinematicIntro(props: CinematicIntroProps): JSX.Element;
```

**Behaviour (matches the timeline at the top of this doc):**
1. Mount: render full-black `<div>` overlay (opacity 1, z-index above
   the scene canvas). Render an empty `<p>` for the typewriter.
2. Construct `new AudioEngine({ mood: props.mood })`, call
   `onEngineReady(engine)` so parent caches it.
3. On the FIRST `pointerdown` anywhere in the document, call
   `engine.unlock()` then `engine.startAmbient()`. If pointer never
   fires within 1.5 s, attempt unlock anyway (some browsers permit
   playback after navigation from a click on the previous page).
4. Fetch `/api/generate-narration` with `narrative + mood + generationId`.
   - If response has `audio_url`: load via `engine.playOneShot(audio_url,
     0.85)`. Call `engine.duck(estimatedDurationSec || 8)` immediately.
   - If response is `no-tts`: fall back to `SpeechSynthesisUtterance`
     with mood-tuned rate/pitch (3 profiles: dark / neutral / bright —
     see HIGH M-1 from audit).
5. Typewriter: split `narrative` on whitespace, append words on a
   timer (50 ms/word default; if narrator audio finishes, fast-forward
   the remainder over 200 ms to catch up).
6. When BOTH typewriter is done AND audio has ended (Promise from
   `playOneShot` resolves OR SpeechSynthesisUtterance fires `end`),
   wait 1.0 s, then fire stinger and start the fade-out:
   - Call parent's stinger via the AudioEngine (see Agent S exports).
     `engine.playOneShot('/audio/intro-pad.mp3', 0.6)` is the fallback
     if the procedural stinger module hasn't loaded yet.
   - CSS-transition the overlay opacity 1 → 0 over 1.5 s.
   - Simultaneously schedule `engine.duck(0)` (no-op, ends current duck)
     so ambient ramps back to its 0.5 target.
7. After fade-out finishes, call `props.onComplete()`. Parent
   unmounts the overlay.

**Lifecycle:**
- All timers cleared on unmount.
- `engine` lifetime owned by the PARENT (`/play/page.tsx`), not by
  CinematicIntro. Don't dispose on unmount — the parent will dispose
  it later when the user navigates away from /play.

**Forbidden:**
- DO NOT modify any other file.
- DO NOT call npm install.

**Verification:** `cd web && npx tsc --noEmit` clean.

### Agent S — Stinger SFX

**Scope:** new file `web/lib/audio/stingers.ts`.

**API:**
```ts
export interface StingerEngine {
  playWorldOpen(): Promise<void>;   // intro fade-in stinger (~1.5 s)
  playWin(): Promise<void>;          // bright major chord (~3 s)
  playLose(): Promise<void>;         // dread sub-bass + reverb (~2 s)
}
export function createStingers(engine: AudioEngine): StingerEngine;
```

**Implementation:**
- Each stinger is procedural Web Audio (short bursts — synthesis here
  is APPROPRIATE; ambient is what synthesis fails at).
- Win: 4 detuned oscillators in a major-9 chord, exponential gain
  envelope (0 → 0.7 over 0.05 s, hold 0.5 s, decay over 2 s).
- Lose: 3 oscillators in a tritone (root + diminished fifth + low
  octave), descending pitch sweep, long reverb tail via the AudioEngine's
  existing ConvolverNode (if accessible) or a small inline ConvolverNode.
- World-open: 3 ascending oscillators (root → fifth → octave) with
  triangular gain envelope, 1.5 s total.
- All play through `audioCtx.destination` directly OR through a
  dedicated `GainNode` so master mute affects them. Decide by reading
  what AudioEngine exposes.
- Each call ducks ambient via `engine.duck(stingerDurationSec * 0.9)`.

**Constraints:**
- DO NOT modify DreamGame3D.tsx.
- DO NOT load any external audio files.
- Cancel any in-flight stinger on dispose (parent calls
  `engine.dispose()`).

**Verification:** `cd web && npx tsc --noEmit` clean.

### Agent P — Demo presets on landing

**Scope:** new file `web/lib/demo-presets.ts` + edit `web/app/page.tsx`.

**Deliverable: 6 hand-tuned presets** covering moods (skip ethereal +
dark_fantasy to keep menu compact — orchestrator can add later):

```ts
export interface DemoPreset {
  id: string;
  label: string;           // e.g., "Bleeding Mirrors"
  badge: string;           // mood tag e.g., "nightmare"
  teaser: string;          // 8–14 word preview pulled from narrative
  dream: string;           // full dream text
  config: GameConfig;      // pre-validated; round-tripped through parseGameConfig
  generationId: string;    // stable id; same preset → same level layout
}
export const DEMO_PRESETS: readonly DemoPreset[];
```

**Self-validation requirement (must be in agent's code):**
```ts
import { parseGameConfig } from '@/lib/game-config-schema';
for (const p of DEMO_PRESETS) {
  const round = parseGameConfig(p.config, p.dream);
  if (round.mood !== p.config.mood) {
    throw new Error(`Preset ${p.id} fails parseGameConfig round-trip`);
  }
}
```
This runs at module-load time so a bad preset crashes the build, not
the demo.

**Six presets** must match seed text from earlier in this session:
1. nightmare — "bleeding mirrors / shadows tore at my heels"
2. cozy_dream — "warm garden / glowing mushrooms / sleeping fox"
3. cyber_dream — "neon megacity / circuit board / digital code"
4. cosmic — "dying stars / shattered planets / heart of a galaxy"
5. whimsical — "candy clouds / floating toys / cheerful chase"
6. surreal_calm — "drifting through soft fog / forgotten lullaby"

**Landing edit:**
- KEEP existing `exampleDreams` text-fill buttons under the "Need
  inspiration?" heading.
- ADD a NEW section above the textarea (or just below the header):
  `<h2>✨ Try a sample dream</h2>` with a 3×2 grid of preset cards
  (single column on mobile).
- Card click handler:
  ```ts
  function handlePresetClick(preset: DemoPreset) {
    localStorage.removeItem('gameAssets');
    localStorage.setItem('dreamText', preset.dream);
    localStorage.setItem('gameConfig', JSON.stringify(preset.config));
    localStorage.setItem('generationId', preset.generationId);
    router.push('/play');  // skip /loading-dream entirely
  }
  ```
- Card styling: rounded-2xl, mood-tinted gradient background using
  the preset's `config.color_palette[0]` at 20 % opacity.

**Forbidden:**
- DO NOT touch /play/page.tsx, /loading-dream/page.tsx, or any other
  component.
- DO NOT call any API at click time.

**Verification:** `cd web && npx tsc --noEmit` clean; preset
self-validation passes.

### Phase 0.4 — Pre-generate narration for presets (orchestrator, after Agent N lands)

ONCE Agent N has shipped `/api/generate-narration` and Agent P has
shipped `DEMO_PRESETS`, the orchestrator runs a script that POSTs each
preset's `(narrative, mood, generationId)` to `/api/generate-narration`.
Result: `web/public/generated-tts/preset-<id>.mp3` populated for all 6
presets. Demo clicks have ZERO latency for narration.

If ElevenLabs key is missing in Phase 0.2, this step is skipped; preset
narration falls back to Web Speech at runtime (still works, lower
quality).

---

## Phase 2 — Integration (orchestrator, ~30 min)

1. **Merge worktree outputs** into `test`:
   - `cp` files from agent worktrees.
   - No conflicts expected (each agent owns disjoint files).
   - `web/app/page.tsx` only touched by Agent P.

2. **Simplify `/loading-dream/page.tsx`:**
   - Remove the `setNarrative` setter usage in the visual layer (the
     narrative now belongs to CinematicIntro on /play).
   - KEEP the `STEPS` array, `tick`, `setAnimatedStep`, `setProgress`,
     `elapsedSec` heartbeat — they remain useful and unobtrusive.
   - The decorative step list visual stays. It's calm and reads as
     "the AI is thinking" — exactly what we want during the 15–20 s
     LLM call. No typewriter, no narrative on this page.

3. **Edit `/play/page.tsx`:**
   - Add state: `const [introDone, setIntroDone] = useState(false);`
   - Add ref: `const audioEngineRef = useRef<AudioEngine | null>(null);`
   - Render:
     ```tsx
     {!introDone && config && (
       <CinematicIntro
         narrative={config.narrative}
         mood={config.mood}
         generationId={generationId ?? 'fallback'}
         onComplete={() => setIntroDone(true)}
         onEngineReady={(e) => { audioEngineRef.current = e; }}
       />
     )}
     ```
   - Dispose the engine in a cleanup useEffect on /play unmount.
   - Add a mute toggle button in the existing `<header>` (between
     "New Dream" and "Export"). Icon: lucide-react's
     `Volume2 / VolumeX`. Click toggles `audioEngineRef.current?.setMuted(...)`.
   - On first /play mount (if `!localStorage.audioToastShown`), schedule
     a Tailwind toast "🔊 Mood audio is playing — click 🔊 to mute" that
     fades in at T+2 s, fades out at T+6 s. Mark the localStorage flag.

4. **Edit `web/components/DreamGame3D.tsx`** (minimal — 2 hook points):
   - Accept new optional props: `onWinHook?: () => void; onDeadHook?: () => void`.
   - In the existing `onWin` / `onDead` callbacks inside `DreamScene`,
     invoke these hooks BEFORE calling parent's `onWin` / `onDead`.
   - The /play page passes hooks that call `createStingers(engine).playWin()`
     and `playLose()` respectively.

5. **Verify:**
   - `cd web && npx tsc --noEmit` clean.
   - `cd web && npm run test` — 213+ passes, no regressions.
   - Restart dev server. Manual smoke:
     - Custom path: type "I was running through bleeding mirrors" →
       loading-dream spinner (~15–20 s) → /play with black intro →
       narrator audio + typewriter → fade in → playable.
     - Preset path: click "Bleeding Mirrors" card → /play instantly →
       black intro with pre-cached narrator audio → fade in.
     - Win: walk to portal → stinger + ambient duck + overlay.
     - Lose: walk off platform → dread sting + ambient duck + overlay.
     - Mute: click 🔊 → all audio stops. Reload — mute persists.

6. **Commit:**
   `feat(tier-s): cinematic intro choreography — narrator + ambient + stingers + presets`.

---

## Phase 3 — Mandatory post-audit (~25 min)

Spawn ONE audit sub-agent (`general-purpose`, no worktree, foreground).
Reads all five new files + the four integration edits.

**Audit checks (extended from v1):**

1. **Lifecycle & leaks:**
   - AudioContext closed in /play unmount cleanup.
   - All `OscillatorNode.stop()` called for every started oscillator.
   - All `setTimeout/setInterval` cleared.
   - `speechSynthesis.cancel()` called on unmount + `beforeunload`.
   - `URL.revokeObjectURL()` called for any decoded audio blob URLs.

2. **Autoplay-policy correctness:**
   - Landing button clicks → AudioContext.resume() eligible.
   - Preset card clicks → same.
   - /play direct-reload → CinematicIntro mounts in pending state;
     first pointer-event unlocks audio. Falls back to silent intro
     if user never clicks.

3. **Race conditions:**
   - CinematicIntro mounts BEFORE `/api/generate-narration` returns.
     If user clicks "New Dream" mid-narration → cancellation must be
     clean (no orphan audio).
   - Win/lose fires DURING intro (theoretically impossible — physics
     starts after fadeOut — but defensive check).
   - Mute toggle during narration → narrator pauses or cancels?
     Document the expected behaviour (recommend: cancel + persist
     muted state).

4. **Preset validity:**
   - Each preset round-trips through `parseGameConfig`.
   - Each preset's `generationId` is stable (not regenerated per
     mount).
   - Pre-generated TTS files (if any) match the preset IDs.

5. **Visual / UX:**
   - CinematicIntro is full-screen black, no transparency leaking
     during fade-in.
   - Typewriter cursor doesn't blink after audio ends.
   - Toast doesn't overlap critical HUD buttons.
   - Mute button has accessible aria-label, keyboard-focusable.

6. **Mobile / Safari:**
   - `webkitAudioContext` constructor fallback present.
   - `<audio>` elements (if used) have `playsinline` attribute.
   - Touch events unlock AudioContext (not just pointer).

7. **Bundle / perf:**
   - 8 mood MP3s loaded ON DEMAND (not preloaded at landing).
   - Total /play first-paint network: WebGL bundles + 1 active
     ambient MP3 + 1 narration MP3 = budget < 5 MB.

**Output format:** same as v1 post-audit — CRITICAL / HIGH / MEDIUM /
LOW + SHIP|FIX-CRITICAL|REWORK verdict, file:line + 1-sentence fix.

Fix CRITICAL+HIGH in a follow-up commit. MEDIUM/LOW → `memory.md § 2`.

---

## Phase 4 — Trinity sync + push (~10 min)

### `docs/PROJECT_MAP.yaml`
- New top-level subsection `audio:` listing all new files in
  `web/lib/audio/` and `web/components/CinematicIntro.tsx`.
- `directory_structure.web.public.audio` documents the 9 MP3s.
- `directory_structure.web.public.generated-tts` notes the runtime cache.
- `env.optional.ELEVENLABS_API_KEY` documented (purpose, fallback
  behaviour when missing).
- `api.endpoints` adds `/api/generate-narration` description.
- `frontend.pages` updates for `app/page.tsx` (preset cards),
  `/play/page.tsx` (CinematicIntro + mute), `/loading-dream/page.tsx`
  (simplified to spinner-only).

### `memory.md`
- § 1 invariants — add: "Audio is opt-in via mute button; default ON.
  AudioContext lifetime owned by `/play/page.tsx`."
- § 4 atomic entry covering the full Tier S v2 execution:
  - The audit findings that drove the rewrite (link to v1 plan).
  - Phase 0 audio sourcing results (which moods got real loops vs
    procedural fallback).
  - Whether ELEVENLABS_API_KEY was set and how many presets got
    pre-generated narration.
  - Audit results.
  - Total commits + push status.

### Validation
- `python -c "import yaml; yaml.safe_load(open('docs/PROJECT_MAP.yaml', encoding='utf-8'))"`.
- `cd web && npm run check:full` — full CI gate (lint + typecheck +
  tests + Playwright). Skip if Playwright not configured for the
  audio-loaded /play (which it isn't yet); document deferral.

### Push
- `git push origin test`.
- `main` is NOT merged unless user types `merge main now`.

---

## Risks and mitigations (v2)

| Risk | Mitigation |
|---|---|
| Pixabay/freepd download fails for some moods | Per-mood fallback to enhanced procedural drone in AudioEngine. Demo never silent. |
| ElevenLabs free tier exhausted mid-demo | Pre-generated preset narrations are cached. Custom path falls back to Web Speech API. |
| ElevenLabs API outage | Same as above — Web Speech fallback. |
| Chrome blocks AudioContext on /play reload | Tap-to-enter overlay = the first pointer event unlocks. Demo flow ALWAYS comes from a landing click → audio is unlocked before /play. |
| Mobile Safari TTS limited / different | Web Speech feature-detect; falls back to "audio_url: null, source: no-tts" silently. Music still plays. |
| Narrator audio shorter/longer than typewriter | Fast-forward / pause logic in CinematicIntro keeps them sync'd within 200 ms. |
| Stingers conflict with ambient ducking | Stingers also call `engine.duck()` to coordinate. Test by running win 2× in 1 s — second duck extends, no audio glitch. |
| User clicks "New Dream" mid-intro | CinematicIntro unmount cancels narrator audio + typewriter timers. AudioEngine survives — parent disposes only on /play unmount. |
| 5 parallel agents diverge on AudioEngine contract | The exact `AudioEngine` API is reproduced in Phase 0's contract sheet, and Agents N, C, S read it verbatim before coding. No agent invents new method signatures. |
| Bundle bloat from audio assets | All MP3s in `public/audio/` are served on demand (not in JS bundle). Caching is browser-default. |
| `gameAssets` localStorage leak between presets | `handlePresetClick` calls `localStorage.removeItem('gameAssets')` — matches the landing's existing custom-path cleanup. |
| Audio plays on /play unmount in slow React Strict double-render | Engine `dispose()` is idempotent. Verified in audit phase 3.1. |

---

## Fallback matrix (degradation gracefully)

| Layer | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Ambient music | Real MP3 from `/audio/ambient-<mood>.mp3` | Enhanced procedural drone (5-osc + reverb) | Silence (still ships) |
| Narration audio | ElevenLabs cached MP3 | Web Speech API | Silent typewriter (still ships) |
| Stingers | Procedural Web Audio | Single `intro-pad.mp3` fallback | Silence on event |
| Cinematic intro | Full choreography | Skip intro, mount /play directly | (unchanged) |

The plan ships at every level of the matrix. No single missing piece
breaks the demo.

---

## Acceptance criteria (Phase 4 "Done")

1. `cd web && npx tsc --noEmit` clean.
2. `cd web && npm run test` — 213 passes, zero regressions.
3. Manual smoke test passes for ALL of:
   - Custom path (real LLM call).
   - Preset path (instant).
   - Mute toggle (works both ways, persists across reload).
   - WIN stinger fires + ambient ducks.
   - LOSE stinger fires + ambient ducks.
   - Tab-hidden ducks master gain to 0; tab-visible restores.
4. ElevenLabs path (if API key set) produces narrations < 6 s end-to-end
   per call.
5. Procedural fallback path (if API key not set) produces audible Web
   Speech narration with mood-tuned voice profile.
6. `docs/PROJECT_MAP.yaml` parses + describes every new file.
7. `memory.md § 4` atomic entry committed in the same session.
8. `test` branch pushed; `main` unchanged.
9. **Subjective:** the demo MAKES YOU FEEL SOMETHING on first run.
   This is the only criterion that matters.

---

## Estimated wall time

| Phase | Time |
|---|---|
| 0 Pre-flight (audio sourcing, key setup, contract sheet) | 25 min |
| 1 Parallel agents ×5 | ~75 min (longest agent caps wall time) |
| 2 Integration + smoke test | 30 min |
| 3 Mandatory post-audit + fixes | 25 min |
| 4 Trinity sync + push | 10 min |
| **Total** | **~165 min** (~2 h 45 min) |

Slightly heavier than v1 (~120 min) — the extra hour buys real audio,
real narration, win/lose audio, and the cinematic choreography that
defines this demo.

---

## Authorship and revision history

- **v1** (`d489c36`, 2026-05-19 evening): initial Tier S plan, 4
  parallel agents, procedural audio + browser TTS + typewriter on
  loading-dream + preset cards replacing exampleDreams.
- **Audit** (this conversation, 2026-05-19): self-review surfaced 3
  CRITICAL + 6 HIGH + 5 MEDIUM + 5 LOW findings. Verdict was
  "executable but wow-ceiling 6/10".
- **v2** (this document): rewrites around the cinematic timeline,
  real audio assets, ElevenLabs + graceful fallback, 5 agents,
  stingers, preserves exampleDreams.

Updates during execution → append `### Addendum YYYY-MM-DD: <topic>`
at the bottom, never edit earlier sections.

— Claude Opus 4.7 (1M context), Tier S co-architect.
