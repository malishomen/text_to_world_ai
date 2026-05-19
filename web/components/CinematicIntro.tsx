'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { AudioEngine } from '@/lib/audio/AudioEngine';

// ─── Mood coercion ──────────────────────────────────────────────────────────
// The 8-mood enum is the single source of truth (contract sheet). The prop
// type is `string` so an upstream LLM/preset error can never crash this
// component — we coerce defensively and fall back to `surreal_calm`.
const MOODS = [
  'surreal_calm',
  'dark_fantasy',
  'cozy_dream',
  'nightmare',
  'cyber_dream',
  'ethereal',
  'whimsical',
  'cosmic',
] as const;
type Mood = (typeof MOODS)[number];

function coerceMood(value: string): Mood {
  return (MOODS as readonly string[]).includes(value)
    ? (value as Mood)
    : 'surreal_calm';
}

// Mood → speech-synthesis profile. Per the audit M-1 fix this collapses to
// 3 buckets (dark / bright / neutral), NOT a per-mood 8-way switch.
interface SpeechProfile { rate: number; pitch: number }
function speechProfileFor(mood: Mood): SpeechProfile {
  if (mood === 'nightmare' || mood === 'dark_fantasy') {
    return { rate: 0.85, pitch: 0.7 };
  }
  if (mood === 'cozy_dream' || mood === 'whimsical' || mood === 'ethereal') {
    return { rate: 1.05, pitch: 1.15 };
  }
  return { rate: 0.95, pitch: 1.0 };
}

function pickEnglishFemaleVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const femaleHints = ['female', 'rachel', 'samantha', 'bella'];
  const enUsFemale = voices.find(
    (v) =>
      v.lang?.toLowerCase().startsWith('en-us') &&
      femaleHints.some((h) => v.name.toLowerCase().includes(h)),
  );
  if (enUsFemale) return enUsFemale;
  const anyEn = voices.find((v) => v.lang?.toLowerCase().startsWith('en'));
  if (anyEn) return anyEn;
  return voices[0] ?? null;
}

export interface CinematicIntroProps {
  narrative: string;
  /** string, not Mood — coerced defensively against the 8-mood enum */
  mood: string;
  generationId: string;
  onComplete: () => void;
  onEngineReady: (engine: AudioEngine) => void;
}

interface NarrationResponse {
  audio_url: string | null;
  source?: string;
  durationSec?: number | null;
}

