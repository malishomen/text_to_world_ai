# DreamCraft — From Dream to Playable Game

> Tell your dream → Get a playable mini-game in 60 seconds

## Quick Start

### 1. Start your AI services

**Qwen (via Ollama):**
```bash
ollama serve
ollama pull qwen2.5:7b
```

If you use LM Studio or vLLM, update `web/.env.local` with the correct URL.

**Stable Diffusion (Automatic1111):**
```bash
# In your SD WebUI directory:
./webui.sh --api --listen
```
SD is optional — the game will use procedural visuals if SD is unavailable.

### 2. Start the web app
```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000

### 3. Flow
1. Enter or speak your dream on the main page
2. Watch the AI analyze and generate your game (~30-60s)
3. Play immediately in the browser (canvas-based engine)

---

## Architecture

```
User → Next.js UI (localhost:3000)
              ↓
        /api/analyze  →  Local Qwen (Ollama :11434)
              ↓                ↓
        Game JSON config   Extracts: mood, style, colors, story
              ↓
        /api/generate-assets → Local SD (A1111 :7860)
              ↓                      ↓
        Saves PNGs to         background.png, character.png
        public/generated/
              ↓
        /play page
              ↓
        Canvas game engine (inline) OR Godot WebGL embed
```

---

## Godot 4 Integration (for WebGL export)

1. Open `godot/` folder in **Godot 4.3+**
2. Build the missing scenes: `main.tscn`, `player.tscn`, `platform.tscn`, `enemy.tscn`, `goal.tscn`
3. The scripts in `godot/scripts/` handle dynamic config loading from `localStorage`
4. Export → Web (HTML5) → put the export in `web/public/game/`
5. Uncomment the iframe embed in `web/app/play/page.tsx`

**The browser canvas game works out of the box** without Godot setup — use it for the hackathon demo.

---

## Config

Edit `web/.env.local`:

| Variable | Default | Description |
|---|---|---|
| `QWEN_BASE_URL` | `http://localhost:11434` | Ollama / LM Studio URL |
| `QWEN_MODEL` | `qwen2.5:7b` | Model name |
| `SD_BASE_URL` | `http://127.0.0.1:7860` | Stable Diffusion API |

---

## Tech Stack

- **Frontend**: Next.js 15 + React + Tailwind CSS + Framer Motion
- **LLM**: Local Qwen via Ollama (OpenAI-compatible fallback)
- **Image Gen**: Stable Diffusion (Automatic1111 API)
- **Game**: HTML5 Canvas (inline) + Godot 4 WebGL (optional)
- **Deploy**: Vercel (frontend) — AI services run locally

---

## Demo Script (Hackathon)

1. Open `localhost:3000`
2. Type: *"I was flying over a glowing crystal city at night, chased by purple shadows..."*
3. Hit **Craft My Game** — watch the loading screen animate through each step
4. Play the generated game — notice the colors, mood, and story match the dream
5. Hit **New Dream** and try a dark nightmare dream — completely different game!
