'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { RotateCcw, Download, Moon, X, Volume2, VolumeX } from 'lucide-react';
import type { GameConfig } from '@/components/DreamGame3D';
import { parseGameConfig } from '@/lib/game-config-schema';
import { isValidGenerationId } from '@/lib/generation-id';
import {
  type GameAssets,
  NO_ASSETS,
  DREAM_ASSETS_UPDATED_EVENT,
  isGameAssets,
} from '@/lib/game-assets';
import type { AudioEngine } from '@/lib/audio/AudioEngine';
import { createStingers, type StingerEngine } from '@/lib/audio/stingers';

// Three.js / Rapier must load client-side only — no SSR
const DreamGame3D = dynamic(() => import('@/components/DreamGame3D'), { ssr: false });
const CinematicIntro = dynamic(() => import('@/components/CinematicIntro'), { ssr: false });

export default function PlayPage() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [dreamText, setDreamText] = useState('');
  const [generationId, setGenerationId] = useState<string | undefined>(undefined);
  const [assets, setAssets] = useState<GameAssets>(NO_ASSETS);
  const [loading, setLoading] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showAudioToast, setShowAudioToast] = useState(false);
  const audioEngineRef = useRef<AudioEngine | null>(null);
  const stingerEngineRef = useRef<StingerEngine | null>(null);
  const router = useRouter();

  useEffect(() => {
    const dreamTextStored = localStorage.getItem('dreamText') || '';
    const storedConfig = localStorage.getItem('gameConfig');
    if (!storedConfig) { router.replace('/'); return; }

    let parsedRaw: unknown;
    try {
      parsedRaw = JSON.parse(storedConfig);
    } catch {
      // Corrupted JSON — clean up and bounce to landing.
      localStorage.removeItem('gameConfig');
      localStorage.removeItem('gameAssets');
      router.replace('/');
      return;
    }

    // Defensive schema normalization — guarantees valid GameConfig.
    const normalized = parseGameConfig(parsedRaw, dreamTextStored);

    const rawGenId = localStorage.getItem('generationId');
    const validId = rawGenId && isValidGenerationId(rawGenId) ? rawGenId : undefined;

    // Read any assets that already landed before /play mounted. Bad JSON or
    // a failing type guard means we fall back to NO_ASSETS — procedural
    // rendering kicks in inside DreamGame3D.
    let initialAssets: GameAssets = NO_ASSETS;
    try {
      const stored = localStorage.getItem('gameAssets');
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (isGameAssets(parsed)) initialAssets = parsed;
      }
    } catch {
      // ignore — keep NO_ASSETS
    }

    // localStorage is client-only — canonical Next.js App Router pattern is
    // to populate state from it inside an effect, then guard the render via
    // `loading`. setState-in-effect is unavoidable here.
    /* eslint-disable react-hooks/set-state-in-effect */
    setConfig(normalized);
    setDreamText(dreamTextStored);
    setGenerationId(validId);
    setAssets(initialAssets);
    setLoading(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [router]);

  // Listen for late assets that resolve after /play has mounted.
  // - DREAM_ASSETS_UPDATED_EVENT: fires in THIS tab when loading-dream finishes.
  // - 'storage' event: fires in OTHER tabs when localStorage changes (multi-tab).
  useEffect(() => {
    const refresh = () => {
      try {
        const stored = localStorage.getItem('gameAssets');
        if (!stored) return;
        const parsed: unknown = JSON.parse(stored);
        if (isGameAssets(parsed)) setAssets(parsed);
      } catch {
        // ignore
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'gameAssets') refresh();
    };
    window.addEventListener(DREAM_ASSETS_UPDATED_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(DREAM_ASSETS_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Escape-to-close for the Export modal.
  useEffect(() => {
    if (!exportOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exportOpen]);

  // Audio: dispose engine + stingers on /play unmount. The engine is
  // constructed by CinematicIntro; we just take ownership of teardown.
  useEffect(() => {
    return () => {
      stingerEngineRef.current?.dispose();
      audioEngineRef.current?.dispose().catch(() => {});
      stingerEngineRef.current = null;
      audioEngineRef.current = null;
    };
  }, []);

  // Sync muted UI state with persisted localStorage (set by CinematicIntro
  // before it constructs the engine). Initialise once on mount.
  useEffect(() => {
    setMuted(localStorage.getItem('audioMuted') === '1');
  }, []);

  // First-visit audio toast: show after intro completes, once per session.
  useEffect(() => {
    if (!introDone) return;
    if (localStorage.getItem('audioToastShown') === '1') return;
    localStorage.setItem('audioToastShown', '1');
    const t1 = setTimeout(() => setShowAudioToast(true), 200);
    const t2 = setTimeout(() => setShowAudioToast(false), 4500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [introDone]);

  const handleMuteToggle = () => {
    const next = !muted;
    setMuted(next);
    audioEngineRef.current?.setMuted(next);
    // setMuted on the engine persists to localStorage already.
  };

  const handleNewDream = () => {
    localStorage.removeItem('gameConfig');
    localStorage.removeItem('gameAssets');
    localStorage.removeItem('dreamText');
    localStorage.removeItem('generationId');
    router.push('/');
  };

  const palette = useMemo(() => {
    const base = config?.color_palette ?? [];
    return [...base, '#a855f7', '#7c3aed', '#4c1d95', '#1e1b4b'].slice(0, 4);
  }, [config]);

  if (loading || !config) {
    return (
      <div className="min-h-screen bg-[#0a0015] flex items-center justify-center">
        <div className="text-purple-400 animate-pulse text-lg">Loading dream world...</div>
      </div>
    );
  }

  return (
    <main className="h-screen bg-[#0a0015] flex flex-col overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 sm:px-6 py-3 bg-black/40 backdrop-blur-sm border-b border-purple-900/30 z-20 flex-shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Moon size={18} className="text-purple-400 flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-purple-100 font-semibold text-sm">DreamCraft</h1>
            <p className="hidden sm:block text-purple-400/60 text-xs truncate">
              {config.mood?.replace(/_/g, ' ')} · {config.style} · {config.genre?.replace(/_/g, ' ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={handleMuteToggle}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            title={muted ? 'Unmute audio' : 'Mute audio'}
            className="flex items-center justify-center p-2 rounded-xl bg-purple-900/30 border border-purple-700/30 text-purple-300 hover:bg-purple-800/40 transition-all">
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button onClick={handleNewDream}
            aria-label="New Dream"
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl bg-purple-900/30 border border-purple-700/30 text-purple-300 hover:bg-purple-800/40 transition-all text-sm">
            <RotateCcw size={14} />
            <span className="hidden sm:inline">New Dream</span>
          </button>
          <button onClick={() => setExportOpen(true)}
            aria-label="Export to Godot"
            className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl bg-violet-700/30 border border-violet-600/30 text-violet-300 hover:bg-violet-700/40 transition-all text-sm">
            <Download size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      {/* Cinematic intro overlay — full-screen black + narrator + typewriter,
          fades into the scene. AudioEngine constructed inside; we capture it
          via onEngineReady so we can dispose on unmount + drive stingers. */}
      {!introDone && (
        <CinematicIntro
          narrative={config.narrative || 'A dream unfolds.'}
          mood={config.mood || 'surreal_calm'}
          generationId={generationId ?? 'no-id'}
          onComplete={() => setIntroDone(true)}
          onEngineReady={(engine) => {
            // Strict-mode double-mount safety: dispose any prior stinger
            // engine before creating a new one (otherwise its timers +
            // oscillators leak on every dev remount).
            stingerEngineRef.current?.dispose();
            audioEngineRef.current = engine;
            stingerEngineRef.current = createStingers(engine);
          }}
        />
      )}

      {/* First-visit audio toast */}
      {showAudioToast && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-full bg-purple-900/85 backdrop-blur border border-purple-500/40 text-purple-100 text-xs shadow-lg shadow-purple-900/40 animate-pulse">
          🔊 Mood audio is playing — click the speaker icon to mute
        </div>
      )}

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* 3D Game */}
        <div className="flex-1 relative min-h-0">
          <DreamGame3D
            config={config}
            generationId={generationId}
            assets={assets}
            onWinHook={() => { stingerEngineRef.current?.playWin().catch(() => {}); }}
            onDeadHook={() => { stingerEngineRef.current?.playLose().catch(() => {}); }}
          />
        </div>

        {/* Sidebar — right rail on desktop, collapsible bottom panel on mobile */}
        <aside className="w-full md:w-64 bg-black/50 backdrop-blur-sm border-t md:border-t-0 md:border-l border-purple-900/30 flex-shrink-0 md:overflow-y-auto md:flex md:flex-col md:gap-4 md:p-5 max-h-[45vh] md:max-h-none overflow-y-auto">
          {/* Mobile: <details> wraps content. Desktop: details acts as static container (open by default, summary hidden). */}
          <details open className="md:contents group">
            <summary className="md:hidden flex items-center justify-between px-4 py-3 cursor-pointer text-purple-300 text-xs font-semibold uppercase tracking-wider select-none">
              <span>Dream Details</span>
              <span className="text-purple-500/60 group-open:rotate-180 transition-transform">v</span>
            </summary>

            <div className="px-4 pb-4 md:p-0 flex flex-col gap-4 md:contents">
              {/* Dream quote */}
              <div>
                <h3 className="text-purple-400 text-xs font-semibold uppercase tracking-wider mb-2">Your Dream</h3>
                <p className="text-purple-200/60 text-xs italic leading-relaxed">
                  &ldquo;{dreamText.slice(0, 180)}{dreamText.length > 180 ? '...' : ''}&rdquo;
                </p>
              </div>

              {/* AI story */}
              <div>
                <h3 className="text-purple-400 text-xs font-semibold uppercase tracking-wider mb-2">The Story</h3>
                <p className="text-purple-100/80 text-xs leading-relaxed">{config.narrative}</p>
              </div>

              {/* Stats */}
              <div>
                <h3 className="text-purple-400 text-xs font-semibold uppercase tracking-wider mb-2">World</h3>
                <div className="space-y-1.5">
                  <Stat label="Platforms" value={String(config.platforms || 6)} />
                  <Stat label="Enemies" value={String(config.enemy_count || 3)} />
                  <Stat label="Goal" value={config.goal} />
                  <Stat label="Music" value={config.music_prompt ?? '—'} />
                </div>
              </div>

              {/* Palette */}
              <div>
                <h3 className="text-purple-400 text-xs font-semibold uppercase tracking-wider mb-2">Palette</h3>
                <div className="flex gap-1.5 flex-wrap">
                  {palette.map((c, i) => (
                    <div key={i} className="w-7 h-7 rounded-lg border border-white/10 shadow-inner"
                      style={{ backgroundColor: c }} title={c} />
                  ))}
                </div>
              </div>

              {/* Controls */}
              <div>
                <h3 className="text-purple-400 text-xs font-semibold uppercase tracking-wider mb-2">Controls</h3>
                <div className="space-y-1 text-purple-300/50 text-xs leading-relaxed">
                  <p>WASD / arrows — Move</p>
                  <p>Space — Jump (double OK)</p>
                  <p>Reach the portal to win</p>
                  <p>Avoid the red enemies</p>
                  <p>Fall = restart</p>
                </div>
              </div>

              <div className="md:mt-auto p-3 bg-purple-900/15 rounded-xl border border-purple-900/30">
                <p className="text-purple-500/50 text-xs text-center leading-relaxed">
                  3D engine: Three.js + Rapier physics
                </p>
              </div>
            </div>
          </details>
        </aside>
      </div>

      {/* Export modal */}
      {exportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setExportOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="export-modal-title"
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-[#0f0220] border border-purple-700/40 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setExportOpen(false)}
              aria-label="Close export dialog"
              className="absolute top-3 right-3 p-1 rounded-lg text-purple-400/70 hover:text-purple-200 hover:bg-purple-900/40 transition-colors"
            >
              <X size={16} />
            </button>

            <h2 id="export-modal-title" className="text-purple-100 font-semibold text-base mb-3">
              Export to Godot
            </h2>
            <p className="text-purple-200/80 text-sm leading-relaxed mb-5">
              Godot export is experimental. Run the project locally and use the Godot 4 editor to open
              the <code className="px-1 py-0.5 rounded bg-purple-900/40 text-violet-200 text-xs">godot/</code> folder,
              then File &rarr; Export &rarr; Web (HTML5).
            </p>

            <div className="flex justify-end">
              <button
                onClick={() => setExportOpen(false)}
                className="px-4 py-2 rounded-xl bg-violet-700/40 border border-violet-600/40 text-violet-100 hover:bg-violet-700/60 transition-all text-sm"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 items-start">
      <span className="text-purple-500/60 text-xs w-14 flex-shrink-0 pt-px">{label}</span>
      <span className="text-purple-200/70 text-xs leading-relaxed">{value}</span>
    </div>
  );
}
