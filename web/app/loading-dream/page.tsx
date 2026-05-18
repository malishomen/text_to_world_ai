'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export default function LoadingDream() {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [narrative, setNarrative] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  useEffect(() => {
    const dreamText = localStorage.getItem('dreamText');
    if (!dreamText) {
      router.push('/');
      return;
    }

    let stepIndex = 0;
    let elapsed = 0;
    const totalDuration = STEPS.reduce((sum, s) => sum + s.duration, 0);

    const tick = () => {
      if (stepIndex >= STEPS.length) return;
      elapsed += STEPS[stepIndex].duration;
      setProgress(Math.round((elapsed / totalDuration) * 100));
      stepIndex++;
      setCurrentStep(stepIndex);
      if (stepIndex < STEPS.length) {
        setTimeout(tick, STEPS[stepIndex].duration);
      }
    };

    setTimeout(tick, STEPS[0].duration);

    // Kick off AI generation
    generateGame(dreamText);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateGame = async (dreamText: string) => {
    try {
      const analyzeRes = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dream: dreamText }),
      });

      if (!analyzeRes.ok) throw new Error('Dream analysis failed');
      const gameConfig = await analyzeRes.json();
      localStorage.setItem('gameConfig', JSON.stringify(gameConfig));
      setNarrative(gameConfig.narrative || '');

      // Generate 3D assets (Meshy.ai) + 2D fallback (SD) in parallel
      const [assets3d, assets2d] = await Promise.allSettled([
        fetch('/api/generate-3d', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: gameConfig }),
        }).then(r => r.json()),
        fetch('/api/generate-assets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config: gameConfig }),
        }).then(r => r.json()),
      ]);

      const merged = {
        ...(assets2d.status === 'fulfilled' ? assets2d.value : {}),
        ...(assets3d.status === 'fulfilled' ? assets3d.value : {}),
      };
      localStorage.setItem('gameAssets', JSON.stringify(merged));

      // Wait for loading animation to finish, then navigate
      setTimeout(() => {
        router.push('/play');
      }, 1000);
    } catch (err) {
      console.error(err);
      setError('Something went wrong crafting your dream. Retrying with defaults...');
      // Use fallback and still navigate
      const fallback = getFallbackConfig(localStorage.getItem('dreamText') || '');
      localStorage.setItem('gameConfig', JSON.stringify(fallback));
      setTimeout(() => router.push('/play'), 2000);
    }
  };

  const getFallbackConfig = (dream: string) => ({
    mood: 'surreal_calm',
    genre: '2d_platformer',
    style: 'surreal',
    main_character: { description: 'A glowing dream wanderer', color: '#a855f7' },
    background: { sky_color: '#0a0015', ground_color: '#1a0030' },
    obstacles: ['floating_crystals', 'shadow_pillars'],
    goal: 'Reach the light at the end of the dream',
    music_prompt: 'dreamy ambient electronic, 90 bpm',
    color_palette: ['#a8b2ff', '#ff9aee', '#7c3aed', '#1e1b4b'],
    narrative: `In the dream: "${dream.slice(0, 120)}..."`,
    platforms: 6,
    enemy_count: 3,
  });

  const completedSteps = STEPS.slice(0, currentStep);
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

        {error && (
          <p className="text-yellow-400/70 text-sm mb-4">{error}</p>
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
      </div>
    </main>
  );
}
