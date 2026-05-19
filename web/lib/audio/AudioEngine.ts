/**
 * AudioEngine — master audio runtime for the Tier S cinematic intro.
 *
 * Owns a single AudioContext. The ambient path is PROCEDURAL by default
 * (5-7 detuned oscillators → biquad lowpass → convolver reverb → master
 * gain, modulated by two LFOs). If a manual override MP3 exists at
 * `/audio/ambient-<mood>.mp3` (HTTP 200), it is decoded and looped as the
 * ambient source instead of synthesis.
 *
 * Public API is frozen by `.agent-tier-s-contract.md` — additions allowed,
 * removals forbidden. Agents N, C, S consume this class.
 *
 * State machine (master gain on the ambient bus):
 *   - startAmbient()              : 0 → 0.35 over 1.0 s; _targetGain = 0.35
 *   - setAmbientGainTarget(t,r)   : current → t over r s;  _targetGain = t
 *   - duck(durationSec)           : current → 0.18 over 100 ms, then back
 *                                   to _targetGain over 400 ms starting at
 *                                   (now + durationSec). Re-entrant: the
 *                                   second call EXTENDS, never stacks.
 *   - setMuted(true)              : current → 0 over 200 ms (oscillators
 *                                   keep running, _targetGain untouched)
 *   - setMuted(false)             : current → _targetGain over 200 ms
 *   - visibilitychange hidden     : current → 0 over 300 ms
 *   - visibilitychange visible    : current → _targetGain over 300 ms
 */

export type Mood =
  | 'surreal_calm'
  | 'dark_fantasy'
  | 'cozy_dream'
  | 'nightmare'
  | 'cyber_dream'
  | 'ethereal'
  | 'whimsical'
  | 'cosmic';

export interface AudioEngineInit {
  mood: Mood;
  muted?: boolean;
}

interface MoodPreset {
  /** Root frequency in Hz. Higher = brighter. */
  root: number;
  /** Lowpass cutoff in Hz. Lower = darker. */
  cutoff: number;
  /** Convolver IR spectral tilt: -1 = bias low frequencies, +1 = bias high. */
  irTilt: number;
  /** Slow LFO Hz (filter cutoff modulation). */
  filterLfoHz: number;
  /** Filter LFO depth in Hz. */
  filterLfoDepth: number;
  /** Faster LFO Hz (master tremolo). */
  tremoloLfoHz: number;
  /** Tremolo depth (gain). */
  tremoloLfoDepth: number;
  /** Whether to add the major-third voice for brighter colour. */
  includeThird: boolean;
  /** Cents of detune for the chorus pair. */
  chorusDetuneCents: number;
}

const MOOD_PRESETS: Record<Mood, MoodPreset> = {
  nightmare: {
    root: 55,
    cutoff: 350,
    irTilt: -0.8,
    filterLfoHz: 0.05,
    filterLfoDepth: 220,
    tremoloLfoHz: 0.22,
    tremoloLfoDepth: 0.10,
    includeThird: false,
    chorusDetuneCents: 9,
  },
  dark_fantasy: {
    root: 65,
    cutoff: 450,
    irTilt: -0.6,
    filterLfoHz: 0.06,
    filterLfoDepth: 200,
    tremoloLfoHz: 0.25,
    tremoloLfoDepth: 0.08,
    includeThird: true,
    chorusDetuneCents: 7,
  },
  cozy_dream: {
    root: 110,
    cutoff: 800,
    irTilt: 0.2,
    filterLfoHz: 0.08,
    filterLfoDepth: 180,
    tremoloLfoHz: 0.30,
    tremoloLfoDepth: 0.06,
    includeThird: true,
    chorusDetuneCents: 6,
  },
  cyber_dream: {
    root: 82,
    cutoff: 950,
    irTilt: 0.3,
    filterLfoHz: 0.09,
    filterLfoDepth: 240,
    tremoloLfoHz: 0.35,
    tremoloLfoDepth: 0.08,
    includeThird: true,
    chorusDetuneCents: 12,
  },
  cosmic: {
    root: 73,
    cutoff: 700,
    irTilt: 0.0,
    filterLfoHz: 0.05,
    filterLfoDepth: 260,
    tremoloLfoHz: 0.20,
    tremoloLfoDepth: 0.07,
    includeThird: false,
    chorusDetuneCents: 10,
  },
  ethereal: {
    root: 130,
    cutoff: 1500,
    irTilt: 0.8,
    filterLfoHz: 0.07,
    filterLfoDepth: 300,
    tremoloLfoHz: 0.28,
    tremoloLfoDepth: 0.05,
    includeThird: true,
    chorusDetuneCents: 5,
  },
  whimsical: {
    root: 130,
    cutoff: 1100,
    irTilt: 0.5,
    filterLfoHz: 0.10,
    filterLfoDepth: 240,
    tremoloLfoHz: 0.40,
    tremoloLfoDepth: 0.09,
    includeThird: true,
    chorusDetuneCents: 8,
  },
  surreal_calm: {
    root: 98,
    cutoff: 700,
    irTilt: 0.1,
    filterLfoHz: 0.06,
    filterLfoDepth: 200,
    tremoloLfoHz: 0.22,
    tremoloLfoDepth: 0.06,
    includeThird: false,
    chorusDetuneCents: 6,
  },
};

