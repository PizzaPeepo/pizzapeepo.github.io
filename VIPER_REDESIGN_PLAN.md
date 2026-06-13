# Viper Redesign — Main Page

Goal: make `index.html` stunning and memorable. Centerpiece: a new signature
color theme — **Viper** — true black backgrounds, venom/viper greens as the
working palette, and every *highlight* (hover, glow, comet, cursor) animated
in **pastel rainbow** colors. Viper becomes the default; the existing warm
gold theme ("Ember") and Light mode remain as alternates.

## Why this works

The page is a gallery of glowing canvas experiments. A near-black, green-lit
"terrarium" base makes every demo card read like a specimen tank, and the
pastel rainbow reserved *only* for moments of interaction (hover, cursor,
focus) makes touching the page feel rewarding — color literally blooms under
the pointer. Restraint everywhere + saturation on interaction = memorable.

## Theme system

- 3 themes cycled by the existing toggle button: **Viper → Ember → Light**.
- CSS classes on `<html>`: *(none)* = Ember dark (legacy default), `.light`,
  new `.viper`.
- `localStorage.theme` ∈ `viper | dark | light`; unknown/absent → `viper`
  (new visitors land on the signature look; users who chose `dark`/`light`
  before keep their choice).
- Toggle dispatches a `themechange` event — fixes a latent bug where
  `cardan.js` listens for it but index never fired it.

## Viper palette (reuses existing var slots — zero selector churn)

| Var slot | Ember value | Viper value | Role |
|---|---|---|---|
| `--bg` | #181210 | `#030806` | near-black, green-tinted |
| `--bg-card` | #231a11 | `#07120b` | card glass base |
| `--gold-hi` | #fdd87a | `#b8ffd9` | pastel mint highlight |
| `--gold` | #f5a623 | `#41f195` | venom green primary |
| `--gold-mid` | #c07800 | `#21d977` | mid green |
| `--gold-lo` | #7a4a00 | `#0a5c34` | deep green |
| `--coral*` | #ff6b47… | `#c3f53c…` | acid chartreuse secondary |
| `--tx` | #f5e8d4 | `#e4f5ea` | mint-tinted text |

Pastel rainbow ramp (new vars, viper only):
`--rb-1 #ffb3c8` pink · `--rb-2 #ffd9a8` peach · `--rb-3 #fdffb0` lemon ·
`--rb-4 #b3ffc9` mint · `--rb-5 #a8e4ff` sky · `--rb-6 #d9b8ff` lilac.

## New interactions (the "stunning" part)

1. **Cursor spotlight on cards** (all themes) — `.card::before` overlay whose
   center tracks the pointer via `--mx/--my` CSS vars. The disabled 3D-tilt
   rAF handler in index.html already coalesces mousemove → repurpose it to
   write the vars. Ember/Light: warm radial glow. **Viper: a conic pastel
   rainbow masked by a soft radial around the cursor, slowly hue-rotating** —
   the marquee effect.
2. **Rainbow comet border** — the existing SVG comet that traces the card
   outline on hover gets a second gradient def (6 pastel stops +
   SMIL `animateTransform` rotation). Stroke picks gold vs rainbow gradient
   by theme at mouseenter.
3. **Kinetic title blush** — the cursor-repelled hero letters additionally
   tint to a pastel hue (angle-of-push → hue) while inside the repel radius
   in viper. Letters scatter *and* blush.
4. **Hero `em` glow cycle** — "interactive." pulses through the 6 pastel
   hues via an animated `text-shadow` keyframe (follows the kinetic letters,
   robust where background-clip:text is not).
5. **Wavegrid shader recolor** — dot field gets a viper ramp (black →
   emerald → bright venom) via a `uViper` uniform; the mouse comet trail
   becomes a pastel rainbow whose hue drifts with time + position
   (`hsv2rgb` mixed 45% toward white = pastel).
6. **Hover streaks** — each streak spawns with a random pastel hue in viper
   (hsla, 95% sat / ~80% light) instead of gold.
7. **Cardan gimbal** — rings recolored venom green; the page-wide
   `drop-shadow` glow stack becomes mint-core + sky/lilac halo (pastel
   rainbow glow); dot-globe shader gets a viper ramp via `uViper`.
8. **Card micro-previews** — `g()/c()` color fns gain a 3rd theme branch:
   venom green + chartreuse.

## Detail polish (viper)

- `::selection` mint-on-black; styled scrollbar (deep green thumb → venom on
  hover).
- `hdr-divider` becomes the pastel rainbow ramp; eyebrow pip pulses mint.
- Card hover shadow tint → green; card glass tinted `rgba(6,14,9,…)`,
  hairline border `rgba(120,255,180,0.10)`.
- Background blobs auto-recolor through the var slots; opacity lowered so
  black stays black.
- Toggle button: `❋ Viper` / `☀ Ember` / `☾ Light`.
- `prefers-reduced-motion`: all new looping animations disabled.

## Files touched

| File | Change |
|---|---|
| `index.html` | viper var block + viper styles + spotlight CSS; 3-way toggle JS (+`themechange` dispatch); spotlight var writes; dual comet gradient; letter blush |
| `wavegrid.js` | `uViper` uniform, viper dot ramp, pastel rainbow trail, viper clear color + tint overlay |
| `streaks.js` | per-streak pastel hue in viper |
| `cardan.js` | `FILTER_VIPER` glow stack, `VIPER` ring colors, globe `uViper` ramp, 3-way `updateFilter` |
| `cardpreviews.js` | 3-way theme branch in `g()/c()` |

Demo subpages keep using `JS/theme.js` (dark/light) — out of scope here.

## Verification

`web-screenshot` headless pass on `index.html`: page renders (not black/blank
beyond the intended near-black bg — cards + title visible), console free of
errors, then spot-check Ember + Light still intact by toggling
`localStorage.theme`.
