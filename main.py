"""
DreamCraft — Fantasy World Builder
Gradio 6.x compatible orchestrator
"""
import json
import os
import subprocess
from pathlib import Path
from typing import Generator

import gradio as gr
from dotenv import load_dotenv

load_dotenv()

from agents.analyzer import WorldAnalyzer
from agents.builder import WorldBuilder

# ─── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR     = Path(__file__).parent
GODOT_DIR    = BASE_DIR / "godot"
WORLD_CONFIG = GODOT_DIR / "world_config.json"
ASSETS_DIR   = GODOT_DIR / "assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

GODOT_BIN = os.getenv("GODOT_BIN", "")

# ─── Agents ───────────────────────────────────────────────────────────────────
analyzer = WorldAnalyzer()
builder  = WorldBuilder()
_current_config: dict = {}

# ─── Pipeline ─────────────────────────────────────────────────────────────────

def create_world(fantasy_text: str) -> Generator:
    global _current_config
    log: list[str] = []

    def L(msg: str) -> str:
        log.append(msg)
        return "\n".join(log)

    if not fantasy_text.strip():
        yield L("⚠️  Введи описание фантазии"), "Пусто", gr.update(interactive=False), gr.update(interactive=False)
        return

    # ── Agent 1 ───────────────────────────────────────────────────────────────
    yield L("🧠 Агент 1: Анализирую фантазию..."), "Анализ...", gr.update(interactive=False), gr.update(interactive=False)
    try:
        config = analyzer.analyze(fantasy_text)
        _current_config = config
        obj_list = ", ".join(f"{o['label']} ×{o['count']}" for o in config.get("objects", []))
        yield L(f"✅ Агент 1 готов: {obj_list}"), f"{len(config.get('objects',[]))} объектов", gr.update(interactive=False), gr.update(interactive=False)
    except Exception as e:
        yield L(f"❌ Агент 1 ошибка: {e}"), "Ошибка", gr.update(interactive=False), gr.update(interactive=False)
        return

    # ── Agent 2 ───────────────────────────────────────────────────────────────
    objects = config.get("objects", [])
    for i, obj in enumerate(objects):
        progress_msgs: list[str] = []

        yield (
            L(f"\n🔨 Агент 2 [{i+1}/{len(objects)}]: {obj['label']}..."),
            f"Строю {obj['label']}...",
            gr.update(interactive=False),
            gr.update(interactive=False),
        )

        glb = builder.generate_object(obj, on_progress=lambda m: progress_msgs.append(m))

        for msg in progress_msgs:
            yield L(f"  {msg}"), f"Строю {obj['label']}...", gr.update(interactive=False), gr.update(interactive=False)

        status = f"✅ {glb}" if glb else f"⚠️  {obj['label']}: процедурный меш"
        yield L(f"  {status}"), status, gr.update(interactive=False), gr.update(interactive=False)

    # ── Save config ───────────────────────────────────────────────────────────
    _current_config = config
    WORLD_CONFIG.write_text(json.dumps(config, indent=2, ensure_ascii=False))
    yield L("\n💾 world_config.json сохранён"), "Запуск Godot...", gr.update(interactive=False), gr.update(interactive=False)

    # ── Launch Godot ──────────────────────────────────────────────────────────
    if GODOT_BIN and Path(GODOT_BIN).exists():
        try:
            subprocess.Popen(
                # Передаём путь к сцене — Godot запускает игру сразу
                [GODOT_BIN, "--path", str(GODOT_DIR), str(GODOT_DIR / "main.tscn")],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            yield (
                L("\n🚀 Godot запущен! Ходи и исследуй мир."),
                "Мир готов!",
                gr.update(interactive=True),
                gr.update(interactive=True),
            )
        except Exception as e:
            yield L(f"\n⚠️  Godot ошибка: {e}"), "Открой Godot вручную", gr.update(interactive=True), gr.update(interactive=True)
    else:
        yield (
            L(f"\n⚠️  Godot не найден ({GODOT_BIN})\nОткрой папку godot/ вручную в Godot 4.6"),
            "Открой Godot вручную",
            gr.update(interactive=True),
            gr.update(interactive=True),
        )


def edit_world(instruction: str) -> tuple[str, str]:
    global _current_config
    if not _current_config:
        return "⚠️  Сначала создай мир", ""
    if not instruction.strip():
        return "⚠️  Введи инструкцию", ""
    try:
        updated = analyzer.edit(_current_config, instruction)
        _current_config = updated
        WORLD_CONFIG.write_text(json.dumps(updated, indent=2, ensure_ascii=False))
        return f"✅ Применено: {instruction}\nGodot перезагрузит сцену автоматически (~2 сек)", ""
    except Exception as e:
        return f"❌ Ошибка: {e}", ""


# ─── Gradio UI ────────────────────────────────────────────────────────────────

CSS = """
.gradio-container { max-width: 860px !important; margin: 0 auto; }
#log-box textarea { font-family: monospace; font-size: 12px; }
"""

with gr.Blocks(title="FantasyWorld AI") as demo:
    gr.Markdown("# 🌌 FantasyWorld AI")
    gr.Markdown("Опиши свою фантазию → AI строит 3D мир → ходишь и исследуешь")

    with gr.Group():
        gr.Markdown("### ✨ Создать мир")
        fantasy_input = gr.Textbox(
            label="Твоя фантазия",
            placeholder='"тёмный средневековый лес с руинами замка, ночь, густой туман"',
            lines=3,
        )
        gr.Examples(
            examples=[
                ["тёмный средневековый лес с разрушенным замком, ночь, туман"],
                ["космическая станция на орбите, неоновые огни"],
                ["уютная деревня в осеннем лесу, закат, грибы и фонари"],
                ["подводный город с кораллами и светящимися рыбами"],
                ["постапокалиптичный город, ржавые небоскрёбы, кислотный дождь"],
            ],
            inputs=fantasy_input,
        )
        create_btn  = gr.Button("🚀 Создать мир", variant="primary")
        status_out  = gr.Textbox(label="Статус", interactive=False, max_lines=1)
        log_out     = gr.Textbox(label="Лог агентов", interactive=False, lines=14, elem_id="log-box")

    with gr.Group():
        gr.Markdown("### 🔧 Редактировать мир (Агент 3)")
        gr.Markdown("*После запуска Godot пиши правки здесь — мир обновится через ~2 сек*")
        edit_input  = gr.Textbox(
            label="Инструкция",
            placeholder='"сделай туман гуще", "добавь снег", "смени на рассвет"',
            lines=2, interactive=False,
        )
        edit_btn    = gr.Button("✏️ Применить", variant="secondary", interactive=False)
        edit_status = gr.Textbox(label="Результат", interactive=False, max_lines=2)

    with gr.Accordion("ℹ️ Статус сервисов", open=False):
        gr.Markdown(f"""
- **LM Studio**: `{os.getenv('QWEN_BASE_URL','localhost:1234')}` — модель `{os.getenv('QWEN_MODEL','')}`
- **TRELLIS**: `{os.getenv('TRELLIS_URL','')}` — HF токен {'✅' if os.getenv('HF_TOKEN','').startswith('hf_') else '❌'}
- **Godot**: `{GODOT_BIN}` — {'✅ найден' if GODOT_BIN and Path(GODOT_BIN).exists() else '❌ не найден'}
- **Управление**: WASD ходить · мышь камера · Shift бежать
        """)

    # Wiring
    create_btn.click(
        fn=create_world,
        inputs=[fantasy_input],
        outputs=[log_out, status_out, edit_input, edit_btn],
    )
    edit_btn.click(
        fn=edit_world,
        inputs=[edit_input],
        outputs=[edit_status, edit_input],
    )


if __name__ == "__main__":
    print(f"🌌 FantasyWorld AI")
    print(f"   Godot : {GODOT_BIN} ({'OK' if GODOT_BIN and Path(GODOT_BIN).exists() else 'не найден'})")
    print(f"   TRELLIS: {os.getenv('TRELLIS_URL')}")
    demo.launch(
        server_name="0.0.0.0",
        server_port=int(os.getenv("PORT", 7999)),
        inbrowser=True,
        css=CSS,
        theme=gr.themes.Soft(primary_hue="purple"),
    )