/** Steady-state ambient target after the intro fade-in. */
const DEFAULT_TARGET_GAIN = 0.35;
/** Gain while ducked (narrator/stinger). */
const DUCK_GAIN = 0.18;
/** Visible/hidden ramp time (seconds). */
const VISIBILITY_RAMP_SEC = 0.3;
/** Mute ramp time (seconds). */
const MUTE_RAMP_SEC = 0.2;
/** Duck-down ramp (seconds). */
const DUCK_DOWN_SEC = 0.1;
/** Duck-up ramp (seconds). */
const DUCK_UP_SEC = 0.4;
/** Crossfade default (seconds). */
const DEFAULT_CROSSFADE_SEC = 1.5;
/** Intro fade-in time (seconds). */
const INTRO_FADE_SEC = 1.0;
/** localStorage key for persisted mute state. */
const MUTE_STORAGE_KEY = 'audioMuted';

/** One drone chain: oscillators + filter + convolver + per-chain gain. */
interface DroneChain {
  oscillators: OscillatorNode[];
  lfos: OscillatorNode[];
  filter: BiquadFilterNode;
  convolver: ConvolverNode;
  chainGain: GainNode;
  /** Source node when using MP3 override path; null when procedural. */
  bufferSource: AudioBufferSourceNode | null;
}

