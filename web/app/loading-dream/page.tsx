'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { buildFallback, type GameConfig } from '@/lib/fallback-config';

const STEPS = [
  { label: 'Reading your dream...', icon: '🌙', duration: 2000 },
  { label: 'Analyzing mood & atmosphere...', icon: '🎭', duration: 3000 },
  { label: 'Designing cinematic world...', icon: '🎬', duration: 2000 },
  { label: 'Sculpting 3D terrain...', icon: '🏔️', duration: 4000 },
  { label: 'Generating 3D character & props...', icon: '🧙', duration: 5000 },
  { label: 'Setting up AAA lighting & VFX...', icon: '✨', duration: 3000 },
  { label: 'Composing the soundtrack...', icon: '🎵', duration: 2000 },
  { label: 'Launching Godot engine...', icon: '⚡', duration: 2000 },
];

const MAX_MS = Number(process.env.NEXT_PUBLIC_MAX_GENERATION_MS ?? 75000);

export default function LoadingDream() {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [narrative, setNarrative] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
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

    const ac = new AbortController();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let heartbeatId: ReturnType<typeof setInterval> | null = null;

    const goPlay = (_reason: 'ok' | 'timeout' | 'error') => {
      if (navigated.current) return;
      navigated.current = true;
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

    // Step animation — every setTimeout tracked in `timers`.
    let stepIndex = 0;
    let elapsed = 0;
    const totalDuration = STEPS.reduce((sum, s) => sum + s.duration, 0);

    const tick = () => {
      if (navigated.current) return;
      if (stepIndex >= STEPS.length) return;
      elapsed += STEPS[stepIndex].duration;
      setProgress(Math.round((elapsed / totalDuration) * 100));
      stepIndex++;
      setCurrentStep(stepIndex);
      if (stepIndex < STEPS.length) {
        timers.push(setTimeout(tick, STEPS[stepIndex].duration));
      }
    };
    timers.push(setTimeout(tick, STEPS[0].duration));

    // Dev fake-AI shortcut — skip LLM/SD/TRELLIS entirely.
    if (process.env.NEXT_PUBLIC_DEV_FAKE_AI === '1') {
      timers.push(setTimeout(() => goPlay('ok'), 3000));
      return () => {
        ac.abort();
        timers.forEach(clearTimeout);
        if (heartbeatId !== null) clearInterval(heartbeatId);
        started.current = false;
      };
    }

    generateGame(dream, ac.signal, setNarrative)
      .then(() => goPlay('ok'))
      .catch((err) => {
        if (err?.name !== 'AbortError') console.error(err);
        goPlay('error');
      });

    return () => {
      ac.abort();
      timers.forEach(clearTimeout);
      if (heartbeatId !== null) clearInterval(heartbeatId);
      started.current = false;
    };
  }, [router]);

  const completedSteps = STEPS.slice(0, currentStep);
  void completedSteps;
  const activeStep = STEPS[currentStep] || STEPS[STEPS.length - 1];

  return (
    <main className="min-h-screen bg-[#0a0015] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Pulsing bg */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-purple-700/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/3 right-1/3 w-80 h-80 bg-indigo-600/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1.5s' }} />
      </div>

      <div className="relative z-10 w-full max-w-lg text-center">
        {/* Big pulsing icon */}
        <div className="text-7xl mb-8 animate-bounce">{activeStep.icon}</div>

        <h2 className="text-2xl font-semibold text-purple-100 mb-2">{activeStep.label}</h2>

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

        {/* Step list */}
        <div className="text-left space-y-2">
          {STEPS.map((step, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 px-4 py-2 rounded-xl transition-all duration-500 ${
                i < currentStep
                  ? 'text-purple-400/60'
                  : i === currentStep
                  ? 'text-purple-100 bg-purple-800/20'
                  : 'text-purple-600/30'
              }`}
            >
              <span className={`text-lg ${i === currentStep ? 'animate-spin' : ''}`}
                    style={i === currentStep ? { animationDuration: '3s' } : {}}>
                {i < currentStep ? '✓' : step.icon}
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

async function generateGame(
  dream: string,
  signal: AbortSignal,
  setNarrative: (s: string) => void,
): Promise<void> {
  const analyzeRes = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dream }),
    signal,
  });

  if (!analyzeRes.ok) throw new Error('Dream analysis failed');
  const gameConfig = (await analyzeRes.json()) as GameConfig;

  // Persist config BEFORE firing parallel asset jobs — so even if the
  // hard timer trips while assets hang, /play has the good config.
  localStorage.setItem('gameConfig', JSON.stringify(gameConfig));
  if (gameConfig?.narrative) setNarrative(gameConfig.narrative);

  // Generate 3D assets (TRELLIS) + 2D fallback (SD) in parallel.
  const [assets3d, assets2d] = await Promise.allSettled([
    fetch('/api/generate-3d', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: gameConfig }),
      signal,
    }).then((r) => r.json()),
    fetch('/api/generate-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: gameConfig }),
      signal,
    }).then((r) => r.json()),
  ]);

  const merged = {
    ...(assets2d.status === 'fulfilled' ? assets2d.value : {}),
    ...(assets3d.status === 'fulfilled' ? assets3d.value : {}),
  };
  localStorage.setItem('gameAssets', JSON.stringify(merged));
}
