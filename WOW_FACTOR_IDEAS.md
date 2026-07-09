# Landing "Wow Factor" — Design Ideas

Design exploration for the `index.html` landing page across its four background modes.
Written to be *grounded in the actual codebase* — every idea names the real hook it would
plug into, so none of it is generic Pinterest advice.

---

## 0. What already exists (so we don't re-invent it)

The landing is **already** a heavily art-directed, motion-rich page. Before adding anything,
here is the current "wow" inventory — new ideas must earn their place *next to* these, not
duplicate them:

| Layer | Effect | Where |
|-------|--------|-------|
| Hero title | Kinetic per-letter mouse-repel + cycling italic word (spring overshoot) | `#kineticTitle` script |
| Hero | Parallax dolly + dissolve on scroll (computes progress `p`) | hero-parallax IIFE |
| Background (fluid mode) | GPU Navier–Stokes fluid → ASCII glyph lattice, ambient curl-noise drift, cardan gimbal, in-lattice hero text | `asciibg/main.js` |
| Background (classic mode) | WebGL2 perspective dot-plane, camera dolly on scroll, mouse comet trail, click ripples, load "overture" | `wavegrid.js` |
| UI ↔ fluid | Card/pill hover **parts** the fluid; dye under each card **tints its border** (`--fluid-tint`/`--fluid-amt`) | `ui-link.js`, `dye-readback.js` |
| Cards | Cursor spotlight (radial gold; viper = hue-rotating conic rainbow), SVG comet-border draw-on, diagonal glow streaks on hover | inline + `streaks.js` |
| Navigation | Page **iris match-cut** (card grows to full-screen title card seeded with its live preview), reverse iris on return | page-iris IIFE |
| Grid | FLIP filter transitions, scroll-reveal card entrance that **pings the wave plane** at each card | filter + reveal IIFEs |
| Viper theme | Pastel rainbow ramp (`--rb-1..6`) already threaded through spotlight, borders, streaks, title chars | throughout |

**Design read:** the page is dense. The highest-leverage move is *not* another independent
gimmick — it's **one headline set-piece** plus **connective tissue** that makes the systems
already present feel like one intentional world. A world-class pass edits as much as it adds.

The four modes, for reference (two toggles — Fluid master, ASCII glyphs):

1. **Fluid OFF** → classic wavegrid + streaks + cardan.
2. **Fluid ON + ASCII ON** (default) → glyph lattice + gimbal + hero text.
3. **Fluid ON + ASCII OFF** → raw dye over wavegrid, below streaks/cardan.

---

## 1. The RGB bands idea — evaluation & placement

**Mechanism** (what the reference actually is): soft, slow, sinusoidal horizontal ribbons in
red / green / blue, composited **additively** (`screen` / `plus-lighter` in CSS, or GL
`blendFunc(ONE, ONE)`). Additive is the whole trick — where two bands cross you get the
secondary (R+G=yellow, G+B=cyan, R+B=magenta); where all three cross you get **white**. It's
literally an optics demo, which is *perfectly on-brand* for a physics/math lab.

### 1a. The honest tension — and its resolution

Pure primary RGB fights this site's identity. "21 Velvet" is a curated **warm gold + coral on
chocolate** system; Viper is **venom green**. Dropping saturated red/green/blue bands in front
of that reads like a different website bolted on.

**Resolution — theme-triad remap.** Keep the *additive-converge-to-white physics*, swap the
*three inks* per theme so it feels native. The convergence still whites out; the palette stays
on-brand:

| Theme | Band A | Band B | Band C | Notes |
|-------|--------|--------|--------|-------|
| dark (Ember) | `--gold-hi` | `--coral` | `--gold-lo`/amber | warm triad, still whites where all cross |
| light | darker gold / coral / clay | | | lower opacity, `multiply` may read better than `screen` on paper |
| viper | `--rb-1` / `--rb-4` / `--rb-5` (pink/green/blue) | | | the rainbow ramp already exists — this is its natural home |
| heat / heatrev / shot1 | pull three swatches from the active `--gold*/--coral*` inks | | | reuse `asciibg/theme-palette.js` inks |

Offer a **literal-RGB variant gated to one theme** (or a `?bands=rgb` boot param) for the pure
look the reference has, but ship theme-triad as the default. This keeps the wow without a
palette collision.

### 1b. Where to put them — placement options

