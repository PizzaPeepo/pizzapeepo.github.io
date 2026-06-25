---
name: verify-ascii-fluid
description: >-
  Headlessly screenshot and verify the FluidSimulation ASCII mode in this repo
  (pizzapeepo.github.io) — the glyph grid, horizontal glyph spacing, the asciiTest.html
  before/after harness, or the live WebGL pipeline. Use whenever the user asks to verify,
  screenshot, check, or "does it render" the ASCII fluid sim, inspect glyph spacing/pitch
  (ASCII_GP_X), tweak the gap between glyphs, or confirm an ASCII-mode change. Reach for
  this instead of hand-rolling a web-screenshot command, because ASCII mode is OFF by
  default (needs a keypress) and the screenshot tool fails silently under the Bash tool.
---

# Verify FluidSimulation ASCII mode

Goal: get a real headless screenshot of the ASCII fluid sim and report whether it renders
(0 errors, non-black) plus the glyph-spacing numbers — without the manual "open page, press A"
dance, and without the two failure traps below.

## Two traps this skill exists to avoid

1. **ASCII mode is OFF by default.** A plain screenshot of `FluidSimulation.html` shows the
   normal fluid, not glyphs. The page now reads boot params, so `?ascii=1` forces ASCII on at
   load (same code path as pressing `A`). See [main.js](../../../FluidSimulation/main.js) boot hook.
2. **Run the screenshot from the PowerShell tool, NEVER the Bash tool.** Git Bash (MSYS) rewrites
   a leading-`/` `--path` like `/FluidSimulation/...` into a Windows path, so capture.mjs dies with
   `Protocol error (Page.navigate): Cannot navigate to invalid URL`. A `?query` on the path
   accidentally masks the bug, which makes it intermittent and confusing. Always PowerShell.

## Targets

| Target | Page | What it shows |
|--------|------|---------------|
| `test` | `FluidSimulation/asciiTest.html` | Standalone, WebGL-free. BEFORE(16) vs AFTER(11) panels, cell-guide grid, and a **numeric gap readout** per panel. Best for spacing checks — deterministic, no SwiftShader AA noise. |
| `live` | `FluidSimulation/FluidSimulation.html?ascii=1` | The real WebGL2 pipeline in ASCII mode, seeded with dye. Best for "does the actual demo render". |

## Run it

Use the bundled PowerShell script (it resolves repo root + the web-screenshot `capture.mjs`,
sets sane waits, and prints `SHOT <png>` / `ERRORS <n>`). Invoke with the **PowerShell tool**:

```powershell
# spacing harness (default target)
& "<repo>/.claude/skills/verify-ascii-fluid/scripts/verify-ascii.ps1" -Target test

# sweep a different horizontal pitch / zoom / row count
& "...\verify-ascii.ps1" -Target test -Gpx 13 -Scale 7 -Rows 4

# live pipeline, bigger glyphs, more dye
& "...\verify-ascii.ps1" -Target live -Cols 28 -Splats 14
```

Then **Read the PNG** it reports (the `out :` / `SHOT` path) to view it. `ERRORS 0` + a
non-black image = renders.

If `capture.mjs` isn't found, pass `-CaptureMjs <path>` or set `$env:WEB_SCREENSHOT_MJS`
(it lives in the user's `web-screenshot` skill folder).

## Knobs

Boot params on the live page (also usable by hand in a browser):
- `?ascii=1` — enable ASCII at load · `&cols=N` — glyph size (lower = bigger) · `&splats=N` — extra dye seeds.

asciiTest.html query knobs:
- `?gpx=N` — glyph cell WIDTH in units (the real constant is `ASCII_GP_X`, default 11; 16 = old square) ·
  `&scale=N` — screen px per unit · `&rows=N` — ramp rows drawn.

## Reading the result

- **Spacing (test target):** each panel prints `horizontal gap ≈ Nu`. Native ink ≈ 9u, so a
  16-wide cell gives ~7u gap and an 11-wide cell ~2u → ~70% tighter. `gap = gpx − ink`.
  To actually change the live gap, edit `ASCII_GP_X` in [main.js](../../../FluidSimulation/main.js);
  `cols` auto-inflates so glyph size/aspect stay fixed — only spacing moves.
- **Render (live target):** expect a dense colored glyph grid. Black screen or `ERRORS > 0`
  means a shader/JS failure — read the console dump capture.mjs prints.
- **SwiftShader caveat:** headless canvas2D AA differs from real Chrome, so trust the geometry
  (the `test` panels' gap math) over pixel-exact glyph fidelity; re-check ragged-glyph concerns
  on a real GPU. (Background: the project memory note on ASCII glyph exact pixels.)
