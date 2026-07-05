---
name: swap-fonts
description: >-
  Change the site-wide typography of this repo (pizzapeepo.github.io) — font families,
  type sizes, display weights, or letter-spacing. Use whenever the user asks to swap,
  change, replace, or try a different font/typeface, adjust the type scale or heading
  sizes globally, tune tracking, or says the fonts don't fit a theme or the site's
  physics/maths identity. All type config is centralized in CSS custom properties;
  this skill lists the exact edit points, the metrics that need retuning per face,
  and the outlier files — editing component CSS directly is almost always wrong.
---

# Swap the site's fonts

Current stack (since 2026-07): **STIX Two Text** (display — the arXiv/math-journal serif,
real italic) · **IBM Plex Sans** (body) · **IBM Plex Mono** (labels/readouts/tags).
All loaded from Google Fonts.

Every `font-family`, and the type sizes/weights/tracking that depend on font metrics, resolve
from CSS custom properties. A font swap touches **two files, two spots each** — nothing else.

## Edit points

### 1. `CSS/theme.css` — shared by every demo page

- **Line ~5**: the `@import url('https://fonts.googleapis.com/css2?...')` — replace families/weights.
- **`:root` → "TYPE CONFIG" block** (~line 40): the tokens.

### 2. `index.html` — self-contained landing page (does NOT load theme.css)

- **`<head>`**: the `<link href="https://fonts.googleapis.com/css2?...">` — keep identical to the @import.
- **`:root` → "TYPE CONFIG" block** (~line 47): mirrors theme.css tokens + landing-only extras.

Keep the two token blocks and two font URLs in sync — the landing page and demo pages must
not drift apart typographically.

## The tokens

| Token | Role | Retune on swap? |
|---|---|---|
| `--font-display` | hero, card/demo titles, page iris | family only |
| `--font-body` | copy, buttons, pills, toggles | family only |
| `--font-mono` | uppercase labels, readouts, tags, badges | family only |
| `--fw-display` / `--fw-display-strong` | title / hero weights | if face lacks 600/700 |
| `--track-display`, `--track-hero` (index only) | negative display tracking | **yes — metrics-dependent** |
| `--fs-hero`, `--fs-card-title`, `--fs-card-title-wide`, `--fs-page-title`, `--fs-iris` | display sizes | **yes — wide faces need smaller px** |
| `--fs-ui`, `--fs-eyebrow`, `--fs-mono-label`, `--fs-mono-value` | UI/label sizes | usually not |

Rule of thumb from past swaps: a grotesk sets ~10–15% wider than a serif at equal px.
Fraunces→Space Grotesk took the hero 116→108 max and card titles 26→23 with tighter tracking;
Space Grotesk→STIX Two reversed it (hero →114, card →25, tracking relaxed to -0.01em).
Judge from a screenshot, not arithmetic.

## Gotchas

- **Italics**: `.hdr-title em` in index.html is `font-style: italic` because STIX Two has
  a real italic. If the new display face lacks one (e.g. Space Grotesk), set it to
  `font-style: normal` — synthetic oblique looks bad at hero size; color + Viper glow
  carry the `em` differentiation on their own.
- **Google Fonts css2 URL syntax**: variable fonts take ranges (`wght@400..700`), static
  weights take lists (`ital,wght@0,400;0,500;1,400`). A malformed URL 400s and the whole
  page silently falls back to system fonts.
- **Silent var fallback**: a typo'd `var(--font-dsplay)` doesn't error — the element quietly
  inherits body font. Always verify visually (below).

## Outliers (mostly self-updating — verify, don't re-edit)

- `Quadtree/main.js` — canvas readout builds its font string from
  `getComputedStyle(document.body).fontFamily`, so it follows `--font-body` automatically.
- `PongWars/PongWars.html` — references `var(--font-display)` /
  `var(--font-body)` (theme.css is linked there); no literals to touch.
- **Do NOT touch**: `Web437_ATI_9x16` bitmap font in FluidSimulation / GravitySimulationGPU
  (functional ASCII-art glyph grid, not branding), `pr0xmas` (p5.js one-off),
  `CSS/fontStyles.css` (legacy Arial stack for old dual-canvas pages).

## Verify

Run the `web-screenshot` skill from the **PowerShell tool** (Bash mangles `--path`):

```powershell
node "C:\Users\Andrew\.claude\skills\web-screenshot\capture.mjs" --root "D:\Programming\pizzapeepo\pizzapeepo.github.io" --path "/index.html" --out "$env:TEMP\fonts-index.png" --wait 6000 --height 1600
node "C:\Users\Andrew\.claude\skills\web-screenshot\capture.mjs" --root "D:\Programming\pizzapeepo\pizzapeepo.github.io" --path "/FlowField/FlowField.html" --out "$env:TEMP\fonts-hud.png" --wait 5000
```

Read both PNGs and check: hero renders in the new display face (not a system-font fallback —
compare terminal shapes), mono labels in the HUD panel ("FIELD SCALE: 22" style readouts),
no hero overflow/clipping at the current `--fs-hero`, and `ERRORS 0` in capture output.
Headless font note: Google Fonts load fine headless; a fully generic-looking sans usually
means a typo'd token name or a 400 from the fonts URL.
