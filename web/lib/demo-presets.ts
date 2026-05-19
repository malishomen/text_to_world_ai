// Hand-tuned demo presets for the landing page "instant dream" cards.
// Each preset bypasses the LLM call: the click writes dreamText + gameConfig +
// generationId to localStorage and navigates straight to /play.
//
// Every preset is self-validated at module load (see the loop at the bottom):
// - parseGameConfig round-trips mood / genre / platforms — drift crashes the
//   build, not the demo.
// - generationId is validated against the shared isValidGenerationId regex.
//
// Authored: 2026-05-19 — Agent P, Tier S plan (docs/PLAN_TIER_S.md).

import type { GameConfig } from '@/lib/fallback-config';
import { parseGameConfig } from '@/lib/game-config-schema';
import { isValidGenerationId } from '@/lib/generation-id';

export interface DemoPreset {
  /** Stable id; doubles as the localStorage key suffix and the TTS cache key. */
  id: string;
  /** 2-3 word card title shown in bold above the teaser. */
  label: string;
  /** Mood enum value — mirrors `config.mood` exactly, lifted out for the badge UI. */
  badge: string;
  /** 8-14 word card subtitle pulled from the narrative. */
  teaser: string;
  /** Full dream text written to localStorage.dreamText. */
  dream: string;
  /** Pre-validated GameConfig — round-trips through parseGameConfig. */
  config: GameConfig;
  /** Stable generationId so the same preset always yields the same level layout. */
  generationId: string;
}