export default function CinematicIntro(
  props: CinematicIntroProps,
): JSX.Element {
  const { narrative, mood, generationId, onComplete, onEngineReady } = props;

  // ─── Refs (survive renders, never trigger them) ───────────────────────────
  const startedRef = useRef(false);            // strict-mode double-mount guard
  const engineRef = useRef<AudioEngine | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioDoneRef = useRef(false);
  const typewriterDoneRef = useRef(false);
  const completedRef = useRef(false);          // onComplete fires exactly once
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const currentWordIdxRef = useRef(0);
  const typewriterCancelRef = useRef(false);
  const fastForwardRef = useRef(false);
  const pointerUnlockHandlerRef = useRef<((ev: Event) => void) | null>(null);
  const voicesChangedHandlerRef = useRef<(() => void) | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // ─── Render state ─────────────────────────────────────────────────────────
  const [displayed, setDisplayed] = useState('');
  const [fadingOut, setFadingOut] = useState(false);

  // Helpers ------------------------------------------------------------------
  const setManagedTimeout = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timersRef.current.delete(id);
      fn();
    }, ms);
    timersRef.current.add(id);
    return id;
  };

  const clearAllTimers = () => {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current.clear();
  };

  useEffect(() => {
    if (startedRef.current) return;            // strict-mode 2nd mount → skip
    startedRef.current = true;

    const coercedMood = coerceMood(mood);
    const words = narrative.split(/\s+/).filter(Boolean);

    // 1. Construct AudioEngine inside the effect so strict-mode dev double-
    //    mount doesn't construct a phantom engine. Hand it to the parent
    //    immediately — parent owns the lifetime, NOT this component.
    let engine: AudioEngine;
    try {
      const initialMuted =
        typeof window !== 'undefined' &&
        window.localStorage?.getItem('audioMuted') === '1';
      engine = new AudioEngine({ mood: coercedMood, muted: initialMuted });
    } catch {
      // Engine construction failed — degrade silently. Schedule completion
      // so the user is not stuck on a black screen forever.
      setManagedTimeout(() => {
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete();
        }
      }, 4000);
      return;
    }
    engineRef.current = engine;
    onEngineReady(engine);

    // 2. Unlock + ambient. Try eagerly, retry on first user gesture if
    //    suspended, hard-timeout safety net at 2 s.
    let ambientStarted = false;
    const tryStartAmbient = async () => {
      if (ambientStarted) return;
      ambientStarted = true;
      try {
        await engine.startAmbient();
      } catch {
        ambientStarted = false; // allow retry from pointer handler
      }
    };

    const attemptUnlock = async () => {
      try {
        const state = await engine.unlock();
        if (state === 'running') {
          await tryStartAmbient();
        } else if (state === 'suspended') {
          // Wait for the next user gesture, then retry.
          if (!pointerUnlockHandlerRef.current) {
            const handler = () => {
              if (pointerUnlockHandlerRef.current) {
                document.removeEventListener(
                  'pointerdown',
                  pointerUnlockHandlerRef.current,
                );
                pointerUnlockHandlerRef.current = null;
              }
              void (async () => {
                try {
                  await engine.unlock();
                } catch {
                  /* swallow */
                }
                await tryStartAmbient();
              })();
            };
            pointerUnlockHandlerRef.current = handler;
            document.addEventListener('pointerdown', handler, { once: true });
          }
        }
      } catch {
        /* swallow — fallback timer covers */
      }
    };
    void attemptUnlock();

    // Hard timeout — after 2 s try unlock + ambient anyway regardless of
    // initial state. Useful when the page was opened via a router push
    // where the AudioContext is sometimes still 'suspended' on Safari.
    setManagedTimeout(() => {
      void (async () => {
        try {
          await engine.unlock();
        } catch {
          /* swallow */
        }
        await tryStartAmbient();
      })();
    }, 2000);

    // 3. Narration fetch + 4. Typewriter scheduling -------------------------

    /** Fast-forward the typewriter to completion across 200 ms total. */
    const fastForwardTypewriter = () => {
      if (typewriterDoneRef.current || typewriterCancelRef.current) return;
      fastForwardRef.current = true;
      const remaining = words.length - currentWordIdxRef.current;
      if (remaining <= 0) {
        typewriterDoneRef.current = true;
        maybeStartCloseSequence();
        return;
      }
      const stepMs = Math.max(8, Math.floor(200 / remaining));
      const tick = () => {
        if (typewriterCancelRef.current) return;
        if (currentWordIdxRef.current >= words.length) {
          typewriterDoneRef.current = true;
          maybeStartCloseSequence();
          return;
        }
        currentWordIdxRef.current += 1;
        setDisplayed(words.slice(0, currentWordIdxRef.current).join(' '));
        setManagedTimeout(tick, stepMs);
      };
      tick();
    };

    /** Initial typewriter pacing: 220 ms / word until audio completes. */
    const startTypewriter = () => {
      if (typewriterCancelRef.current || typewriterDoneRef.current) return;
      const step = () => {
        if (typewriterCancelRef.current) return;
        if (fastForwardRef.current) return;     // takeover happened
        if (currentWordIdxRef.current >= words.length) {
          typewriterDoneRef.current = true;
          maybeStartCloseSequence();
          return;
        }
        currentWordIdxRef.current += 1;
        setDisplayed(words.slice(0, currentWordIdxRef.current).join(' '));
        if (currentWordIdxRef.current < words.length) {
          setManagedTimeout(step, 220);
        } else {
          typewriterDoneRef.current = true;
          maybeStartCloseSequence();
        }
      };
      step();
    };

    /** Triggered when audio finishes; fast-forwards if typewriter behind. */
    const markAudioDone = () => {
      if (audioDoneRef.current) return;
      audioDoneRef.current = true;
      if (!typewriterDoneRef.current) {
        fastForwardTypewriter();
      } else {
        maybeStartCloseSequence();
      }
    };

    /** Both audio and typewriter complete → 1 s wait → stinger + fade. */
    const maybeStartCloseSequence = () => {
      if (!audioDoneRef.current || !typewriterDoneRef.current) return;
      if (completedRef.current) return;
      // Idempotent — checked via fadingOut flag too.
      setManagedTimeout(() => {
        void runCloseSequence();
      }, 1000);
    };

    let closeStarted = false;
    const runCloseSequence = async () => {
      if (closeStarted) return;
      closeStarted = true;

      // 5a. Try the procedural stinger; fall back to intro-pad.mp3; fall
      //     back to silence. Each layer fails silently.
      try {
        const stingersMod: unknown = await import(
          /* webpackIgnore: false */ '@/lib/audio/stingers'
        ).catch(() => null);
        if (
          stingersMod &&
          typeof (stingersMod as { createStingers?: unknown })
            .createStingers === 'function'
        ) {
          const create = (
            stingersMod as {
              createStingers: (e: AudioEngine) => { playWorldOpen: () => Promise<void> };
            }
          ).createStingers;
          const stings = create(engine);
          void stings.playWorldOpen().catch(() => {
            /* swallow */
          });
        } else {
          void engine
            .playOneShot('/audio/intro-pad.mp3', 0.6)
            .catch(() => {
              /* swallow — file may not exist */
            });
        }
      } catch {
        /* swallow — every layer is best-effort */
      }

      // 5b. Visual fade-out + ambient ramp to 0.5 over 1.5 s.
      setFadingOut(true);
      const engineWithMethod = engine as AudioEngine & {
        setAmbientGainTarget?: (value: number, rampSec: number) => void;
      };
      if (typeof engineWithMethod.setAmbientGainTarget === 'function') {
        try {
          engineWithMethod.setAmbientGainTarget(0.5, 1.5);
        } catch {
          /* swallow — method optional in early Agent T builds */
        }
      }

      // 6. Completion — either transitionend OR 1500 ms fallback.
      const onTransitionEnd = (ev: TransitionEvent) => {
        if (ev.propertyName && ev.propertyName !== 'opacity') return;
        overlayRef.current?.removeEventListener(
          'transitionend',
          onTransitionEnd as EventListener,
        );
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete();
        }
      };
      overlayRef.current?.addEventListener(
        'transitionend',
        onTransitionEnd as EventListener,
      );
      setManagedTimeout(() => {
        overlayRef.current?.removeEventListener(
          'transitionend',
          onTransitionEnd as EventListener,
        );
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete();
        }
      }, 1500);
    };

    // ─── Web Speech fallback wiring ───────────────────────────────────────
    const startWebSpeechFallback = (estDurationSec: number) => {
      if (typeof window === 'undefined') {
        setManagedTimeout(markAudioDone, 6000);
        return;
      }
      const synth = window.speechSynthesis as SpeechSynthesis | undefined;
      if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
        setManagedTimeout(markAudioDone, 6000);
        return;
      }

      const speakNow = () => {
        try {
          synth.cancel();
          const utter = new SpeechSynthesisUtterance(narrative);
          const profile = speechProfileFor(coercedMood);
          utter.rate = profile.rate;
          utter.pitch = profile.pitch;
          utter.volume = 0.85;
          const voices = synth.getVoices();
          const chosen = pickEnglishFemaleVoice(voices);
          if (chosen) utter.voice = chosen;
          utter.onend = () => markAudioDone();
          utter.onerror = () => markAudioDone();
          utteranceRef.current = utter;
          engine.duck(estDurationSec + 1);
          synth.speak(utter);
          // Safety net: if neither onend nor onerror fires (some browsers
          // when the tab goes hidden), force resolution after est+4 s.
          setManagedTimeout(markAudioDone, Math.max(6000, (estDurationSec + 4) * 1000));
        } catch {
          setManagedTimeout(markAudioDone, 6000);
        }
      };

      const voicesNow = synth.getVoices();
      if (voicesNow.length === 0 && 'onvoiceschanged' in synth) {
        const handler = () => {
          if (voicesChangedHandlerRef.current) {
            synth.removeEventListener?.(
              'voiceschanged',
              voicesChangedHandlerRef.current as EventListener,
            );
            voicesChangedHandlerRef.current = null;
          }
          speakNow();
        };
        voicesChangedHandlerRef.current = handler;
        try {
          synth.addEventListener?.(
            'voiceschanged',
            handler as EventListener,
            { once: true },
          );
        } catch {
          // Some legacy engines only support the property assignment form.
          synth.onvoiceschanged = handler as (this: SpeechSynthesis, ev: Event) => unknown;
        }
        // Don't wait forever for voices — speak after 600 ms regardless.
        setManagedTimeout(() => {
          if (voicesChangedHandlerRef.current) {
            voicesChangedHandlerRef.current = null;
            speakNow();
          }
        }, 600);
      } else {
        speakNow();
      }
    };

    // ─── Narration fetch ─────────────────────────────────────────────────
    const controller = new AbortController();
    abortRef.current = controller;
    // Hard cap on the fetch — without it, a slow /api/generate-narration
    // would leave the user staring at a silent typewriter. Web Speech
    // fallback kicks in if we hit this timeout.
    setManagedTimeout(() => {
      try { controller.abort(); } catch { /* already aborted */ }
    }, 8000);

    const wordCount = Math.max(1, words.length);
    const estFromWords = Math.max(3, wordCount / 4); // 4 wps heuristic

    const runNarrationFlow = async () => {
      let response: NarrationResponse | null = null;
      try {
        const res = await fetch('/api/generate-narration', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            narrative,
            mood: coercedMood,
            generationId,
          }),
          signal: controller.signal,
        });
        if (res.ok) {
          response = (await res.json()) as NarrationResponse;
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        // network failure → fall through to fallback
      }

      const estDuration =
        response && typeof response.durationSec === 'number' && response.durationSec
          ? Math.max(3, response.durationSec)
          : estFromWords;

      // Schedule both audio and typewriter at T+1.0
      setManagedTimeout(() => {
        if (typewriterCancelRef.current) return;
        startTypewriter();
      }, 1000);

      setManagedTimeout(() => {
        if (controller.signal.aborted) return;

        if (response && response.audio_url) {
          // Real audio path (ElevenLabs / cache)
          try {
            engine.duck(estDuration + 1);
          } catch {
            /* swallow */
          }
          engine
            .playOneShot(response.audio_url, 0.85)
            .then(() => markAudioDone())
            .catch(() => {
              // Audio file failed to load — degrade to Web Speech if we can.
              startWebSpeechFallback(estDuration);
            });
        } else {
          // No audio_url → Web Speech fallback.
          startWebSpeechFallback(estDuration);
        }
      }, 1000);
    };

    void runNarrationFlow();

    // pagehide / beforeunload safety net — speechSynthesis can survive a
    // navigation away from /play (Chrome bug) and keep speaking on the
    // landing. Cancel hard on page exit. Use pagehide (fires for both
    // refresh and back/forward) plus beforeunload as belt-and-braces.
    const cancelSpeechOnPageExit = () => {
      try { window.speechSynthesis?.cancel(); } catch { /* swallow */ }
    };
    window.addEventListener('pagehide', cancelSpeechOnPageExit);
    window.addEventListener('beforeunload', cancelSpeechOnPageExit);

    // ─── Cleanup ─────────────────────────────────────────────────────────
    return () => {
      // Remove page-exit listeners
      window.removeEventListener('pagehide', cancelSpeechOnPageExit);
      window.removeEventListener('beforeunload', cancelSpeechOnPageExit);
      // Cancel typewriter
      typewriterCancelRef.current = true;
      clearAllTimers();
      // Cancel fetch
      try {
        abortRef.current?.abort();
      } catch {
        /* swallow */
      }
      abortRef.current = null;
      // Cancel speech synthesis
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* swallow */
        }
      }
      utteranceRef.current = null;
      // Unregister pointer unlock handler
      if (pointerUnlockHandlerRef.current) {
        try {
          document.removeEventListener(
            'pointerdown',
            pointerUnlockHandlerRef.current,
          );
        } catch {
          /* swallow */
        }
        pointerUnlockHandlerRef.current = null;
      }
      // Unregister voiceschanged handler
      if (
        voicesChangedHandlerRef.current &&
        typeof window !== 'undefined' &&
        window.speechSynthesis
      ) {
        try {
          window.speechSynthesis.removeEventListener?.(
            'voiceschanged',
            voicesChangedHandlerRef.current as EventListener,
          );
        } catch {
          /* swallow */
        }
        voicesChangedHandlerRef.current = null;
      }
      // Engine intentionally NOT disposed — parent owns its lifetime.
      //
      // React strict-mode double-mount safety: reset all flag refs so the
      // 2nd mount (which always follows in dev) can re-run the choreography
      // fresh. Without this reset, typewriterCancelRef stayed `true` and
      // the typewriter never started — overlay sat black with only ambient.
      typewriterCancelRef.current = false;
      typewriterDoneRef.current = false;
      audioDoneRef.current = false;
      fastForwardRef.current = false;
      currentWordIdxRef.current = 0;
      // completedRef NOT reset — if we already faded out and called onComplete,
      // we never want to repeat that.
      startedRef.current = false;
    };
    // We deliberately run only on first mount; props are captured in closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={overlayRef}
      className={
        'fixed inset-0 z-50 bg-black flex items-center justify-center pointer-events-auto' +
        (fadingOut
          ? ' opacity-0 transition-opacity duration-[1500ms] ease-out'
          : ' opacity-100')
      }
      aria-live="polite"
      aria-label="Dream cinematic intro"
    >
      <p
        className="max-w-[38rem] px-6 sm:px-8 text-center text-lg italic font-serif text-white/85 leading-relaxed"
        style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
      >
        {displayed}
      </p>
    </div>
  );
}
