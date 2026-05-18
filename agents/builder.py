"""
Agent 2 — World Builder
Для каждого объекта: SD → PNG → TRELLIS HF Space → GLB
Сохраняет в godot/assets/{type}.glb
"""
import asyncio
import base64
import os
import time
from pathlib import Path
from typing import Callable

import httpx
from gradio_client import Client, handle_file

SD_URL   = os.getenv("SD_BASE_URL", "http://127.0.0.1:7860")
HF_TOKEN = os.getenv("HF_TOKEN", "")
TRELLIS_SPACE = os.getenv("TRELLIS_URL", "JeffreyXiang/TRELLIS-image-large")

BASE_DIR    = Path(__file__).parent.parent
ASSETS_DIR  = BASE_DIR / "godot" / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)


class WorldBuilder:
    def __init__(self):
        self._trellis: Client | None = None

    def _get_trellis(self) -> Client:
        if self._trellis is None:
            # TRELLIS HF Space is public — no token needed for gradio_client
            self._trellis = Client(TRELLIS_SPACE)
        return self._trellis

    # ── Public ────────────────────────────────────────────────────────────────

    def generate_object(
        self,
        obj: dict,
        on_progress: Callable[[str], None] | None = None,
    ) -> str | None:
        """Generate texture PNG for one object type (+ try TRELLIS for GLB)."""
        obj_type = obj["type"]
        png_path = ASSETS_DIR / f"{obj_type}.png"
        glb_path = ASSETS_DIR / f"{obj_type}.glb"

        # Skip if already generated
        if png_path.exists() and png_path.stat().st_size > 1000:
            if on_progress:
                on_progress(f"♻️  {obj_type}.png уже есть — пропускаем")
            obj["texture"] = f"{obj_type}.png"
            if glb_path.exists():
                obj["glb"] = f"{obj_type}.glb"
            return f"{obj_type}.png"

        if on_progress:
            on_progress(f"🎨 FLUX: генерирую {obj['label']}...")

        png_buf = self._sd_generate(obj.get("sd_prompt") or obj.get("trellis_prompt", obj_type))

        if png_buf is None:
            if on_progress:
                on_progress(f"⚠️  Изображение недоступно — {obj_type} будет процедурным")
            return None

        # Save PNG as texture for Godot
        png_path.write_bytes(png_buf)
        obj["texture"] = f"{obj_type}.png"
        if on_progress:
            on_progress(f"✅ {obj_type}.png ({len(png_buf)//1024}KB)")
        return f"{obj_type}.png"

    # ── Stable Diffusion ──────────────────────────────────────────────────────

    def _sd_generate(self, prompt: str) -> bytes | None:
        """Try local SD first, fallback to HF Inference API (SDXL)."""
        result = self._sd_local(prompt)
        if result:
            return result
        print("[SD] local unavailable, trying HF Inference API...")
        return self._sd_hf(prompt)

    def _sd_local(self, prompt: str) -> bytes | None:
        payload = {
            "prompt": (
                f"{prompt}, isolated object, pure white background, "
                "centered, no shadows, product photography style"
            ),
            "negative_prompt": "background, scenery, blurry, text, watermark, shadow",
            "width": 512, "height": 512, "steps": 28,
            "cfg_scale": 7.5, "sampler_name": "DPM++ 2M Karras",
        }
        try:
            with httpx.Client(timeout=10) as c:
                c.get(f"{SD_URL}/sdapi/v1/options").raise_for_status()
            with httpx.Client(timeout=120) as c:
                r = c.post(f"{SD_URL}/sdapi/v1/txt2img", json=payload)
                r.raise_for_status()
            return base64.b64decode(r.json()["images"][0])
        except Exception as e:
            print(f"[SD local] {e}")
            return None

    def _sd_hf(self, prompt: str) -> bytes | None:
        """HF Inference API — пробуем несколько моделей по очереди."""
        if not HF_TOKEN:
            return None
        full_prompt = (
            f"{prompt}, isolated object, pure white background, "
            "centered, no shadows, product photography, high quality"
        )
        # HF router API (актуальный endpoint 2025)
        try:
            with httpx.Client(timeout=60) as c:
                r = c.post(
                    "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
                    headers={"Authorization": f"Bearer {HF_TOKEN}"},
                    json={"inputs": full_prompt},
                )
            if r.status_code == 200 and len(r.content) > 1000:
                print(f"[SD HF] FLUX.1-schnell OK — {len(r.content)//1024}KB")
                return r.content
            print(f"[SD HF] FLUX.1-schnell → {r.status_code}: {r.text[:100]}")
        except Exception as e:
            print(f"[SD HF] error: {e}")
        return None

    # ── TRELLIS ───────────────────────────────────────────────────────────────

    def _trellis_image_to_glb(
        self,
        png_buf: bytes,
        obj_type: str,
        on_progress: Callable[[str], None] | None = None,
    ) -> str | None:
        try:
            client = self._get_trellis()

            # Save temp PNG for Gradio handle_file
            tmp_png = ASSETS_DIR / f"_tmp_{obj_type}.png"
            tmp_png.write_bytes(png_buf)

            # Step A: Preprocess (background removal + centering)
            if on_progress:
                on_progress(f"  TRELLIS A/3: preprocessing image...")
            pre = client.predict(
                image=handle_file(str(tmp_png)),
                api_name="/preprocess_image",
            )

            # Step B: Image → 3D
            if on_progress:
                on_progress(f"  TRELLIS B/3: generating 3D structure...")
            client.predict(
                image=handle_file(pre) if isinstance(pre, str) else pre,
                seed=42,
                randomize_seed=True,
                ss_guidance_strength=7.5,
                ss_sampling_steps=12,
                slat_guidance_strength=3.0,
                slat_sampling_steps=12,
                api_name="/image_to_3d",
            )

            # Step C: Extract GLB
            if on_progress:
                on_progress(f"  TRELLIS C/3: baking textures → GLB...")
            glb_result = client.predict(
                mesh_simplify_ratio=0.95,
                texture_size=1024,
                api_name="/extract_glb",
            )

            # Download / copy GLB
            glb_src = glb_result if isinstance(glb_result, str) else glb_result[0]
            dest = ASSETS_DIR / f"{obj_type}.glb"

            if glb_src.startswith("http"):
                with httpx.Client(timeout=60) as c:
                    data = c.get(glb_src).content
                dest.write_bytes(data)
            else:
                import shutil
                shutil.copy2(glb_src, dest)

            tmp_png.unlink(missing_ok=True)
            if on_progress:
                on_progress(f"  ✅ {obj_type}.glb ({dest.stat().st_size // 1024} KB)")
            return f"{obj_type}.glb"

        except Exception as e:
            print(f"[TRELLIS] failed for {obj_type}: {e}")
            if on_progress:
                on_progress(f"  ⚠️  TRELLIS ошибка для {obj_type}: {e}")
            return None