export const DEMO_PRESETS: readonly DemoPreset[] = [
  {
    id: 'bleeding-mirrors',
    label: 'Bleeding Mirrors',
    badge: 'nightmare',
    teaser: 'A corridor of bleeding mirrors and a floor that screams when touched.',
    dream:
      'I was running through a corridor of bleeding mirrors, shadows tore at my heels and the floor screamed every time I touched it.',
    config: {
      mood: 'nightmare',
      style: 'gothic-horror',
      genre: '3d_platformer',
      main_character: {
        description: 'A pale runner trailing torn ribbons of mirror-light',
        color: '#b91c1c',
      },
      background: {
        sky_color: '#06000a',
        ground_color: '#1a0612',
      },
      color_palette: ['#b91c1c', '#7f1d1d', '#3f0a1f', '#06000a'],
      narrative:
        'You sprint down a hallway where every mirror weeps thin streams of blood and every footfall makes the floor wail. Shadows peel from the walls and lunge for your heels, hungry to keep you here forever.',
      goal: 'Outrun the screaming hallway before the mirrors finish bleeding.',
      music_prompt: 'dark ambient horror drone, 55 bpm, low cellos, detuned piano, dread',
      platforms: 7,
      enemy_count: 5,
    },
    generationId: 'preset-bleeding-mirrors-v1',
  },
  {
    id: 'fox-and-fireflies',
    label: 'Fox and Fireflies',
    badge: 'cozy_dream',
    teaser: 'A warm garden of glowing mushrooms and fireflies above a sleeping fox.',
    dream:
      'A warm garden where giant mushrooms glowed and fireflies danced in lazy spirals around a sleeping fox by a forest stream.',
    config: {
      mood: 'cozy_dream',
      style: 'storybook-soft',
      genre: '3d_platformer',
      main_character: {
        description: 'A small lantern-bearer in a moss-stitched cloak',
        color: '#fbbf24',
      },
      background: {
        sky_color: '#0f2a1a',
        ground_color: '#1f3a2a',
      },
      color_palette: ['#fbbf24', '#34d399', '#0f766e', '#0f2a1a'],
      narrative:
        'You wander a hush-warm garden where mushrooms taller than you breathe slow amber light. Fireflies spiral above a sleeping fox curled by a stream, and the moss thanks you in tiny green sighs each time you step.',
      goal: 'Carry the lantern to the heart of the sleeping garden.',
      music_prompt: 'cozy folk ambient, 72 bpm, music box, soft harp, woodwinds, tender',
      platforms: 6,
      enemy_count: 0,
    },
    generationId: 'preset-fox-and-fireflies-v1',
  },
  {
    id: 'neon-circuit',
    label: 'Neon Circuit',
    badge: 'cyber_dream',
    teaser: 'Diving inside a circuit board, chasing stolen code past glitching firewalls.',
    dream:
      'I dove into a neon megacity inside a circuit board, dodging glitching firewalls and chasing a stolen string of digital code.',
    config: {
      mood: 'cyber_dream',
      style: 'synthwave-glitch',
      genre: '3d_platformer',
      main_character: {
        description: 'A barefoot hacker wrapped in flickering data-shawls',
        color: '#06b6d4',
      },
      background: {
        sky_color: '#02021a',
        ground_color: '#0a0a2a',
      },
      color_palette: ['#22d3ee', '#a855f7', '#1e3a8a', '#02021a'],
      narrative:
        'You plunge into a megacity etched onto a humming circuit board, neon traces racing beneath your feet. Firewalls glitch sideways, spitting jagged sparks, while a single stolen line of code flickers ahead just out of reach.',
      goal: 'Catch the runaway string of code before the firewalls reboot.',
      music_prompt: 'synthwave cyberpunk, 124 bpm, arpeggiated synth, gated drums, drive',
      platforms: 8,
      enemy_count: 5,
    },
    generationId: 'preset-neon-circuit-v1',
  },
  {
    id: 'nebula-heart',
    label: 'Nebula Heart',
    badge: 'cosmic',
    teaser: 'Drifting between dying stars, hearing the heartbeat of a distant galaxy.',
    dream:
      'I drifted between dying stars, hopping from one shattered planet to the next, listening to the heartbeat of a distant galaxy.',
    config: {
      mood: 'cosmic',
      style: 'celestial-ink',
      genre: '3d_platformer',
      main_character: {
        description: 'A starlit drifter trailing a long comet-tail scarf',
        color: '#e879f9',
      },
      background: {
        sky_color: '#02010f',
        ground_color: '#0d0030',
      },
      color_palette: ['#e879f9', '#a855f7', '#4338ca', '#02010f'],
      narrative:
        'You step weightless from one shattered planet to the next, embers of dying stars drifting past your shoulders. Far away a galaxy beats like a slow heart, and each pulse pulls you one fragment closer to its glowing chest.',
      goal: 'Reach the heartbeat at the centre of the dying galaxy.',
      music_prompt: 'cosmic ambient space, 70 bpm, pad swells, glass bells, choir, vast',
      platforms: 7,
      enemy_count: 2,
    },
    generationId: 'preset-nebula-heart-v1',
  },
  {
    id: 'candy-clouds',
    label: 'Candy Clouds',
    badge: 'whimsical',
    teaser: 'Floating through candy clouds chased by giggling toy creatures.',
    dream:
      'I floated through candy-colored clouds chased by giggling toy creatures who wanted me to play their forever-game.',
    config: {
      mood: 'whimsical',
      style: 'sugar-pop',
      genre: '3d_platformer',
      main_character: {
        description: 'A bouncy dreamer in a balloon-jacket and striped boots',
        color: '#f472b6',
      },
      background: {
        sky_color: '#3b0764',
        ground_color: '#831843',
      },
      color_palette: ['#f472b6', '#fb7185', '#a855f7', '#3b0764'],
      narrative:
        'You skip across cotton-candy clouds in pink and mint, leaving small puffs of glitter behind. Plush toy creatures giggle and tumble after you, waving felt arms and begging you to stay forever in their bouncing forever-game.',
      goal: 'Hop the sugar clouds and find the way home.',
      music_prompt: 'whimsical music box pop, 96 bpm, glockenspiel, ukulele, giggles, playful',
      platforms: 6,
      enemy_count: 0,
    },
    generationId: 'preset-candy-clouds-v1',
  },
  {
    id: 'forgotten-lullaby',
    label: 'Forgotten Lullaby',
    badge: 'surreal_calm',
    teaser: 'Silver fog and a half-remembered lullaby from a hidden music box.',
    dream:
      'I drifted through silver fog while a lullaby I had forgotten as a child played from a music box hidden somewhere ahead.',
    config: {
      mood: 'surreal_calm',
      style: 'silver-haze',
      genre: '3d_platformer',
      main_character: {
        description: 'A barefoot sleepwalker in a long pearl-grey gown',
        color: '#c4b5fd',
      },
      background: {
        sky_color: '#0a0a22',
        ground_color: '#1a1a3a',
      },
      color_palette: ['#c4b5fd', '#818cf8', '#4338ca', '#0a0a22'],
      narrative:
        'You drift through silver fog that curls around your ankles like sleepy cats. Somewhere ahead a tiny music box turns its handle, threading the air with a lullaby you had not heard since you were small enough to believe it.',
      goal: 'Follow the lullaby home to the music box.',
      music_prompt: 'surreal ambient lullaby, 64 bpm, music box, glass piano, soft pad, drifting',
      platforms: 6,
      enemy_count: 2,
    },
    generationId: 'preset-forgotten-lullaby-v1',
  },
];

// Self-validation at module load — a bad preset crashes the build, not the demo.
for (const p of DEMO_PRESETS) {
  const round = parseGameConfig(p.config, p.dream);
  if (
    round.mood !== p.config.mood ||
    round.genre !== p.config.genre ||
    round.platforms !== p.config.platforms
  ) {
    throw new Error(
      `Preset "${p.id}" fails parseGameConfig round-trip — mood/genre/platforms drift`,
    );
  }
  if (!isValidGenerationId(p.generationId)) {
    throw new Error(
      `Preset "${p.id}" generationId fails isValidGenerationId: ${p.generationId}`,
    );
  }
}
