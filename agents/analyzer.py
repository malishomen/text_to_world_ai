"""
Agent 1 — World Analyzer
Принимает текст фантазии → возвращает полный конфиг мира с объектами,
освещением, атмосферой и промптами для TRELLIS.
"""
import json
import math
import random
import re
import httpx
from typing import Any

LM_BASE = "http://localhost:1234"
LM_MODEL = "qwen3-coder-30b-a3b-instruct-mlx"

SYSTEM_PROMPT = """You are a 3D world architect AI.
The user describes a fantasy world. You extract everything needed to build it in Godot 4.

Return ONLY valid JSON — no markdown, no <think> tags, no explanation.

Schema:
{
  "fantasy": "original user text",
  "mood": "dark_fantasy | cozy | surreal | cyberpunk | horror | medieval | sci_fi | nature",
  "weather": "clear | fog | rain | storm | snow",
  "time": "dawn | day | dusk | night | deep_night",
  "fog_density": 0.02,
  "color_palette": ["#hex1", "#hex2", "#hex3", "#hex4"],
  "lighting": {
    "sun_energy": 1.5,
    "sun_color": "#hexcolor",
    "ambient_energy": 0.3,
    "ambient_color": "#hexcolor"
  },
  "terrain": {
    "height_scale": 15.0,
    "roughness": 0.7,
    "base_color": "#hexcolor",
    "peak_color": "#hexcolor"
  },
  "objects": [
    {
      "type": "short_id",
      "label": "Human readable name",
      "trellis_prompt": "Detailed English prompt for 3D model generation, 15-25 words, object isolated on white background",
      "sd_prompt": "Same but optimized for Stable Diffusion image generation",
      "count": 5,
      "is_landmark": false,
      "scale": [1.0, 1.0, 1.0]
    }
  ]
}

Rules:
- 2-6 unique object types total (don't over-generate)
- Landmark objects (castles, towers, temples): count=1, is_landmark=true, scale [2-4, 2-4, 2-4]
- Scattered objects (trees, rocks, bushes): count=10-30, is_landmark=false
- trellis_prompt: always in English, always "isolated object, white background, no shadows"
- fog_density: 0.005 (clear) to 0.06 (heavy fog)
- sun_energy: 0.1 (night) to 3.0 (bright day)"""


class WorldAnalyzer:
    def __init__(self, base_url: str = LM_BASE, model: str = LM_MODEL):
        self.base_url = base_url
        self.model = model

    def analyze(self, fantasy_text: str) -> dict[str, Any]:
        """Calls Qwen, returns world config dict with generated positions."""
        raw = self._call_llm(fantasy_text)
        config = self._parse_json(raw)
        config = self._add_positions(config)
        return config

    def _call_llm(self, text: str) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f'Build a 3D world from this fantasy:\n\n"{text}"'},
            ],
            "temperature": 0.7,
            "max_tokens": 2048,
            "stream": False,
        }
        with httpx.Client(timeout=90) as client:
            resp = client.post(f"{self.base_url}/v1/chat/completions", json=payload)
            resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    def _parse_json(self, text: str) -> dict:
        # Strip <think> blocks (Qwen3 thinking mode)
        text = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()
        # Strip markdown fences
        text = re.sub(r"```json?\n?", "", text).replace("```", "").strip()
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError(f"No JSON found in LLM output:\n{text[:300]}")
        return json.loads(text[start : end + 1])

    def _add_positions(self, config: dict) -> dict:
        """Generate world-space positions for each object type."""
        rng = random.Random(hash(config.get("fantasy", "x")))

        for obj in config.get("objects", []):
            count = obj.get("count", 1)
            is_landmark = obj.get("is_landmark", False)

            if is_landmark:
                # Single landmark: place prominently in the world
                angle = rng.uniform(0, math.tau)
                r = rng.uniform(40, 70)
                obj["positions"] = [[
                    round(math.cos(angle) * r, 2),
                    0.0,
                    round(math.sin(angle) * r, 2),
                ]]
                obj["count"] = 1
            else:
                # Scattered objects: random distribution avoiding center
                positions = []
                for _ in range(count):
                    angle = rng.uniform(0, math.tau)
                    r = rng.uniform(8, 55)
                    x = round(math.cos(angle) * r, 2)
                    z = round(math.sin(angle) * r, 2)
                    positions.append([x, 0.0, z])
                obj["positions"] = positions

        return config

    def edit(self, current_config: dict, instruction: str) -> dict:
        """Agent 3 mode: modify existing world config based on instruction."""
        edit_prompt = f"""You are editing an existing 3D world configuration.

Current config:
{json.dumps(current_config, ensure_ascii=False, indent=2)}

User instruction: "{instruction}"

Apply the requested changes and return the COMPLETE updated JSON config.
Only change what the user asked. Return ONLY valid JSON, no markdown, no <think> tags."""

        raw = self._call_raw(edit_prompt)
        updated = self._parse_json(raw)
        # Preserve positions if objects unchanged
        return self._merge_positions(current_config, updated)

    def _call_raw(self, user_content: str) -> str:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": user_content}],
            "temperature": 0.4,
            "max_tokens": 2048,
            "stream": False,
        }
        with httpx.Client(timeout=90) as client:
            resp = client.post(f"{self.base_url}/v1/chat/completions", json=payload)
            resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    def _merge_positions(self, old: dict, new: dict) -> dict:
        """Keep existing GLB paths and positions for objects that didn't change."""
        old_map = {o["type"]: o for o in old.get("objects", [])}
        for obj in new.get("objects", []):
            old_obj = old_map.get(obj["type"])
            if old_obj:
                if "positions" not in obj:
                    obj["positions"] = old_obj.get("positions", [])
                if "glb" not in obj and "glb" in old_obj:
                    obj["glb"] = old_obj["glb"]
        return new
