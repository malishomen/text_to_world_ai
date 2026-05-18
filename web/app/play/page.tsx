'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { RotateCcw, Download, Moon } from 'lucide-react';
import type { GameConfig } from '@/components/DreamGame3D';

// Three.js / Rapier must load client-side only — no SSR
const DreamGame3D = dynamic(() => import('@/components/DreamGame3D'), { ssr: false });

interface GameAssets {
  background_url?: string;
  character_url?: string;
}

export default function PlayPage() {
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [dreamText, setDreamText] = useState('');
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const storedConfig = localStorage.getItem('gameConfig');
    const storedDream = localStorage.getItem('dreamText');

    if (!storedConfig) { router.replace('/'); return; }

    setConfig(JSON.parse(storedConfig));
    setDreamText(storedDream || '');
    setLoading(false);
  }, [router]);

  const handleNewDream = () => {
    localStorage.removeItem('gameConfig');
    localStorage.removeItem('gameAssets');
    localStorage.removeItem('dreamText');
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
      <header className="flex items-center justify-between px-6 py-3 bg-black/40 backdrop-blur-sm border-b border-purple-900/30 z-20 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Moon size={18} className="text-purple-400" />
          <div>
            <h1 className="text-purple-100 font-semibold text-sm">DreamCraft</h1>
            <p className="text-purple-400/60 text-xs">
              {config.mood?.replace(/_/g, ' ')} · {config.style} · {config.genre?.replace(/_/g, ' ')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleNewDream}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-900/30 border border-purple-700/30 text-purple-300 hover:bg-purple-800/40 transition-all text-sm">
            <RotateCcw size={14} />
            New Dream
          </button>
          <button onClick={() => alert('Open /godot in Godot 4 → Export → Web. See README.')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-700/30 border border-violet-600/30 text-violet-300 hover:bg-violet-700/40 transition-all text-sm">
            <Download size={14} />
            Export
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* 3D Game */}
        <div className="flex-1 relative">
          <DreamGame3D config={config} />
        </div>

        {/* Sidebar */}
        <aside className="w-64 bg-black/50 backdrop-blur-sm border-l border-purple-900/30 p-5 flex flex-col gap-4 overflow-y-auto flex-shrink-0">
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
              <p>WASD / ↑↓←→ — Move</p>
              <p>Space — Jump (double OK)</p>
              <p>Reach the ✨ portal to win</p>
              <p>Avoid the red 👾 enemies</p>
              <p>Fall = restart</p>
            </div>
          </div>

          <div className="mt-auto p-3 bg-purple-900/15 rounded-xl border border-purple-900/30">
            <p className="text-purple-500/50 text-xs text-center leading-relaxed">
              3D engine: Three.js + Rapier physics
            </p>
          </div>
        </aside>
      </div>
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
