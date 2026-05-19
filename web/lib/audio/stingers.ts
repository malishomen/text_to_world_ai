// web/lib/audio/stingers.ts
// Procedural one-shot SFX for win, lose, and world-open events.
//
// Each stinger is a short Web Audio burst routed through its OWN GainNode
// directly to audioCtx.destination — NOT through the AudioEngine's master
// gain, so the stinger is unaffected by ambient ducking. Each stinger calls
// engine.duck(durationSec) at start to lower the ambient bed while it plays.
//
// AudioEngine contract consumed:
//   engine.getContext(): AudioContext | null
//   engine.duck(durationSec: number): void
//
// If getContext() returns null (unlock() not called yet), every play*()
// resolves immediately as a no-op.

import type { AudioEngine } from '@/lib/audio/AudioEngine';

export interface StingerEngine {
  playWorldOpen(): Promise<void>;
  playWin(): Promise<void>;
  playLose(): Promise<void>;
  /** Short rising-pitch whoosh fired the instant the player presses Space. */
  playJump(): Promise<void>;
  /** Low thud fired the moment the player's collider re-touches ground after
   *  airborne flight. Suppressed if the airborne duration was < 80 ms (bounce
   *  jitter on platform edges). */
  playLand(): Promise<void>;
  /** Quiet click fired on each footstep cadence tick. Caller is responsible
   *  for spacing these (e.g. every ~350 ms while moving on ground). */
  playStep(): Promise<void>;
  dispose(): void;
}

interface StingerState {
  activeOscillators: OscillatorNode[];
  activeTimers: number[];
  disposed: boolean;
}

/** Safely stop an oscillator; Web Audio throws if stop() is called twice
 *  or on a node that was never started. Treat both as no-ops. */
function safeStop(node: OscillatorNode | AudioBufferSourceNode): void {
  try {
    node.stop();
  } catch {
    /* already stopped or never started — fine */
  }
}

/** Schedule a resolve at t+durationMs and bookkeep so dispose() can clean up.
 *  Also removes the supplied oscillator set from `activeOscillators` so a
 *  later dispose() does not call stop() on already-stopped nodes. */
function scheduleResolve(
  state: StingerState,
  durationMs: number,
  oscillators: OscillatorNode[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      // Remove this stinger's nodes from the active list — their .stop(t)
      // has already fired by now, so further stop() calls would throw.
      for (const osc of oscillators) {
        const i = state.activeOscillators.indexOf(osc);
        if (i !== -1) state.activeOscillators.splice(i, 1);
      }
      const ti = state.activeTimers.indexOf(timer);
      if (ti !== -1) state.activeTimers.splice(ti, 1);
      resolve();
    }, durationMs);
    state.activeTimers.push(timer);
  });
}

/** Build a 1.5-second decaying white-noise impulse response used by
 *  playLose's ConvolverNode. The IR is one-shot for that stinger and is
 *  disconnected when the stinger ends. */
function buildLoseImpulseResponse(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * 1.5);
  // 2-channel stereo IR keeps the reverb tail wide.
  const buffer = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Exponential decay over the IR length (tau ~0.35).
      const env = Math.pow(1 - t, 2.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buffer;
}

