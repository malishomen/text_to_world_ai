'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildFallback, type GameConfig } from '@/lib/fallback-config';
import { parseGameConfig } from '@/lib/game-config-schema';
import { newGenerationId, isValidGenerationId } from '@/lib/generation-id';
import {
  type GameAssets,
  DREAM_ASSETS_UPDATED_EVENT,
  mergeAssetResponses,
} from '@/lib/game-assets';

// Visual progression skeleton — kept for animation continuity. The big
// label/icon shown to the user is driven by the real `status` state machine
// below, not this list. Steps still animate over time as decoration.
const STEPS = [
  { label: 'Reading your dream...', icon: '🌙', duration: 2000 },
  { label: 'Analyzing mood & atmosphere...', icon: '🎭', duration: 3000 },
  { label: 'Designing cinematic world...', icon: '🎬', duration: 2000 },
  { label: 'Sculpting 3D terrain...', icon: '🏔️', duration: 4000 },
  { label: 'Generating 3D character & props...', icon: '🧙', duration: 5000 },
  { label: 'Setting up AAA lighting & VFX...', icon: '✨', duration: 3000 },
  { label: 'Composing the soundtrack...', icon: '🎵', duration: 2000 },
  { label: 'Launching dream world...', icon: '⚡', duration: 2000 },
];

const MAX_MS = Number(process.env.NEXT_PUBLIC_MAX_GENERATION_MS ?? 75000);

// Real status state machine — what's actually happening server-side.
type Status =
  | { kind: 'starting' }
  | { kind: 'analyzing' }
  | { kind: 'saving_config' }
  | { kind: 'generating_assets' } // 2D + 3D in parallel, background
  | { kind: 'done' }
  | { kind: 'fallback_used'; reason: string };

interface StatusView {
  label: string;
  icon: string;
}

function viewForStatus(status: Status): StatusView {
  switch (status.kind) {
    case 'starting':
      return { label: 'Reading your dream...', icon: '🌙' };
    case 'analyzing':
      return { label: 'Analyzing mood & atmosphere...', icon: '🎭' };
    case 'saving_config':
      return { label: 'Designing cinematic world...', icon: '🎬' };
    case 'generating_assets':
      return { label: 'Generating 3D character & props...', icon: '🧙' };
    case 'done':
      return { label: 'Launching dream world...', icon: '⚡' };
    case 'fallback_used':
      return { label: 'Weaving a dream from imagination...', icon: '✨' };
  }
}

// Map status.kind to "current step index" in the decorative STEPS list.
function stepIndexForStatus(status: Status): number {
  switch (status.kind) {
    case 'starting':
      return 0;
    case 'analyzing':
      return 1;
    case 'saving_config':
      return 2;
    case 'generating_assets':
      return 4;
    case 'done':
    case 'fallback_used':
      return STEPS.length;
  }
}

