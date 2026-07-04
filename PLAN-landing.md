# Landing cinematic — step plan

Rules: one step at a time. Each step = small diff, own verify, own commit (user commits).
Verify tool: `web-screenshot` skill (PowerShell, not Git Bash).

## Phase A — land current work (in working tree now)

- [ ] **A1. Review + commit the cinematic pass** — *diff reviewed 2026-07-04, screenshots green; commit pending (user)*
  Files already changed: `index.html`, `wavegrid.js` (scroll dolly, IO reveals, iris, sticky
  filter bar, focus/aria, hero 100svh, overture ripples).
  Verify: `git diff` read-through; screenshots already green (hero/grid/mobile, 0 errors).
  Manual spot-check in real browser: scroll feel, card click iris, back button, theme cycle,
  filter FLIP after scrolling only halfway down.

## Phase B — demo-page arrival fade (closes the iris cut)

- [x] **B1. Arrival fade in `CSS/theme.css`** — *done: 320ms body opacity fade, RM-gated; FlowField + Raycaster verified, 0 errors*
  ~10 lines: page-level fade-in (body opacity keyframe ~300ms) + reduced-motion off.
  Affects demo pages only (index doesn't load theme.css). Check no flash on slow-loading
  canvas demos (fade runs during, not after, module init).
  Verify: screenshot `FlowField/FlowField.html` + one legacy demo (`Raycaster`), 0 errors.
- [x] **B2. Tune iris↔fade overlap** — *no code change needed: theme.js is parser-blocking
  at body end so theme class + bg color land before first paint (color-matched cut), and the
  arrival fade runs on every load so it always catches the iris. 460ms delay kept.
  Remaining: real-browser feel check (user).*
- [x] **B3. Return-to-catalog scroll memory** — *iris click stores `{y, href}` in
  sessionStorage; fresh index load (demo "← Home" or back without bfcache) jumps straight
  back to the catalog position and winks the origin card (border comet + preview for 1.3s).
  bfcache restores consume the marker unused. Also: all prefers-reduced-motion gates removed
  from the new work per plan-rule change (wavegrid dolly/yaw/overture, card reveals, cue,
  kinetic letters, parallax, iris, arrival fade, view transitions).*

## Phase C — View Transitions progressive upgrade

- [x] **C1. `@view-transition { navigation: auto }`** — *done in both index inline CSS and
  theme.css, 260ms old/new(root) durations, wrapped in prefers-reduced-motion: no-preference
  (unsupporting browsers drop the unknown at-rule harmlessly). Index + Waves verified, 0 errors.*
- [x] **C2. Iris/VT coexistence** — *decision changed from "skip iris when VT supported":
  iris is the signature match-cut, a bare root crossfade is weaker. Iris always plays; VT
  (Chrome 126+) crossfades the document swap underneath it. No JS change needed.
  Remaining: real-browser nav check both directions (user).*

## Phase D — featured band (biggest step, split hard)

- [ ] **D1. Static band**: new section between hero and catalog. 3 tiles (Fluid, Gravity GPU,
  Physarum), class `.feat-card` — NOT `.card` (would break demo-count badge, CAT_MAP,
  cardpreviews ORDER). Layout + copy only, no canvases yet.
  Verify: badge still "23 demos", filters untouched, mobile stack.
- [ ] **D2. Expose preview engine**: refactor `cardpreviews.js` to publish draw fns
  (`window.CardPreviews.draw(idx, ctx, w, h, t)` or similar) without changing card behavior.
  Verify: hover previews on grid cards still work.
- [ ] **D3. Always-on feat canvases**: reuse exposed draw fns on the 3 tiles, single rAF loop,
  pause when offscreen (IO) + `document.hidden`. RM gate: static first frame.
  Verify: screenshot band, CPU sane (no loop when scrolled past).
- [ ] **D4. Wire feat tiles into reveal + iris** (same IO class + click handler via shared
  selector). Verify: click transition works from band.

## Phase E — dynamic theme-color meta (tiny)

- [ ] **E1.** Sync `<meta name="theme-color">` on theme cycle: index inline script +
  `JS/theme.js` for demo pages (map: dark #181210, light #faf5ee, viper #030806).
  Verify: mobile Chrome chrome color follows toggle.

## Phase F — depth haze (optional polish)

- [ ] **F1.** `wavegrid.js` fragment: alpha falloff with distance (pass w0 as varying,
  far rows fade). Tune per theme so light mode doesn't wash out.
  Verify: screenshots all 3 themes, dark + light contrast of far rows.

## Parking lot (not scheduled)

- Hero title copy pass ("Make it interactive." vs physics-specific line)
- Scroll-cue hide permanently after first full scroll
- Demo pages: shared "back to lab" transition (reverse iris)