/** Minimal cast — the only acceptable `any` (webkit prefix). */
type WebkitWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export class AudioEngine {
  private ctx: AudioContext | null = null;

  /** Master gain on the ambient bus. Stinger one-shots bypass it. */
  private masterGain: GainNode | null = null;
  /**
   * One-shot bus — narrator MP3s + procedural stingers route through this
   * GainNode instead of `ctx.destination`. setMuted() ramps it to 0/1 so
   * the mute toggle silences EVERYTHING, not just the ambient drone.
   * Intentionally separate from masterGain so ducking doesn't lower the
   * stinger that triggered the duck.
   */
  private oneShotBus: GainNode | null = null;

  private currentMood: Mood;
  private currentChain: DroneChain | null = null;

  /** Steady-state gain target set by caller. Default 0.35 after startAmbient. */
  private _targetGain: number = 0;

  /** Cached per-mood impulse-response buffers. */
  private readonly irCache: Map<Mood, AudioBuffer> = new Map();

  /** Cached decoded buffers for playOneShot URLs. */
  private readonly oneShotBufferCache: Map<string, AudioBuffer> = new Map();

  /** Cached decoded MP3 override buffers, keyed by mood. null = miss. */
  private readonly ambientOverrideCache: Map<Mood, AudioBuffer | null> = new Map();

  private muted: boolean;
  private disposed: boolean = false;
  private ambientStarted: boolean = false;

  /** Pending duck-restore timeout id; cleared on extension or dispose. */
  private duckRestoreTimer: ReturnType<typeof setTimeout> | null = null;
  /** End-time (ctx.currentTime + remaining sec) of the active duck, or null. */
  private duckEndsAt: number | null = null;

  /** All scheduled timer ids — cleared in dispose. */
  private readonly timers: Set<ReturnType<typeof setTimeout>> = new Set();

  /** Bound visibilitychange handler reference so we can remove it. */
  private readonly visibilityHandler: () => void;

  constructor(init: AudioEngineInit) {
    this.currentMood = init.mood;
    // Read persisted mute, falling back to constructor init, falling back to false.
    let persistedMute: boolean | null = null;
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(MUTE_STORAGE_KEY);
        if (raw === '1') persistedMute = true;
        else if (raw === '0') persistedMute = false;
      } catch {
        // localStorage unavailable (privacy mode) — ignore.
      }
    }
    this.muted = persistedMute ?? init.muted ?? false;

    this.visibilityHandler = () => {
      if (!this.ctx || !this.masterGain || this.disposed) return;
      const now = this.ctx.currentTime;
      const g = this.masterGain.gain;
      g.cancelScheduledValues(now);
      const startValue = g.value;
      g.setValueAtTime(startValue, now);
      if (typeof document !== 'undefined' && document.hidden) {
        g.linearRampToValueAtTime(0, now + VISIBILITY_RAMP_SEC);
      } else {
        const restoreTarget = this.muted ? 0 : this._targetGain;
        g.linearRampToValueAtTime(restoreTarget, now + VISIBILITY_RAMP_SEC);
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  /**
   * Unlocks the AudioContext. MUST be called inside a user-gesture handler.
   * Idempotent: safe to call repeatedly. Resolves to the resulting state.
   */
  async unlock(): Promise<AudioContextState> {
    if (this.disposed) return 'closed';
    if (!this.ctx) {
      try {
        const Ctor: typeof AudioContext | undefined =
          typeof window !== 'undefined'
            ? window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
            : undefined;
        if (!Ctor) {
          // No Web Audio support — return a closed-equivalent state.
          return 'closed';
        }
        this.ctx = new Ctor();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0;
        this.masterGain.connect(this.ctx.destination);
        this.oneShotBus = this.ctx.createGain();
        this.oneShotBus.gain.value = this.muted ? 0 : 1;
        this.oneShotBus.connect(this.ctx.destination);
      } catch {
        return 'closed';
      }
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        // Browser refused (no gesture yet). Caller can retry.
      }
    }
    return this.ctx.state;
  }

  /**
   * Starts the mood ambient loop. Fades the master gain 0 → 0.35 over 1.0 s.
   * Sets _targetGain = 0.35. Idempotent: calling twice is a no-op.
   */
  async startAmbient(): Promise<void> {
    if (this.disposed) return;
    if (this.ambientStarted) return;
    if (!this.ctx || !this.masterGain) {
      // Need unlock() first. Be permissive — try to unlock now.
      const state = await this.unlock();
      if (state === 'closed' || !this.ctx || !this.masterGain) return;
    }

    try {
      this.currentChain = await this.buildChain(this.currentMood);
      this.currentChain.chainGain.connect(this.masterGain);

      const now = this.ctx.currentTime;
      this._targetGain = DEFAULT_TARGET_GAIN;
      const g = this.masterGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(this.muted ? 0 : 0, now);
      const finalGain = this.muted ? 0 : DEFAULT_TARGET_GAIN;
      g.linearRampToValueAtTime(finalGain, now + INTRO_FADE_SEC);

      this.ambientStarted = true;
    } catch {
      // Build failed — leave engine in a usable state, no crash.
    }
  }

  /**
   * Cross-fades from the current drone chain to a new one tuned for `mood`.
   * Updates `currentMood`. Disposes the old chain after the crossfade.
   */
  async setMood(mood: Mood, crossfadeSec: number = DEFAULT_CROSSFADE_SEC): Promise<void> {
    if (this.disposed) return;
    if (mood === this.currentMood && this.currentChain) {
      // Same mood — nothing to do.
      return;
    }
    this.currentMood = mood;

    if (!this.ctx || !this.masterGain || !this.ambientStarted) {
      // Not playing yet — just record the new mood; startAmbient will use it.
      return;
    }

    let newChain: DroneChain;
    try {
      newChain = await this.buildChain(mood);
    } catch {
      return;
    }

    const oldChain = this.currentChain;
    this.currentChain = newChain;
    newChain.chainGain.connect(this.masterGain);

    const now = this.ctx.currentTime;
    const fade = Math.max(0.05, crossfadeSec);

    // Ramp old → 0, new → _targetGain (on per-chain gains, NOT master).
    if (oldChain) {
      const og = oldChain.chainGain.gain;
      og.cancelScheduledValues(now);
      og.setValueAtTime(og.value, now);
      og.linearRampToValueAtTime(0, now + fade);
    }

    const ng = newChain.chainGain.gain;
    ng.cancelScheduledValues(now);
    ng.setValueAtTime(0, now);
    ng.linearRampToValueAtTime(1, now + fade);

    // Schedule disposal of the old chain after the crossfade completes.
    if (oldChain) {
      const id = setTimeout(() => {
        this.timers.delete(id);
        this.teardownChain(oldChain);
      }, Math.ceil(fade * 1000) + 50);
      this.timers.add(id);
    }
  }

  /**
   * Ducks the ambient bus to 0.18 for `durationSec`, then ramps back to
   * `_targetGain`. Calling again during an active duck EXTENDS the duck.
   */
  duck(durationSec: number): void {
    if (this.disposed || !this.ctx || !this.masterGain) return;
    if (this.muted) {
      // Muted: still track the duck end-time so a later unmute restores
      // to the correct level, but don't touch gain (already 0).
      const now = this.ctx.currentTime;
      const newEnd = now + Math.max(0, durationSec);
      this.duckEndsAt = this.duckEndsAt !== null && this.duckEndsAt > newEnd
        ? this.duckEndsAt
        : newEnd;
      return;
    }

    const now = this.ctx.currentTime;
    const requestedEnd = now + Math.max(0, durationSec);

    // Extension logic: if there's already an active duck whose end-time
    // is later than the requested one, keep the existing end-time.
    const newEnd = this.duckEndsAt !== null && this.duckEndsAt > requestedEnd
      ? this.duckEndsAt
      : requestedEnd;
    this.duckEndsAt = newEnd;

    // Cancel any pending restore — we'll reschedule.
    if (this.duckRestoreTimer !== null) {
      clearTimeout(this.duckRestoreTimer);
      this.timers.delete(this.duckRestoreTimer);
      this.duckRestoreTimer = null;
    }

    // Ramp down to DUCK_GAIN over DUCK_DOWN_SEC starting now.
    const g = this.masterGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(DUCK_GAIN, now + DUCK_DOWN_SEC);

    // Schedule the ramp back to _targetGain starting at newEnd.
    // The setTimeout fires in wall-clock ms relative to NOW.
    const restoreDelayMs = Math.max(0, (newEnd - now) * 1000);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.duckRestoreTimer = null;
      this.duckEndsAt = null;
      if (this.disposed || !this.ctx || !this.masterGain) return;
      if (this.muted) return;
      const t = this.ctx.currentTime;
      const gg = this.masterGain.gain;
      gg.cancelScheduledValues(t);
      gg.setValueAtTime(gg.value, t);
      gg.linearRampToValueAtTime(this._targetGain, t + DUCK_UP_SEC);
    }, restoreDelayMs);
    this.duckRestoreTimer = timer;
    this.timers.add(timer);
  }

  /**
   * Plays a one-shot from `url` through a dedicated GainNode → destination.
   * The one-shot bypasses ducking and master mute (caller sets volume).
   * Resolves on 'ended', rejects with a real Error on decode failure.
   */
  async playOneShot(url: string, volume: number = 0.85): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx) {
      const state = await this.unlock();
      if (state === 'closed' || !this.ctx) {
        throw new Error('AudioEngine.playOneShot: AudioContext unavailable');
      }
    }
    const ctx = this.ctx;

    let buffer = this.oneShotBufferCache.get(url);
    if (!buffer) {
      let response: Response;
      try {
        response = await fetch(url);
      } catch (err) {
        throw new Error(
          `AudioEngine.playOneShot: fetch failed for ${url}: ${(err as Error).message}`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `AudioEngine.playOneShot: HTTP ${response.status} for ${url}`,
        );
      }
      let arrayBuf: ArrayBuffer;
      try {
        arrayBuf = await response.arrayBuffer();
      } catch (err) {
        throw new Error(
          `AudioEngine.playOneShot: arrayBuffer failed for ${url}: ${(err as Error).message}`,
        );
      }
      try {
        buffer = await ctx.decodeAudioData(arrayBuf);
      } catch (err) {
        throw new Error(
          `AudioEngine.playOneShot: decodeAudioData failed for ${url}: ${(err as Error).message}`,
        );
      }
      this.oneShotBufferCache.set(url, buffer);
    }

    return new Promise<void>((resolve) => {
      if (!this.ctx) {
        resolve();
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buffer!;
      const g = this.ctx.createGain();
      g.gain.value = Math.max(0, volume);
      // Route through oneShotBus (mute-aware) instead of ctx.destination.
      // Fall back to destination if bus hasn't been built (defensive).
      const sink = this.oneShotBus ?? this.ctx.destination;
      src.connect(g).connect(sink);
      const settle = () => {
        try {
          src.disconnect();
          g.disconnect();
        } catch {
          // already disconnected
        }
        resolve();
      };
      src.onended = settle;
      try {
        src.start();
      } catch {
        // start failed — resolve to avoid dangling promise
        settle();
      }
    });
  }

  // ------------------------------------------------------------------
  // Mute / state introspection
  // ------------------------------------------------------------------

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    if (this.muted === muted) return;
    this.muted = muted;
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
      } catch {
        // localStorage unavailable — ignore.
      }
    }
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const g = this.masterGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    // If ducked, ramp to DUCK_GAIN on unmute; otherwise _targetGain.
    const isCurrentlyDucked =
      this.duckEndsAt !== null && this.duckEndsAt > now;
    const restoreTarget = muted
      ? 0
      : (isCurrentlyDucked ? DUCK_GAIN : this._targetGain);
    g.linearRampToValueAtTime(restoreTarget, now + MUTE_RAMP_SEC);
    // Also mute the one-shot bus (narrator + stingers route through this).
    if (this.oneShotBus) {
      const og = this.oneShotBus.gain;
      og.cancelScheduledValues(now);
      og.setValueAtTime(og.value, now);
      og.linearRampToValueAtTime(muted ? 0 : 1, now + MUTE_RAMP_SEC);
    }
  }

  /**
   * Expose the one-shot bus so external SFX (stingers.ts) can route through
   * it instead of ctx.destination — keeping them mute-aware. Returns null
   * before unlock() has built the audio graph.
   */
  getOneShotBus(): GainNode | null {
    return this.oneShotBus;
  }

  isMuted(): boolean {
    return this.muted;
  }

  getContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * Sets the steady-state ambient gain target. Caller controls the
   * post-intro level (e.g., the contract calls for 0.5 after fade-out).
   * Ramp is applied unless the bus is currently ducked, in which case
   * `_targetGain` is updated and the duck-restore timer will ramp to it.
   */
  setAmbientGainTarget(target: number, rampSec: number = 1.0): void {
    if (this.disposed) return;
    const clamped = Math.max(0, target);
    this._targetGain = clamped;
    if (!this.ctx || !this.masterGain) return;
    if (this.muted) return;
    const now = this.ctx.currentTime;
    const isCurrentlyDucked =
      this.duckEndsAt !== null && this.duckEndsAt > now;
    if (isCurrentlyDucked) {
      // Duck-restore will pick up the new _targetGain when it fires.
      return;
    }
    const g = this.masterGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(clamped, now + Math.max(0.01, rampSec));
  }

  /**
   * Stops every voice, disconnects nodes, closes the AudioContext.
   * Idempotent (React Strict Mode safe).
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }

    for (const id of this.timers) {
      clearTimeout(id);
    }
    this.timers.clear();
    this.duckRestoreTimer = null;
    this.duckEndsAt = null;

    if (this.currentChain) {
      this.teardownChain(this.currentChain);
      this.currentChain = null;
    }

    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // already disconnected
      }
      this.masterGain = null;
    }
    if (this.oneShotBus) {
      try {
        this.oneShotBus.disconnect();
      } catch {
        // already disconnected
      }
      this.oneShotBus = null;
    }

    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        // already closed
      }
      this.ctx = null;
    }

    this.oneShotBufferCache.clear();
    // IR cache + override cache are kept-by-reference to buffers owned by
    // the now-closed context. Clearing references lets GC reclaim.
    this.irCache.clear();
    this.ambientOverrideCache.clear();
  }

  // ------------------------------------------------------------------
  // Internals: drone chain construction
  // ------------------------------------------------------------------

  private async buildChain(mood: Mood): Promise<DroneChain> {
    if (!this.ctx) throw new Error('AudioEngine.buildChain: no context');
    const ctx = this.ctx;
    const preset = MOOD_PRESETS[mood];

    // Per-chain gain node — sits between the drone bus and masterGain.
    const chainGain = ctx.createGain();
    chainGain.gain.value = 1;

    // Filter → Convolver → chainGain
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = preset.cutoff;
    filter.Q.value = 4;

    const convolver = ctx.createConvolver();
    convolver.buffer = await this.getOrBuildImpulse(mood, preset.irTilt);

    filter.connect(convolver);
    convolver.connect(chainGain);

    // Try the MP3 override path first; fall through to oscillator synthesis.
    const override = await this.tryLoadAmbientOverride(mood);
    if (override) {
      const bufferSource = ctx.createBufferSource();
      bufferSource.buffer = override;
      bufferSource.loop = true;
      bufferSource.connect(filter);
      try {
        bufferSource.start();
      } catch {
        // start() already called — should never happen on a fresh node.
      }
      // No oscillators or LFOs in the override path; we still expose empty
      // arrays for uniform teardown.
      return {
        oscillators: [],
        lfos: [],
        filter,
        convolver,
        chainGain,
        bufferSource,
      };
    }

    // -------- Procedural synthesis path --------
    const oscillators: OscillatorNode[] = [];
    const lfos: OscillatorNode[] = [];

    const root = preset.root;

    // Voice spec: each entry is [freq, type, gain].
    type Voice = { freq: number; type: OscillatorType; gain: number };
    const voices: Voice[] = [
      { freq: root, type: 'sine', gain: 0.18 },
      { freq: root * 1.5, type: 'sine', gain: 0.12 }, // fifth
      { freq: root * 2, type: 'sine', gain: 0.10 },   // octave
      // Detuned chorus pair on root, ± cents.
      {
        freq: root * Math.pow(2, preset.chorusDetuneCents / 1200),
        type: 'triangle',
        gain: 0.08,
      },
      {
        freq: root * Math.pow(2, -preset.chorusDetuneCents / 1200),
        type: 'triangle',
        gain: 0.08,
      },
    ];
    if (preset.includeThird) {
      // Major third — 1.2599 ≈ 2^(4/12).
      voices.push({ freq: root * Math.pow(2, 4 / 12), type: 'sine', gain: 0.07 });
    }
    // Optional 7th voice on the darker moods adds sub-octave weight.
    if (!preset.includeThird) {
      voices.push({ freq: root * 0.5, type: 'sine', gain: 0.06 });
    }

    for (const v of voices) {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.frequency.value = v.freq;
      const vg = ctx.createGain();
      vg.gain.value = v.gain;
      osc.connect(vg).connect(filter);
      try {
        osc.start();
      } catch {
        // already started — defensive
      }
      oscillators.push(osc);
    }

    // LFO 1: slow modulation of filter.frequency (depth ~200 Hz).
    const filterLfo = ctx.createOscillator();
    filterLfo.type = 'sine';
    filterLfo.frequency.value = preset.filterLfoHz;
    const filterLfoDepth = ctx.createGain();
    filterLfoDepth.gain.value = preset.filterLfoDepth;
    filterLfo.connect(filterLfoDepth).connect(filter.frequency);
    try {
      filterLfo.start();
    } catch {
      /* defensive */
    }
    lfos.push(filterLfo);

    // LFO 2: tremolo on chainGain (depth 0.05-0.10).
    const tremoloLfo = ctx.createOscillator();
    tremoloLfo.type = 'sine';
    tremoloLfo.frequency.value = preset.tremoloLfoHz;
    const tremoloDepth = ctx.createGain();
    tremoloDepth.gain.value = preset.tremoloLfoDepth;
    tremoloLfo.connect(tremoloDepth).connect(chainGain.gain);
    try {
      tremoloLfo.start();
    } catch {
      /* defensive */
    }
    lfos.push(tremoloLfo);

    return {
      oscillators,
      lfos,
      filter,
      convolver,
      chainGain,
      bufferSource: null,
    };
  }

  private teardownChain(chain: DroneChain): void {
    const stopNode = (n: OscillatorNode | AudioBufferSourceNode | null) => {
      if (!n) return;
      try {
        n.stop();
      } catch {
        // not started or already stopped
      }
      try {
        n.disconnect();
      } catch {
        // already disconnected
      }
    };
    for (const o of chain.oscillators) stopNode(o);
    for (const l of chain.lfos) stopNode(l);
    stopNode(chain.bufferSource);
    try {
      chain.filter.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      chain.convolver.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      chain.chainGain.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  /**
   * Generates (or returns cached) a 4-second mood-coloured impulse response
   * for the convolver. Tilt < 0 biases low frequencies (dark); > 0 biases
   * high (bright). Uses OfflineAudioContext for synthesis.
   */
  private async getOrBuildImpulse(mood: Mood, tilt: number): Promise<AudioBuffer> {
    const cached = this.irCache.get(mood);
    if (cached) return cached;
    if (!this.ctx) throw new Error('AudioEngine.getOrBuildImpulse: no context');

    const sampleRate = this.ctx.sampleRate;
    const lengthSec = 4;
    const length = Math.floor(sampleRate * lengthSec);

    // OfflineAudioContext for deterministic IR rendering.
    let offline: OfflineAudioContext;
    try {
      offline = new OfflineAudioContext(2, length, sampleRate);
    } catch {
      // Fallback: synthesise the IR directly into a buffer.
      return this.buildImpulseDirect(mood, tilt, sampleRate, length);
    }

    // Build a noise buffer with an exponential decay envelope.
    const noiseBuffer = offline.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = noiseBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        // Decay: exponential, faster for high-tilt (brighter, shorter).
        const decayPower = 2 + tilt; // 1 (dark, long) … 3 (bright, short)
        const env = Math.pow(1 - t, Math.max(0.5, decayPower));
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    const noiseSrc = offline.createBufferSource();
    noiseSrc.buffer = noiseBuffer;

    // Tilt filter: a biquad applied to the noise to colour the spectrum.
    // tilt < 0 → lowpass; tilt > 0 → highpass; tilt ≈ 0 → bandpass-ish.
    const colourFilter = offline.createBiquadFilter();
    if (tilt < -0.2) {
      colourFilter.type = 'lowpass';
      colourFilter.frequency.value = 600 + tilt * 400; // darker = lower
      colourFilter.Q.value = 0.7;
    } else if (tilt > 0.2) {
      colourFilter.type = 'highpass';
      colourFilter.frequency.value = 200 + tilt * 800; // brighter = higher
      colourFilter.Q.value = 0.7;
    } else {
      colourFilter.type = 'bandpass';
      colourFilter.frequency.value = 800;
      colourFilter.Q.value = 0.7;
    }

    noiseSrc.connect(colourFilter).connect(offline.destination);
    noiseSrc.start();

    let rendered: AudioBuffer;
    try {
      rendered = await offline.startRendering();
    } catch {
      return this.buildImpulseDirect(mood, tilt, sampleRate, length);
    }

    this.irCache.set(mood, rendered);
    return rendered;
  }

  /**
   * Pure-CPU fallback IR synthesis if OfflineAudioContext is unavailable.
   * Generates a simple decaying-noise buffer in the LIVE context.
   */
  private buildImpulseDirect(
    mood: Mood,
    tilt: number,
    sampleRate: number,
    length: number,
  ): AudioBuffer {
    if (!this.ctx) throw new Error('AudioEngine.buildImpulseDirect: no context');
    const buf = this.ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      // Simple one-pole filter to colour the noise without OfflineAudioContext.
      // tilt < 0 → low-bias (lowpass-ish); tilt > 0 → high-bias.
      const alpha = tilt < 0 ? 0.85 : 0.2; // smoothing
      let prev = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, 2 + tilt);
        const white = (Math.random() * 2 - 1) * env;
        const filtered = alpha * prev + (1 - alpha) * white;
        prev = filtered;
        // For "bright" tilt (>0) take the residual (high-pass-ish).
        data[i] = tilt > 0 ? white - filtered : filtered;
      }
    }
    this.irCache.set(mood, buf);
    return buf;
  }

  /**
   * Attempts to fetch `/audio/ambient-<mood>.mp3`. Returns the decoded
   * AudioBuffer on HTTP 200, or null if the override is unavailable.
   * Result is cached per mood (including the miss).
   */
  private async tryLoadAmbientOverride(mood: Mood): Promise<AudioBuffer | null> {
    if (this.ambientOverrideCache.has(mood)) {
      return this.ambientOverrideCache.get(mood) ?? null;
    }
    if (!this.ctx) return null;
    const url = `/audio/ambient-${mood}.mp3`;
    try {
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        this.ambientOverrideCache.set(mood, null);
        return null;
      }
      const arr = await res.arrayBuffer();
      const decoded = await this.ctx.decodeAudioData(arr);
      this.ambientOverrideCache.set(mood, decoded);
      return decoded;
    } catch {
      this.ambientOverrideCache.set(mood, null);
      return null;
    }
  }
}
