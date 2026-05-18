import { NextRequest, NextResponse } from 'next/server';

const LM_BASE_URL = process.env.QWEN_BASE_URL || 'http://localhost:1234';
const LM_MODEL = process.env.QWEN_MODEL || 'qwen3-coder-30b-a3b-instruct-mlx';

const SYSTEM_PROMPT = `You are DreamCraft AI — a cinematic game director converting dreams into AAA 3D game configurations.

Analyze the dream deeply: extract mood, atmosphere, color palette, key visual symbols, emotional tone.
Output a rich JSON configuration that drives a Godot 4 Forward+ (Vulkan) game with realistic lighting.

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no <think> tags. Exact schema:
{
  "mood": "one of: surreal_calm | dark_fantasy | cozy_dream | nightmare | cyber_dream | ethereal | whimsical | cosmic",
  "style": "one of: surreal | dark | cozy | nightmare | cyberpunk | watercolor | cosmic",
  "genre": "3d_platformer",
  "main_character": {
    "description": "3-5 word evocative character description for 3D model prompt",
    "color": "#hexcolor — main character emissive/albedo color"
  },
  "background": {
    "sky_color": "#hexcolor — dark sky base color",
    "ground_color": "#hexcolor — terrain low-level color"
  },
  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "narrative": "2-3 sentence poetic story. Sets the scene. Appears in loading screen.",
  "goal": "Poetic 8-word win condition shown as HUD objective",
  "music_prompt": "Detailed music description: genre, BPM, instruments, emotion, 10-15 words",
  "platforms": 8,
  "enemy_count": 4,
  "weather": "one of: clear | rain | storm | light_fog",
  "time_of_day": "one of: dawn | day | dusk | night | deep_night",
  "fog_density": 0.02,
  "terrain_height_scale": 18.0,
  "meshy_character_prompt": "Detailed Meshy.ai text-to-3D prompt for the character model, 15-25 words",
  "meshy_environment_prompt": "Detailed Meshy.ai prompt for a key environment prop, 15-25 words",
  "godot_environment_hints": {
    "sdfgi_energy": 1.2,
    "bloom_intensity": 1.0,
    "volumetric_fog_density": 0.02,
    "dof_far_distance": 80.0,
    "exposure": 1.1,
    "saturation": 1.1,
    "contrast": 1.05
  }
}`;

export async function POST(req: NextRequest) {
  const { dream } = await req.json();

  if (!dream?.trim()) {
    return NextResponse.json({ error: 'No dream provided' }, { status: 400 });
  }

  try {
    const res = await fetch(`${LM_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LM_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Dream: "${dream}"\n\nGenerate the game configuration JSON.` },
        ],
        temperature: 0.7,
        max_tokens: 1024,
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LM Studio error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const rawContent: string = data.choices?.[0]?.message?.content || '';

    const config = parseJsonFromLLM(rawContent);
    return NextResponse.json(config);

  } catch (err) {
    console.error('LM Studio error:', err);
    // Возвращаем fallback-конфиг чтобы демо не падало
    return NextResponse.json(generateFallback(dream), { status: 200 });
  }
}

function parseJsonFromLLM(text: string): Record<string, unknown> {
  // Убираем <think>...</think> блоки (Qwen3 thinking mode)
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // Убираем markdown-обёртки
  const cleaned = noThink.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON found in LLM response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function generateFallback(dream: string): Record<string, unknown> {
  const words = dream.toLowerCase();
  const isDark = /dark|shadow|nightmare|fear|monster|death|blood|horror/.test(words);
  const isCozy = /forest|garden|home|warm|cozy|peaceful|flower|light/.test(words);
  const isCyber = /neon|cyber|city|digital|robot|machine|code|matrix/.test(words);
  const isCosmic = /space|star|galaxy|universe|cosmos|planet|moon|float/.test(words);

  if (isDark) return {
    mood: 'nightmare', genre: '2d_platformer', style: 'dark',
    main_character: { description: 'Shadow Wanderer', color: '#7c3aed' },
    background: { sky_color: '#080010', ground_color: '#1a0820' },
    obstacles: ['dark_crystals', 'shadow_beasts', 'void_portals'],
    goal: 'Escape the nightmare realm',
    music_prompt: 'dark ambient horror, slow 60 bpm',
    color_palette: ['#7c3aed', '#4c1d95', '#1e1b4b', '#080010'],
    narrative: `Trapped in the dark: "${dream.slice(0, 80)}..." Find the exit.`,
    platforms: 7, enemy_count: 4,
  };

  if (isCozy) return {
    mood: 'cozy_dream', genre: '2d_platformer', style: 'cozy',
    main_character: { description: 'Forest Sprite', color: '#34d399' },
    background: { sky_color: '#0f2a1a', ground_color: '#1a3a1a' },
    obstacles: ['glowing_mushrooms', 'fireflies', 'ancient_roots'],
    goal: 'Find the heart of the dream forest',
    music_prompt: 'cozy folk ambient, gentle 75 bpm',
    color_palette: ['#34d399', '#059669', '#065f46', '#0f2a1a'],
    narrative: `In the gentle dream: "${dream.slice(0, 80)}..." Follow the light.`,
    platforms: 5, enemy_count: 2,
  };

  if (isCyber) return {
    mood: 'cyber_dream', genre: '2d_platformer', style: 'cyberpunk',
    main_character: { description: 'Neon Hacker', color: '#06b6d4' },
    background: { sky_color: '#000a1a', ground_color: '#0a1a2a' },
    obstacles: ['data_walls', 'virus_nodes', 'firewall_gates'],
    goal: 'Reach the source code',
    music_prompt: 'synthwave cyberpunk, energetic 120 bpm',
    color_palette: ['#06b6d4', '#0891b2', '#0e7490', '#000a1a'],
    narrative: `Deep in the digital dream: "${dream.slice(0, 80)}..." Break through.`,
    platforms: 8, enemy_count: 5,
  };

  if (isCosmic) return {
    mood: 'cosmic', genre: '2d_platformer', style: 'cosmic',
    main_character: { description: 'Star Drifter', color: '#e879f9' },
    background: { sky_color: '#020010', ground_color: '#0d0030' },
    obstacles: ['asteroid_fields', 'gravity_wells', 'nebula_clouds'],
    goal: 'Touch the heart of the nebula',
    music_prompt: 'cosmic ambient space, ethereal 85 bpm',
    color_palette: ['#e879f9', '#a855f7', '#7c3aed', '#020010'],
    narrative: `Adrift among stars: "${dream.slice(0, 80)}..." Find your constellation.`,
    platforms: 6, enemy_count: 3,
  };

  return {
    mood: 'surreal_calm', genre: '2d_platformer', style: 'surreal',
    main_character: { description: 'Dream Wanderer', color: '#a855f7' },
    background: { sky_color: '#0a0015', ground_color: '#1a0030' },
    obstacles: ['floating_crystals', 'shadow_pillars', 'dream_gates'],
    goal: 'Reach the light beyond the dream',
    music_prompt: 'dreamy ambient electronic, 90 bpm',
    color_palette: ['#a855f7', '#7c3aed', '#4c1d95', '#0a0015'],
    narrative: `In the dream: "${dream.slice(0, 100)}..." Something awaits at the end.`,
    platforms: 6, enemy_count: 3,
  };
}