| Option | What | Pros | Cons | Verdict |
|--------|------|------|------|---------|
| **A. Hero-contained ribbon layer** | Full-width bands centered on the title band, masked to fade out before the grid | The hero is the wow real estate; white-convergence lands *right behind the title*; contained = won't fight the grid | Stacks a 2nd animated layer over an already-animated background in the hero | **Recommended headline** |
| **B. Upgrade `.blobs` → additive RGB metaballs** | Replace the 3 static blurred blobs with 3 slow-drifting blurred RGB blobs, `mix-blend-mode: screen`, converging white on overlap | Reuses an existing calm z-slot (flagged "maybe retire"); works in **all four modes** (it's CSS, mode-independent); ~zero new risk; can be pure CSS | Subtle (bokeh, not ribbons) — less literally "bands" | **Recommended low-risk cousin — do this regardless** |
| C. Section horizon | A single RGB band as the seam between hero and grid | Cheap, structural | Small moment, easy to miss | Optional garnish |
| D. Under hovered card | Bands sweep beneath a hovered card | — | Card hover is already crowded (spotlight + streaks + border comet) | **Skip** |

**Recommendation: do A *and* B.** They're the same physics at two scales — B is the ambient,
always-on whisper (ships in an afternoon, pure CSS, every mode); A is the deliberate hero
set-piece. Together they make the RGB-white motif feel like a *system*, not a sticker.

### 1c. Concrete geometry for the hero bands (A)

Answering "how big / where" directly:

- **Coverage:** full viewport width; vertically centered on the title's optical center. Mask
  with a vertical gradient so the layer is 0 at the very top and fades out by ~`75vh` (never
  bleeds into the grid).
- **Count:** 3 base bands (the triad). Optional +3 phase-offset copies for a richer moiré if it
  reads too sparse — but start at 3.
- **Amplitude:** each band is a lazy sine, **~8–14 vh** peak-to-trough. Big enough to feel
  liquid, small enough that the three stay roughly stacked so they *cross often* (crossings =
  the payoff).
- **Wavelength:** **~70–90 vw** — barely more than one full S across the screen. Long and slow,
  not zig-zag.
- **Band thickness:** gaussian falloff, **~7–10 vh** core. Soft edges are mandatory (blur
  ~40–60px) or additive overlap looks like clipping, not light.
- **Motion:** phase drift **~0.04–0.08 rad/s** — meditative, near-subliminal. Vertical bob even
  slower. This must feel like breathing, not scrolling.
- **Opacity:** ~0.45–0.6 per band so triple-overlap saturates to near-white while singles stay
  tinted.
- **Interaction (the upgrade that makes it a *lab* effect):** bend the bands toward/away from
  the cursor — reuse the exact mouse the kinetic title already tracks. Even better: let the
  **white-convergence knot follow the pointer**, so moving the mouse "focuses" the three
  channels into white like aligning a prism. That single behavior is the difference between
  "nice gradient" and "wow."

### 1d. Rendering per mode (so it fits, not floats)

- **Fluid OFF (classic):** standalone additive `<canvas>` (or CSS) layer over wavegrid, under
  the wrap. Simplest; ship here first.
- **Fluid ON + ASCII OFF (raw dye):** same additive canvas over the dye — additive-on-additive
  composites cleanly.
- **Fluid ON + ASCII ON (glyph lattice):** two paths —
  - *Cheap:* render the same additive canvas layer; it sits over the glyphs in the hero only.
  - *Native (phase 2, higher wow):* inject the band color profile as **ambient dye at the top
    edge** each frame via the existing `ambient`/`fluid.splat` system, so the lattice itself
    shows RGB glyph bands drifting down and the ASCII quantization does the "combine" for free.
    This is the chef's-kiss version but more wiring — note it as a follow-up, not v1.

### 1e. Effort / risk

- **B (metaball blobs):** ~half a day, pure CSS, reversible, all modes. **Do first.**
- **A v1 (hero canvas layer, theme-triad, cursor-focus):** ~1–2 days. Contained, low risk.
- **A phase 2 (inject into fluid lattice):** +1–2 days, medium risk (touches the sim loop).

---

## 2. Other wow ideas (ranked by wow-per-effort)

Ranked. Each names the existing hook it reuses — that's why they're cheap and why they'll feel
*integrated* rather than bolted on.

### ★★★ A. Scroll-reveal shockwave into the fluid (mode parity)

The reveal `IntersectionObserver` already fires `window.waveGrid.impulse(...)` at each card as
it surfaces — **but only in classic mode.** In fluid/ASCII modes, nothing. Add a matching
`fluid.splat()` velocity+dye ring at the card's screen position on reveal. Suddenly the fluid
lattice *reacts to your scroll* the way the wavegrid already does — the whole page breathes as
you move down it.
*Reuses:* the existing reveal observer + `fluid.splat`. **Effort: low. Risk: low. Value: high.**

### ★★★ B. Chromatic aberration on the hero title as it dollies away

The hero-parallax script already computes scroll progress `p`. Feed `p` into an RGB channel
split on the title (three offset text layers, or a filter), so as the hero recedes it
**separates into red/green/blue fringes** — an optical lens effect that also *reinforces the
RGB-bands motif* for cohesion. On-brand (optics), nearly free, and it makes scrolling away from
the hero feel like a camera rack-focus.
*Reuses:* hero-parallax `p`. **Effort: low. Risk: low. Value: high.**

### ★★ C. Idle "attract mode"

wavegrid already plays a load "overture" (3 scripted raindrops). Extend the concept: after
~8–12 s of no pointer/scroll, the scene performs itself — scripted splats bloom across the
fluid, the gimbal spins up, a dye band sweeps. Portfolio pages sit open on a second monitor;
this rewards the idle glance and demos the interactivity to someone who hasn't touched it.
*Reuses:* `fluid.splat` / `waveGrid.impulse` / cardan. **Effort: medium. Value: high (for a portfolio).**

### ★★ D. Theme switch as a physical wavefront

Switching theme currently just crossfades CSS vars (0.4 s). Make it an *event*: a bright
wavefront sweeps across the page — a full-width dye pulse (fluid mode), a big radial ripple
(`waveGrid.impulse` at screen center, classic mode). Turns a mundane toggle into a moment, and
sells the "everything is one reactive surface" idea.
*Reuses:* impulse APIs, the `themechange` event. **Effort: medium. Risk: low.**

### ★★ E. Filter-pill dye burst

Clicking a filter already runs a FLIP animation. Simultaneously inject dye **in that category's
accent color** (physics=gold, rendering=coral, algorithms=green) into the fluid at the filter
bar. Deepens the existing two-way UI↔fluid coupling and color-codes the interaction.
*Reuses:* `fluid.splat`, category colors. **Effort: low. Risk: low.**

### ★ F. 2.5D parallax on card previews

Each card caches its rect on `mouseenter` (for the spotlight). Reuse it to parallax-shift the
card's micro-preview canvas contents opposite the cursor — the preview gains depth, so the grid
(Act II) gets the dimensionality the hero has. Subtle but premium-feeling.
*Reuses:* cached card rect + `cardpreviews.js`. **Effort: medium. Risk: low.**

### ★ G. Cursor as a shared light source

Unify the interaction metaphor: a soft additive glow follows the cursor across the *whole* hero
(not just per-card), so the title repel, the fluid parting, and the wavegrid yaw all read as
reactions to **one light** you're carrying. Ties the disparate cursor behaviors into a single
mental model.
*Reuses:* the document-level mousemove already wired for the title. **Effort: medium.**

---

## 3. Recommended shortlist (what I'd actually ship, in order)

1. **`.blobs` → additive RGB metaballs** (§1b-B). Half a day, pure CSS, every mode, reversible.
   Establishes the RGB-white motif site-wide as an ambient whisper.
2. **Scroll-reveal shockwave into the fluid** (§2-A). Closes the glaring mode-parity gap; makes
   the default (fluid) mode feel as alive on scroll as classic mode.
3. **Chromatic aberration on the hero title** (§2-B). Cheap, reinforces the RGB motif, makes
   the scroll-away cinematic.
4. **Hero RGB ribbon layer with cursor-focus convergence** (§1c). The headline set-piece. Ship
   the theme-triad version; expose a `?bands=rgb` / dedicated-theme literal-RGB variant.
5. *(Later)* Inject the bands into the fluid lattice as ambient dye (§1d) + idle attract mode
   (§2-C).

**The through-line:** items 1, 3, 4 are all the *same additive-RGB-converging-to-white physics*
at three scales (ambient blobs → title fringe → hero ribbons). That repetition is what turns a
single borrowed effect into a signature the site owns. Items 2 and 5 are connective tissue that
make the four modes feel like one reactive world instead of four wallpapers.

**Guardrails:** the hero already carries fluid + gimbal + kinetic title + parallax. Adding the
ribbon layer there means *one* of them may need to yield (e.g., calm the ambient dye emission in
the hero band, or dim the gimbal while bands are focused) so the composition stays legible.
Watch mobile perf — gate the ribbon canvas + metaball animation behind the existing
`isMobile` / `prefers-reduced-motion` checks, same as `asciibg` already does.