export default function LoadingDream() {
  const [animatedStep, setAnimatedStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [narrative, setNarrative] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'starting' });
  const router = useRouter();

  const started = useRef(false);
  const navigated = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const dream = localStorage.getItem('dreamText');
    if (!dream) {
      router.replace('/');
      return;
    }

    // Sticky generationId for this session (StrictMode-safe; same id on remount).
    let generationId = localStorage.getItem('generationId');
    if (!generationId || !isValidGenerationId(generationId)) {
      generationId = newGenerationId();
      localStorage.setItem('generationId', generationId);
    }

    const ac = new AbortController();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let heartbeatId: ReturnType<typeof setInterval> | null = null;

    const goPlay = (_reason: 'ok' | 'timeout' | 'error') => {
      if (navigated.current) return;
      navigated.current = true;
      // Never overwrite an existing good gameConfig — if analyze already
      // populated it, the fallback would be a regression.
      if (!localStorage.getItem('gameConfig')) {
        localStorage.setItem('gameConfig', JSON.stringify(buildFallback(dream)));
      }
      router.replace('/play');
    };

    // Hard timeout — always navigate within MAX_MS.
    timers.push(setTimeout(() => goPlay('timeout'), MAX_MS));

    // Heartbeat — 1s ticks; UI surfaces it after 30s.
    const startedAt = Date.now();
    heartbeatId = setInterval(() => {
      if (navigated.current) return;
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);

    // Decorative step animation — every setTimeout tracked in `timers`.
    let stepIndex = 0;
    let elapsed = 0;
    const totalDuration = STEPS.reduce((sum, s) => sum + s.duration, 0);

    const tick = () => {
      if (navigated.current) return;
      if (stepIndex >= STEPS.length) return;
      elapsed += STEPS[stepIndex].duration;
      setProgress(Math.round((elapsed / totalDuration) * 100));
      stepIndex++;
      setAnimatedStep(stepIndex);
      if (stepIndex < STEPS.length) {
        timers.push(setTimeout(tick, STEPS[stepIndex].duration));
      }
    };
    timers.push(setTimeout(tick, STEPS[0].duration));

    // Dev fake-AI shortcut — skip LLM/SD/TRELLIS entirely.
    if (process.env.NEXT_PUBLIC_DEV_FAKE_AI === '1') {
      // Defer setState off the effect synchronous path (eslint rule).
      queueMicrotask(() => {
        if (navigated.current) return;
        setStatus({ kind: 'fallback_used', reason: 'dev_fake_ai' });
      });
      timers.push(setTimeout(() => goPlay('ok'), 3000));
      return () => {
        ac.abort();
        timers.forEach(clearTimeout);
        if (heartbeatId !== null) clearInterval(heartbeatId);
        started.current = false;
      };
    }

    // Real pipeline — analyze first, then fire-and-forget assets, then navigate.
    runPipeline({
      dream,
      generationId,
      signal: ac.signal,
      setStatus,
      setNarrative,
      goPlay,
      navigated,
    });

    return () => {
      ac.abort();
      timers.forEach(clearTimeout);
      if (heartbeatId !== null) clearInterval(heartbeatId);
      started.current = false;
    };
  }, [router]);

  // The big label/icon comes from real status when we have one; otherwise
  // fall back to the animated decorative step (covers the 'starting' moment
  // before the first network call kicks off).
  const statusView = useMemo(() => viewForStatus(status), [status]);
  const currentStepIdx = stepIndexForStatus(status);
  const displayStep = Math.max(currentStepIdx, animatedStep);
  const activeLabel = statusView.label;
  const activeIcon = statusView.icon;

  return (
    <main className="min-h-screen bg-[#0a0015] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Pulsing bg */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-purple-700/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/3 right-1/3 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="relative z-10 w-full max-w-lg text-center">
        {/* Big pulsing icon — driven by real status */}
        <div className="text-7xl mb-8 animate-bounce">{activeIcon}</div>

        <h2 className="text-2xl font-semibold text-purple-100 mb-2">{activeLabel}</h2>

        {narrative && (
          <p className="text-purple-300/60 text-sm italic mb-6 px-4">&ldquo;{narrative}&rdquo;</p>
        )}

        {/* Progress bar */}
        <div className="w-full bg-purple-900/30 rounded-full h-2 mb-8 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-violet-400 rounded-full transition-all duration-700"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step list — decorative, animated by both the timer and the real status */}
        <div className="text-left space-y-2">
          {STEPS.map((step, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-2 rounded-xl transition-all duration-500 ${
                i < displayStep
                  ? 'text-purple-400/60'
                  : i === displayStep
                  ? 'text-purple-100 bg-purple-800/20'
                  : 'text-purple-600/30'
              }`}
            >
              <span className={`text-lg ${i === displayStep ? 'animate-spin' : ''}`}
                    style={i === displayStep ? { animationDuration: '3s' } : {}}>
                {i < displayStep ? '✓' : step.icon}
              </span>
              <span className="text-sm">{step.label}</span>
            </div>
          ))}
        </div>

        {elapsedSec > 30 && (
          <p className="text-purple-400/60 text-xs mt-2">
            Still working… {elapsedSec}s / {Math.round(MAX_MS / 1000)}s
          </p>
        )}
      </div>
    </main>
  );
}

interface PipelineDeps {
  dream: string;
  generationId: string;
  signal: AbortSignal;
  setStatus: (s: Status) => void;
  setNarrative: (s: string) => void;
  goPlay: (reason: 'ok' | 'timeout' | 'error') => void;
  navigated: React.RefObject<boolean>;
}

/**
 * Real pipeline:
 *  1. analyze (await — gates config; uses AbortController via `signal`)
 *  2. parse defensively + save gameConfig
 *  3. fire-and-forget /api/generate-3d + /api/generate-assets in parallel
 *     — INTENTIONALLY no signal: these MUST survive unmount/navigation
 *  4. navigate immediately to /play (don't block on assets)
 *
 * Assets that arrive after navigation write to localStorage and dispatch
 * DREAM_ASSETS_UPDATED_EVENT on window; /play listens for both that event
 * and the cross-tab `storage` event to refresh its asset state.
 */
function runPipeline(deps: PipelineDeps): void {
  const { dream, generationId, signal, setStatus, setNarrative, goPlay, navigated } = deps;

  setStatus({ kind: 'analyzing' });

  (async () => {
    let rawJson: unknown = null;
    try {
      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dream }),
        signal,
      });

      if (!analyzeRes.ok) {
        throw new Error(`Dream analysis failed: ${analyzeRes.status}`);
      }
      rawJson = (await analyzeRes.json()) as unknown;
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return;
      console.error(err);
      if (navigated.current) return;
      setStatus({ kind: 'fallback_used', reason: 'analyze_failed' });
      goPlay('error');
      return;
    }

    if (navigated.current) return;

    // Defensive parse — guarantees a valid GameConfig even if analyze
    // returned garbage. analyze already validates, but this is cheap.
    const config: GameConfig = parseGameConfig(rawJson, dream);

    setStatus({ kind: 'saving_config' });
    try {
      localStorage.setItem('gameConfig', JSON.stringify(config));
    } catch {
      // localStorage full / disabled — fallback path still works via goPlay.
    }
    if (config.narrative) setNarrative(config.narrative);

    // Fire-and-forget asset generation. CRITICAL: these do NOT use the
    // analyze AbortController — they must run to completion even after the
    // user navigates to /play. Results land in localStorage and /play picks
    // them up via the DREAM_ASSETS_UPDATED_EVENT / storage event.
    setStatus({ kind: 'generating_assets' });
    void Promise.allSettled([
      fetch('/api/generate-3d', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, generationId }),
      }).then((r) => r.json() as Promise<unknown>),
      fetch('/api/generate-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, generationId }),
      }).then((r) => r.json() as Promise<unknown>),
    ])
      .then((results) => {
        const [three, two] = results;
        const threeValue: unknown =
          three.status === 'fulfilled' ? three.value : null;
        const twoValue: unknown =
          two.status === 'fulfilled' ? two.value : null;
        const merged: GameAssets = mergeAssetResponses(twoValue, threeValue, generationId);
        try {
          localStorage.setItem('gameAssets', JSON.stringify(merged));
        } catch {
          // ignore
        }
        try {
          window.dispatchEvent(new CustomEvent(DREAM_ASSETS_UPDATED_EVENT));
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // Defensive — never let asset failures crash navigation or surface
        // as unhandled rejections.
      });

    // Navigate immediately — don't wait for assets.
    if (!navigated.current) {
      setStatus({ kind: 'done' });
      goPlay('ok');
    }
  })();
}