/** Build a 50 ms white-noise buffer for the playWin texture hit. */
function buildWhiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sr * durationSec));
  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export function createStingers(engine: AudioEngine): StingerEngine {
  const state: StingerState = {
    activeOscillators: [],
    activeTimers: [],
    disposed: false,
  };

  /** Snapshot the live AudioContext or null. Resolving play*() as a no-op
   *  when null matches the contract. */
  function ctxOrNull(): AudioContext | null {
    if (state.disposed) return null;
    return engine.getContext();
  }

  /** Mute-aware sink. Routes stingers through the engine's one-shot bus so
   *  the mute toggle silences them. Falls back to destination if bus null. */
  function sink(ctx: AudioContext): AudioNode {
    return engine.getOneShotBus() ?? ctx.destination;
  }

  // -------------------------------------------------------------------------
  // playWorldOpen — 1.5 s rising triad
  // -------------------------------------------------------------------------
  async function playWorldOpen(): Promise<void> {
    const ctx = ctxOrNull();
    if (!ctx) return;

    engine.duck(1.5);

    const t0 = ctx.currentTime;
    const tEnd = t0 + 1.5;

    // Master gain for this stinger; routed straight to destination.
    const master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(sink(ctx));

    // Three rising sine voices.
    type Voice = { startOffset: number; from: number; to: number };
    const voices: Voice[] = [
      { startOffset: 0.0, from: 220, to: 440 },
      { startOffset: 0.2, from: 330, to: 660 },
      { startOffset: 0.4, from: 440, to: 880 },
    ];

    const oscillators: OscillatorNode[] = [];

    for (const v of voices) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const startT = t0 + v.startOffset;
      osc.frequency.setValueAtTime(v.from, startT);
      // exponentialRampToValueAtTime — both endpoints are > 0, which is
      // required by the Web Audio spec.
      osc.frequency.exponentialRampToValueAtTime(v.to, t0 + 1.4);

      const env = ctx.createGain();
      // Envelope: 0 → 0.3 over 100 ms, hold to 1.2 s, ramp down to 0.001 by 1.5 s.
      env.gain.setValueAtTime(0.0001, startT);
      env.gain.linearRampToValueAtTime(0.3, startT + 0.1);
      env.gain.setValueAtTime(0.3, t0 + 1.2);
      env.gain.exponentialRampToValueAtTime(0.001, tEnd);

      osc.connect(env).connect(master);
      osc.start(startT);
      osc.stop(tEnd);

      oscillators.push(osc);
      state.activeOscillators.push(osc);
    }

    // Tear down the master gain once the stinger has finished decaying.
    // Use a timer rather than onended (which fires per-oscillator) to keep
    // the disconnect deterministic.
    const teardown = window.setTimeout(() => {
      try { master.disconnect(); } catch { /* noop */ }
      const ti = state.activeTimers.indexOf(teardown);
      if (ti !== -1) state.activeTimers.splice(ti, 1);
    }, 1600);
    state.activeTimers.push(teardown);

    await scheduleResolve(state, 1500, oscillators);
  }

  // -------------------------------------------------------------------------
  // playWin — 3 s major-9 chord with noise hit
  // -------------------------------------------------------------------------
  async function playWin(): Promise<void> {
    const ctx = ctxOrNull();
    if (!ctx) return;

    engine.duck(3.0);

    const t0 = ctx.currentTime;
    const tEnd = t0 + 3.0;

    const master = ctx.createGain();
    // Envelope: 0 → 0.7 over 50 ms, decay exponentially to 0.001 by 2.95 s.
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.linearRampToValueAtTime(0.7, t0 + 0.05);
    master.gain.exponentialRampToValueAtTime(0.001, t0 + 2.95);
    master.connect(sink(ctx));

    // Major-9 voicing.
    const root = 440;
    type ChordVoice = {
      type: OscillatorType;
      freq: number;
      gain: number;
    };
    const chord: ChordVoice[] = [
      { type: 'sine', freq: root,              gain: 0.25 }, // root  440
      { type: 'sine', freq: root * (5 / 4),    gain: 0.22 }, // third 550
      { type: 'sine', freq: root * (3 / 2),    gain: 0.22 }, // fifth 660
      { type: 'sine', freq: root * (9 / 4),    gain: 0.12 }, // ninth 990 (softer)
      { type: 'triangle', freq: root * 2,      gain: 0.15 }, // octave-up triangle
    ];

    const oscillators: OscillatorNode[] = [];

    for (const v of chord) {
      const osc = ctx.createOscillator();
      osc.type = v.type;
      osc.frequency.setValueAtTime(v.freq, t0);

      const voiceGain = ctx.createGain();
      voiceGain.gain.value = v.gain;

      osc.connect(voiceGain).connect(master);
      osc.start(t0);
      osc.stop(tEnd);

      oscillators.push(osc);
      state.activeOscillators.push(osc);
    }

    // Brief 50 ms white-noise hit through a 4 kHz lowpass for texture.
    const noiseBuf = buildWhiteNoiseBuffer(ctx, 0.05);
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 4000;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.15;

    noise.connect(noiseFilter).connect(noiseGain).connect(master);
    noise.start(t0);
    // AudioBufferSourceNode auto-stops at end of buffer; we don't track it
    // in activeOscillators (it's not an OscillatorNode), and it cannot be
    // re-stopped after it completes. We still defensively stop it on dispose
    // by tracking it via a one-shot handle below.
    const noiseStopper = (): void => {
      try { noise.stop(); } catch { /* already stopped */ }
    };
    // Run noiseStopper at ~60 ms — buffer is already done, so it's a no-op
    // in the happy path and a safety net if dispose() comes mid-flight.
    const noiseTimer = window.setTimeout(() => {
      noiseStopper();
      const ti = state.activeTimers.indexOf(noiseTimer);
      if (ti !== -1) state.activeTimers.splice(ti, 1);
    }, 80);
    state.activeTimers.push(noiseTimer);

    const teardown = window.setTimeout(() => {
      try { master.disconnect(); } catch { /* noop */ }
      const ti = state.activeTimers.indexOf(teardown);
      if (ti !== -1) state.activeTimers.splice(ti, 1);
    }, 3100);
    state.activeTimers.push(teardown);

    await scheduleResolve(state, 3000, oscillators);
  }

  // -------------------------------------------------------------------------
  // playLose — 2 s tritone + sub-bass + convolver tail
  // -------------------------------------------------------------------------
  async function playLose(): Promise<void> {
    const ctx = ctxOrNull();
    if (!ctx) return;

    engine.duck(2.0);

    const t0 = ctx.currentTime;
    const tEnd = t0 + 2.0;

    const master = ctx.createGain();
    // Envelope: 0 → 0.6 over 300 ms, hold to 1.2 s, exp ramp to 0.001 by 2.0 s.
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.linearRampToValueAtTime(0.6, t0 + 0.3);
    master.gain.setValueAtTime(0.6, t0 + 1.2);
    master.gain.exponentialRampToValueAtTime(0.001, tEnd);

    // Convolver with an inline decaying-noise IR adds a long dread tail.
    const convolver = ctx.createConvolver();
    const ir = buildLoseImpulseResponse(ctx);
    convolver.buffer = ir;

    // Dry + wet mix: drive ~70 % dry to destination and ~50 % through
    // convolver. Both rails terminate at ctx.destination directly so the
    // stinger remains immune to ambient ducking.
    const dryGain = ctx.createGain();
    dryGain.gain.value = 0.7;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.5;

    master.connect(dryGain).connect(sink(ctx));
    master.connect(convolver).connect(wetGain).connect(sink(ctx));

    const oscillators: OscillatorNode[] = [];

    // V1: 165 Hz sine, linear ramp down to 110 Hz over 1.8 s.
    const v1 = ctx.createOscillator();
    v1.type = 'sine';
    v1.frequency.setValueAtTime(165, t0);
    v1.frequency.linearRampToValueAtTime(110, t0 + 1.8);
    const v1Gain = ctx.createGain();
    v1Gain.gain.value = 0.5;
    v1.connect(v1Gain).connect(master);
    v1.start(t0);
    v1.stop(tEnd);
    oscillators.push(v1);
    state.activeOscillators.push(v1);

    // V2: 233 Hz sine, linear ramp down to 155 Hz over 1.8 s (tritone).
    const v2 = ctx.createOscillator();
    v2.type = 'sine';
    v2.frequency.setValueAtTime(233, t0);
    v2.frequency.linearRampToValueAtTime(155, t0 + 1.8);
    const v2Gain = ctx.createGain();
    v2Gain.gain.value = 0.45;
    v2.connect(v2Gain).connect(master);
    v2.start(t0);
    v2.stop(tEnd);
    oscillators.push(v2);
    state.activeOscillators.push(v2);

    // V3: 55 Hz triangle sub-bass at steady 0.15.
    const v3 = ctx.createOscillator();
    v3.type = 'triangle';
    v3.frequency.setValueAtTime(55, t0);
    const v3Gain = ctx.createGain();
    v3Gain.gain.value = 0.15;
    v3.connect(v3Gain).connect(master);
    v3.start(t0);
    v3.stop(tEnd);
    oscillators.push(v3);
    state.activeOscillators.push(v3);

    // Dispose the per-stinger IR / convolver / mix nodes once the reverb
    // tail has run out (~1.5 s after the dry stop = ~3.5 s total).
    const teardown = window.setTimeout(() => {
      try { master.disconnect(); } catch { /* noop */ }
      try { convolver.disconnect(); } catch { /* noop */ }
      try { dryGain.disconnect(); } catch { /* noop */ }
      try { wetGain.disconnect(); } catch { /* noop */ }
      // convolver.buffer is GC'd with the convolver — no explicit free.
      const ti = state.activeTimers.indexOf(teardown);
      if (ti !== -1) state.activeTimers.splice(ti, 1);
    }, 3600);
    state.activeTimers.push(teardown);

    await scheduleResolve(state, 2000, oscillators);
  }

  // -------------------------------------------------------------------------
  // playJump — short rising whoosh, ~120 ms. Triangle osc 280 → 640 Hz with
  // a fast attack + exponential decay. Subtle, plays often, must not annoy.
  // -------------------------------------------------------------------------
  async function playJump(): Promise<void> {
    const ctx = ctxOrNull();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(sink(ctx));

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(280, t0);
    osc.frequency.exponentialRampToValueAtTime(640, t0 + 0.10);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.65, t0 + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);

    osc.connect(env).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.16);
    state.activeOscillators.push(osc);

    // Cheap and frequent — do NOT duck the ambient on jumps.
    const teardown = window.setTimeout(() => {
      try { master.disconnect(); } catch { /* noop */ }
      const i = state.activeTimers.indexOf(teardown);
      if (i !== -1) state.activeTimers.splice(i, 1);
    }, 250);
    state.activeTimers.push(teardown);

    await scheduleResolve(state, 160, [osc]);
  }

  // -------------------------------------------------------------------------
  // playLand — low thud, ~90 ms. Filtered noise burst + 80 Hz sine click.
  // No ducking; called once per landing.
  // -------------------------------------------------------------------------
  async function playLand(): Promise<void> {
    const ctx = ctxOrNull();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(sink(ctx));

    // Sub-thud sine click
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(80, t0);
    sub.frequency.exponentialRampToValueAtTime(45, t0 + 0.09);
    const subEnv = ctx.createGain();
    subEnv.gain.setValueAtTime(0, t0);
    subEnv.gain.linearRampToValueAtTime(0.7, t0 + 0.01);
    subEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.10);
    sub.connect(subEnv).connect(master);
    sub.start(t0);
    sub.stop(t0 + 0.12);
    state.activeOscillators.push(sub);

    // Short filtered noise for texture
    const noiseBuf = buildWhiteNoiseBuffer(ctx, 0.06);
    const noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(800, t0);
    const noiseEnv = ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.35, t0);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    noiseSrc.connect(lp).connect(noiseEnv).connect(master);
    noiseSrc.start(t0);

    const teardown = window.setTimeout(() => {
      try { master.disconnect(); } catch { /* noop */ }
      const i = state.activeTimers.indexOf(teardown);
      if (i !== -1) state.activeTimers.splice(i, 1);
    }, 250);
    state.activeTimers.push(teardown);

    await scheduleResolve(state, 120, [sub]);
  }

  // -------------------------------------------------------------------------
  // playStep — very quiet footstep click, ~40 ms. Pitch + filter slightly
  // randomised so successive steps don't sound copy-pasted. Master gain
  // 0.18 because this fires every ~350 ms while moving.
  // -------------------------------------------------------------------------
  async function playStep(): Promise<void> {
    const ctx = ctxOrNull();
    if (!ctx) return;

    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(sink(ctx));

    // Per-step variation: pitch ±15%, filter cutoff ±400 Hz.
    const basePitch = 180 + (Math.random() - 0.5) * 50;
    const filterCutoff = 1600 + (Math.random() - 0.5) * 800;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(basePitch, t0);
    osc.frequency.exponentialRampToValueAtTime(basePitch * 0.6, t0 + 0.04);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.5, t0 + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(filterCutoff, t0);

    osc.connect(env).connect(lp).connect(master);
    osc.start(t0);
    osc.stop(t0 + 0.06);
    state.activeOscillators.push(osc);

    const teardown = window.setTimeout(() => {
      try { master.disconnect(); } catch { /* noop */ }
      const i = state.activeTimers.indexOf(teardown);
      if (i !== -1) state.activeTimers.splice(i, 1);
    }, 100);
    state.activeTimers.push(teardown);

    await scheduleResolve(state, 60, [osc]);
  }

  // -------------------------------------------------------------------------
  // dispose — stop everything; safe to call twice.
  // -------------------------------------------------------------------------
  function dispose(): void {
    state.disposed = true;
    for (const osc of state.activeOscillators) {
      safeStop(osc);
    }
    state.activeOscillators.length = 0;
    for (const timer of state.activeTimers) {
      clearTimeout(timer);
    }
    state.activeTimers.length = 0;
  }

  return {
    playWorldOpen,
    playWin,
    playLose,
    playJump,
    playLand,
    playStep,
    dispose,
  };
}
