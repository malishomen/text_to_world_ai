# Legacy / Experimental components

This document is the **canonical statement** of which parts of the repository are
**not part of the main demo path** and **not actively maintained**.

If you are evaluating the project for the hackathon or as a reviewer: only the
contents of `web/` are in scope. Everything listed below is historical or
exploratory work kept for reference.

---

## `agents/` — Python orchestrator (legacy v1)

**Status:** legacy. Predates the Next.js web app. **Not invoked by any current
code path in `web/`.**

What lives here:

- `agents/__init__.py` — package marker (effectively empty).
- `agents/analyzer.py` — `WorldAnalyzer` class. Takes a free-form dream string
  and calls a local OpenAI-compatible LLM (`LM_BASE = http://localhost:1234`,
  same default as the web app) to produce a richer "world config" JSON that
  includes terrain, lighting, weather, and per-object TRELLIS / SD prompts.
  This v1 schema is a **superset** of the web app's `GameConfig` — additional
  fields exist for a Godot 4 world that was never wired up to the demo.
- `agents/builder.py` — `WorldBuilder` class. Iterates the analyzer's `objects`
  list and runs SD → reference PNG → TRELLIS HF Space → GLB for each, writing
  results into `godot/assets/<type>.{png,glb}`. Contains a private
  `_trellis_image_to_glb` helper that may not be referenced anywhere live —
  left as-is per the Option A doc-only scope.

**Why kept:** historical reference; may be revived as a batch / headless
generation tool (CLI or job runner) once the web MVP is stable.

**How to use today:** don't. The Web MVP (`web/`) is the demo. If you want to
experiment with the Python path, see `main.py` below — but be aware that none
of this code is exercised by the web app and its bugs (if any) are not on the
12-phase fix-plan backlog.

---

## `godot/` — Godot 4 export shell (experimental)

**Status:** experimental. Only relevant when `WRITE_GODOT_ASSETS=1` is set in
`web/.env.local`.

What lives here:

- `godot/project.godot`, `godot/main.tscn`, `godot/icon.svg` — Godot 4 project
  scaffolding.
- `godot/scripts/` — GDScript classes: `GameLoader`, `LevelGenerator`,
  `Player`, `AtmosphereController`, `Main`. Together they load
  `dream_config.json` from disk and assemble a 3D scene.
- `godot/shaders/` — shader files for terrain and "dream object" effects.
- `godot/assets/` — destination directory for runtime-written GLBs (the actual
  files are gitignored).
- `godot/scenes/` — currently empty; scene `.tscn` files referenced by
  `LevelGenerator` (`player.tscn`, `platform.tscn`, `enemy.tscn`, `goal.tscn`)
  have **not** been built. The Godot export does **not** run end-to-end today.

The Web MVP (Three.js + Rapier under `web/components/DreamGame3D.tsx`) is the
demo path. Godot WebGL export is a possible future enhancement.

**Why kept:** Godot's Forward+ renderer (Vulkan / Metal) would deliver
higher-fidelity visuals — volumetric fog, SDFGI, screen-space reflections — in
a production version. This directory is the seed of that work.

**How to use today (if you must):**

1. Set `WRITE_GODOT_ASSETS=1` in `web/.env.local`.
2. Run a dream end-to-end with TRELLIS enabled (see README § "Demo path 4").
   `/api/generate-3d` will mirror the GLBs into `godot/assets/` and write
   `godot/dream_config.json`.
3. Open `godot/` in **Godot 4.3+**. You will need to build the missing scenes
   (`scenes/player.tscn` etc.) — this work has **not** been done.
4. Export the project as Web (HTML5), drop the build into `web/public/game/`.
5. Wire an `<iframe>` in `web/app/play/page.tsx` to embed the Godot canvas
   (the embed was commented out historically — search for `iframe` in git
   history).

---

## `main.py` and `requirements.txt` (project root)

**Status:** legacy. Gradio 6.x orchestrator entrypoint to the Python world
described above (`agents/`). Not used by the web app. Imports
`agents.analyzer.WorldAnalyzer` and `agents.builder.WorldBuilder`, also shells
out to a Godot binary via `GODOT_BIN`.

`requirements.txt` pins the Python deps for this orchestrator:
`gradio`, `httpx`, `gradio_client`, `python-dotenv`.

Safe to ignore for hackathon demo purposes.

---

## Decision rationale

The user chose **Option A** (mark as legacy, do not rehabilitate) for Phase 10
of the 12-phase plan. Reasoning:

- The Web MVP under `web/` is the only path that has been hardened by FIX_PLAN
  phases A-D and the follow-on 12-phase plan.
- Rehabilitating the Python orchestrator and Godot exporter would multiply the
  surface area we need to keep audited — without serving the hackathon demo.
- Rehabilitation (Option B) is in **future scope** once the web MVP has shipped
  to production and the team is back to feature work rather than stabilisation.

If and when Option B happens, the work tracked here would be (rough order):

1. Rewire `agents/builder.py` to write into the same per-`generationId`
   directory layout used by `web/app/api/generate-3d/route.ts`.
2. Build the missing Godot scenes (`scenes/*.tscn`).
3. Replace the Three.js scene in `/play` with an `<iframe>` embedding a Godot
   WebGL export — behind a feature flag.
4. Document the Linux + NVIDIA CUDA requirements for local TRELLIS in a
   dedicated Godot README.

Until then, the rule is: **don't touch the legacy paths during demo prep**.
