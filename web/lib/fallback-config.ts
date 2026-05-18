// Single source of truth for fallback game configs and the GameConfig type.
// Used when LLM/SD/TRELLIS are unavailable or slow.
//
// Invariant: `genre` is always '3d_platformer' here — the game is 3D.
// See agent.md § 1.6 and memory.md § 1.3.

export interface GameConfig {
  mood: string;
  style: string;
  genre?: string;
  color_palette: string[];
  narrative: string;
  goal: string;
  music_prompt?: string;
  main_character: { description: string; color: string };
  background: { sky_color: string; ground_color: string };
  platforms: number;
  enemy_count: number;
}

const GENRE = '3d_platformer';

function quote(dream: string, max: number): string {
  const t = dream.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function buildFallback(dream: string): GameConfig {
  const words = dream.toLowerCase();
  const isDark   = /dark|shadow|nightmare|fear|monster|death|blood|horror/.test(words);
  const isCozy   = /forest|garden|home|warm|cozy|peaceful|flower|light/.test(words);
  const isCyber  = /neon|cyber|city|digital|robot|machine|code|matrix/.test(words);
  const isCosmic = /space|star|galaxy|universe|cosmos|planet|moon|float/.test(words);

  if (isDark) return {
    mood: 'nightmare', style: 'dark', genre: GENRE,
    main_character: { description: 'Shadow Wanderer', color: '#7c3aed' },
    background:     { sky_color: '#080010', ground_color: '#1a0820' },
    color_palette:  ['#7c3aed', '#4c1d95', '#1e1b4b', '#080010'],
    goal: 'Escape the nightmare realm',
    music_prompt: 'dark ambient horror, slow 60 bpm',
    narrative: `Trapped in the dark: "${quote(dream, 80)}" Find the exit.`,
    platforms: 7, enemy_count: 4,
  };

  if (isCozy) return {
    mood: 'cozy_dream', style: 'cozy', genre: GENRE,
    main_character: { description: 'Forest Sprite', color: '#34d399' },
    background:     { sky_color: '#0f2a1a', ground_color: '#1a3a1a' },
    color_palette:  ['#34d399', '#059669', '#065f46', '#0f2a1a'],
    goal: 'Find the heart of the dream forest',
    music_prompt: 'cozy folk ambient, gentle 75 bpm',
    narrative: `In the gentle dream: "${quote(dream, 80)}" Follow the light.`,
    platforms: 5, enemy_count: 2,
  };

  if (isCyber) return {
    mood: 'cyber_dream', style: 'cyberpunk', genre: GENRE,
    main_character: { description: 'Neon Hacker', color: '#06b6d4' },
    background:     { sky_color: '#000a1a', ground_color: '#0a1a2a' },
    color_palette:  ['#06b6d4', '#0891b2', '#0e7490', '#000a1a'],
    goal: 'Reach the source code',
    music_prompt: 'synthwave cyberpunk, energetic 120 bpm',
    narrative: `Deep in the digital dream: "${quote(dream, 80)}" Break through.`,
    platforms: 8, enemy_count: 5,
  };

  if (isCosmic) return {
    mood: 'cosmic', style: 'cosmic', genre: GENRE,
    main_character: { description: 'Star Drifter', color: '#e879f9' },
    background:     { sky_color: '#020010', ground_color: '#0d0030' },
    color_palette:  ['#e879f9', '#a855f7', '#7c3aed', '#020010'],
    goal: 'Touch the heart of the nebula',
    music_prompt: 'cosmic ambient space, ethereal 85 bpm',
    narrative: `Adrift among stars: "${quote(dream, 80)}" Find your constellation.`,
    platforms: 6, enemy_count: 3,
  };

  return {
    mood: 'surreal_calm', style: 'surreal', genre: GENRE,
    main_character: { description: 'Dream Wanderer', color: '#a855f7' },
    background:     { sky_color: '#0a0015', ground_color: '#1a0030' },
    color_palette:  ['#a855f7', '#7c3aed', '#4c1d95', '#0a0015'],
    goal: 'Reach the light beyond the dream',
    music_prompt: 'dreamy ambient electronic, 90 bpm',
    narrative: `In the dream: "${quote(dream, 100)}" Something awaits at the end.`,
    platforms: 6, enemy_count: 3,
  };
}
