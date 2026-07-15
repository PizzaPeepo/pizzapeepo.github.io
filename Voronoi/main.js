import { triangulate, voronoiEdges } from "./Delaunay.js";
import { createAsciiGL, MAX_SITES } from "./asciiGL.js";

// Voronoi edges as crisp vector lines (dual of the Delaunay triangulation),
// Delaunay mesh via Bowyer-Watson. Sites drift and bounce.

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var siteCount = 28;
var motion = 0.8;
var view = "cells";   // cells | delaunay | both
var mode = "drift";   // drift | grow (flood fill)
var showPoints = true;
var paused = false;

var growR = 0;        // current flood-fill front radius
var growing = false;
var growSpeed = 1;    // px per frame
var growFill = 1;     // territory tint fade (1 -> 0 after completion)
var donePulse = 0;    // wall flash when growth completes (1 -> 0)
var asciiField = true; // render flooded territory as an ASCII glyph field
var runners = [];      // data packets riding finished walls (ASCII mode)
var asciiSegs = null;  // cached in-canvas wall geometry for the runners

var sites = [];        // {x, y, vx, vy}
// Bumped whenever a site is added, removed or moved. Everything derived from the
// site positions (Delaunay tris, Voronoi segs, site adjacency) is cached against
// it — in grow/ascii modes the sites never move, so the whole geometry pipeline
// runs once instead of two full Bowyer-Watson passes per frame.
var siteVersion = 0;
var WAVE_MAXR = 900;   // interior-wave period, in px of geodesic distance (mirrors maxR in asciiGL.js)
var WAVE_HOVER_PERIOD = 4000;  // ms between successive hover-ring launches — the one knob to tune
var WAVE_HOVER_SPD = 0.5;      // hover-ring speed, px per ms (mirrors the *0.5 in asciiGL.js glyphFrag)
var WAVE_HOVER_SPACING = WAVE_HOVER_PERIOD * WAVE_HOVER_SPD; // geodesic px between rings (fed to GL as uWaveS)
var WAVE_HOVER_MAXR = 2 * WAVE_HOVER_SPACING; // death radius: amplitude 1−R/maxR reaches 0 exactly when the ring's 2nd successor launches
var waveT0 = -1;       // timestamp of the last hovered-cell change; hover rings launch from it
var lastHoverI = -1;

var isLight = document.documentElement.classList.contains("light");
var isViper = document.documentElement.classList.contains("viper");
// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");

// phosphor persistence buffers — ping-pong pair per the CLAUDE.md canvas-fade
// notes (drawImage decay truncates to a clean zero; destination-out ghosts)
var trailA = document.createElement("canvas");
var trailB = document.createElement("canvas");
var trailACtx = trailA.getContext("2d");
var trailBCtx = trailB.getContext("2d");

// quarter-res buffer for the cheap downscale bloom
var bloomCanvas = document.createElement("canvas");
var bloomCtx = bloomCanvas.getContext("2d");

// ASCII-flood mode runs on the GPU (see asciiGL.js) over a second, layered
// WebGL2 canvas; the 2D canvas above drives every other mode. GL is created
// lazily on first entry into ASCII mode so non-ASCII visitors never pay for it.
var glCanvas = document.getElementById("glCanvas");
var asciiGLR = null;      // renderer instance; { available:false } if WebGL2/float-RT missing
var asciiGLReady = false; // usable this session

function applyCanvasSize() {
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";
	// glow-only layers don't need full resolution: trail at 1/2, bloom at 1/4
	trailA.width = trailB.width = Math.max(1, canvasWidth >> 1);
	trailA.height = trailB.height = Math.max(1, canvasHeight >> 1);
	bloomCanvas.width = Math.max(1, canvasWidth >> 2);
	bloomCanvas.height = Math.max(1, canvasHeight >> 2);
	bloomCtx.filter = "blur(2px)"; // ctx state resets on resize — reapply
	glCanvas.style.width = canvasWidth + "px";
	glCanvas.style.height = canvasHeight + "px";
	if (asciiGLReady) asciiGLR.resize(canvasWidth, canvasHeight);
}

// CPU-fallback counterpart of asciiGL's clearTrail()
function clearTrail2D() {
	trailACtx.clearRect(0, 0, trailA.width, trailA.height);
	trailBCtx.clearRect(0, 0, trailB.width, trailB.height);
}
// #endregion

// Theme palette (mirrors CSS tokens in CSS/theme.css: --bg, --gold, --coral, --tx)
// additive: emissive effects may use "lighter" compositing (dark backgrounds only)
function themePalette() {
	if (isViper) return { bgCss: "#030806", edge: [40, 255, 69], coral: [107, 255, 40], point: "#e8ffe0", pointRgb: [232, 255, 224], additive: true };
	if (isLight) return { bgCss: "#faf5ee", edge: [192, 120, 0], coral: [200, 56, 32], point: "#1a1008", pointRgb: [26, 16, 8], additive: false };
	return { bgCss: "#181210", edge: [245, 166, 35], coral: [255, 107, 71], point: "#f5e8d4", pointRgb: [245, 232, 212], additive: true };
}

// Theme colours for the GL ASCII renderer, normalized to 0..1 Float32Arrays.
// Mirrors themePalette() + the ensureEmberLUT() ramps; rebuilt only on theme change.
var glThemeCache = null, glThemeKey = "";
function hex3(h) {
	const v = parseInt(h.slice(1), 16);
	return new Float32Array([((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]);
}
function rgb3(a) { return new Float32Array([a[0] / 255, a[1] / 255, a[2] / 255]); }
function glTheme() {
	const pal = themePalette();
	if (glThemeCache && glThemeKey === pal.bgCss) return glThemeCache;
	const ember = !pal.additive
		? [[122, 31, 10], [200, 56, 32], [196, 88, 16], [192, 120, 0]]
		: isViper
			? [[255, 255, 255], [210, 255, 220], [140, 255, 150], [40, 255, 69]]
			: [[255, 255, 255], [255, 233, 190], [253, 216, 122], [245, 166, 35]];
	glThemeCache = {
		bg: hex3(pal.bgCss), edge: rgb3(pal.edge), coral: rgb3(pal.coral),
		point: rgb3(pal.pointRgb), ember: ember.map(rgb3), additive: pal.additive,
	};
	glThemeKey = pal.bgCss;
	return glThemeCache;
}

// Faint graph-paper dot grid under everything (cached pattern per theme)
var gridPatternKey = "";
var gridPattern = null;
function drawGrid(pal) {
	if (gridPatternKey !== pal.bgCss) {
		const tile = document.createElement("canvas");
		tile.width = tile.height = 28;
		const tctx = tile.getContext("2d");
		tctx.fillStyle = "rgba(" + pal.edge[0] + "," + pal.edge[1] + "," + pal.edge[2] + ",0.13)";
		tctx.fillRect(13, 13, 2, 2);
		gridPattern = ctx.createPattern(tile, "repeat");
		gridPatternKey = pal.bgCss;
	}
	ctx.fillStyle = gridPattern;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}

function makeSite() {
	const a = Math.random() * Math.PI * 2;
	return {
		x: Math.random() * canvasWidth,
		y: Math.random() * canvasHeight,
		vx: Math.cos(a),
		vy: Math.sin(a),
		gr: 0, // per-site flood radius (ASCII mode; invaders start at 0)
	};
}

function buildSites() {
	sites = [];
	for (let i = 0; i < siteCount; i++) sites.push(makeSite());
	growR = 0;
	growing = false;
	asciiSegs = null;
	runners.length = 0;
	siteVersion++;
}

applyCanvasSize();
buildSites();

// #region simulation
function moveSites() {
	const sp = motion;
	for (const s of sites) {
		s.x += s.vx * sp;
		s.y += s.vy * sp;
		if (s.x < 0) { s.x = 0; s.vx = Math.abs(s.vx); }
		else if (s.x > canvasWidth) { s.x = canvasWidth; s.vx = -Math.abs(s.vx); }
		if (s.y < 0) { s.y = 0; s.vy = Math.abs(s.vy); }
		else if (s.y > canvasHeight) { s.y = canvasHeight; s.vy = -Math.abs(s.vy); }
	}
	siteVersion++;
}

// Site-derived geometry, memoized on siteVersion. In drift mode the version bumps
// every frame (so these recompute as before); in grow/ascii mode the sites are
// static and every consumer shares one triangulation.
var _trisCache = null, _trisVer = -1;
function cachedTris() {
	if (_trisVer !== siteVersion) { _trisCache = triangulate(sites); _trisVer = siteVersion; }
	return _trisCache;
}
var _segsCache = null, _segsVer = -1;
function cachedSegs() {
	if (_segsVer !== siteVersion) { _segsCache = computeSegs(); _segsVer = siteVersion; }
	return _segsCache;
}
// Site-to-site adjacency (Delaunay edges) as flat [neighbor, weight, ...] arrays.
var _adjCache = null, _adjVer = -1;
function cachedAdj() {
	if (_adjVer === siteVersion && _adjCache) return _adjCache;
	const n = sites.length;
	const adj = [];
	for (let i = 0; i < n; i++) adj.push([]);
	const seen = new Set();
	function edge(a, b) {
		if (a >= n || b >= n) return;
		if (a > b) { const t = a; a = b; b = t; }
		const k = a * 1000000 + b;
		if (seen.has(k)) return;
		seen.add(k);
		const w = Math.hypot(sites[a].x - sites[b].x, sites[a].y - sites[b].y);
		adj[a].push(b, w); adj[b].push(a, w);
	}
	for (const tr of cachedTris()) { edge(tr.a, tr.b); edge(tr.b, tr.c); edge(tr.c, tr.a); }
	_adjCache = adj;
	_adjVer = siteVersion;
	return adj;
}
// #endregion

// #region render cells
function strokeSegs(segs) {
	ctx.beginPath();
	for (const s of segs) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); }
	ctx.stroke();
}

function computeSegs() {
	const n = sites.length;
	if (n < 2) return [];
	const rayLength = (canvasWidth + canvasHeight) * 2; // long enough to leave the canvas
	if (n === 2) {
		// Voronoi of two sites: their perpendicular bisector
		const a = sites[0], b = sites[1];
		const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
		let dx = -(b.y - a.y), dy = b.x - a.x;
		const len = Math.hypot(dx, dy) || 1;
		dx = dx / len * rayLength; dy = dy / len * rayLength;
		return [{ x1: mx - dx, y1: my - dy, x2: mx + dx, y2: my + dy, px: a.x, py: a.y }];
	}
	return voronoiEdges(sites, cachedTris(), rayLength);
}

function strokeWalls(segs, pal) {
	ctx.lineCap = "round";
	// soft halo pass under a crisp core line; the halo flares with donePulse
	const haloA = Math.min(1, 0.28 + 0.34 * donePulse);
	ctx.strokeStyle = "rgba(" + pal.edge[0] + "," + pal.edge[1] + "," + pal.edge[2] + "," + haloA.toFixed(3) + ")";
	ctx.lineWidth = 3.5 + 9 * donePulse;
	strokeSegs(segs);
	ctx.strokeStyle = "rgb(" + pal.edge[0] + "," + pal.edge[1] + "," + pal.edge[2] + ")";
	ctx.lineWidth = 1.25;
	strokeSegs(segs);
}

// Polygon of site i's cell: the canvas rect clipped by the bisector
// half-plane against every other site (Sutherland-Hodgman).
function cellPolygon(i) {
	const s = sites[i];
	let poly = [[0, 0], [canvasWidth, 0], [canvasWidth, canvasHeight], [0, canvasHeight]];
	for (let j = 0; j < sites.length && poly.length; j++) {
		if (j === i) continue;
		const o = sites[j];
		const mx = (s.x + o.x) / 2, my = (s.y + o.y) / 2;
		const nx = s.x - o.x, ny = s.y - o.y;
		const next = [];
		for (let k = 0; k < poly.length; k++) {
			const a = poly[k], b = poly[(k + 1) % poly.length];
			const da = (a[0] - mx) * nx + (a[1] - my) * ny;
			const db = (b[0] - mx) * nx + (b[1] - my) * ny;
			if (da >= 0) next.push(a);
			if ((da >= 0) !== (db >= 0)) {
				const t = da / (da - db);
				next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
			}
		}
		poly = next;
	}
	return poly;
}

// Border of the cell under the cursor as wall segments (px/py = owner site,
// same shape revealedSubSegs expects). Canvas-boundary edges are dropped so
// only true Voronoi walls light up.
function hoverCellSegs() {
	if (sites.length < 2) return null;
	if (mouseX < 0 || mouseX > canvasWidth || mouseY < 0 || mouseY > canvasHeight) return null;
	const near = nearestSite(mouseX, mouseY);
	if (near.i < 0) return null;
	const s = sites[near.i];
	const poly = cellPolygon(near.i);
	if (poly.length < 3) return null;
	const out = [];
	for (let k = 0; k < poly.length; k++) {
		const a = poly[k], b = poly[(k + 1) % poly.length];
		if ((a[0] < 1 && b[0] < 1) || (a[0] > canvasWidth - 1 && b[0] > canvasWidth - 1)
			|| (a[1] < 1 && b[1] < 1) || (a[1] > canvasHeight - 1 && b[1] > canvasHeight - 1)) continue;
		out.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], px: s.x, py: s.y });
	}
	return out.length ? out : null;
}

// Hovered cell's edges burn brighter than the rest of the diagram: wide halo,
// full-strength accent, then a white-hot core (additive on dark themes).
function strokeHoverSegs(segs, pal) {
	if (pal.additive) ctx.globalCompositeOperation = "lighter";
	ctx.lineCap = "round";
	const e = pal.edge;
	ctx.strokeStyle = "rgba(" + e[0] + "," + e[1] + "," + e[2] + ",0.4)";
	ctx.lineWidth = 8;
	strokeSegs(segs);
	ctx.strokeStyle = "rgb(" + e[0] + "," + e[1] + "," + e[2] + ")";
	ctx.lineWidth = 3;
	strokeSegs(segs);
	ctx.strokeStyle = pal.additive ? "rgba(255,255,255,0.9)" : pal.point;
	ctx.lineWidth = 1.4;
	strokeSegs(segs);
	ctx.globalCompositeOperation = "source-over";
}

function renderCells() {
	const pal = themePalette();
	ctx.fillStyle = pal.bgCss;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	drawGrid(pal);
	const segs = cachedSegs();
	if (segs.length) strokeWalls(segs, pal);
	const hov = hoverCellSegs();
	if (hov) strokeHoverSegs(hov, pal);
}
// #endregion

// #region grow mode (flood fill)
function startGrow() {
	growR = 0;
	for (const s of sites) s.gr = 0;
	growing = true;
	growFill = 1;
	asciiSegs = null;
	runners.length = 0;
}

function segInCanvas(s) {
	const pad = 50;
	return s.x1 > -pad && s.x1 < canvasWidth + pad && s.y1 > -pad && s.y1 < canvasHeight + pad
		&& s.x2 > -pad && s.x2 < canvasWidth + pad && s.y2 > -pad && s.y2 < canvasHeight + pad;
}

// Liang-Barsky half-plane step: shrink [_lbT0, _lbT1] so p·t <= q holds;
// false when the segment misses the half-plane entirely.
var _lbT0 = 0, _lbT1 = 1;
function lbClip(p, q) {
	if (p === 0) return q >= 0;
	const r = q / p;
	if (p < 0) {
		if (r > _lbT1) return false;
		if (r > _lbT0) _lbT0 = r;
	} else {
		if (r < _lbT0) return false;
		if (r < _lbT1) _lbT1 = r;
	}
	return true;
}

// Radius at which every canvas corner is claimed and every in-view Voronoi
// vertex is reached -> growth is visually complete.
function needRadius(segs) {
	let need = 0;
	const pad = 100;
	const corners = [[0, 0], [canvasWidth, 0], [0, canvasHeight], [canvasWidth, canvasHeight]];
	for (const [cx, cy] of corners) {
		let d1 = Infinity;
		for (const s of sites) d1 = Math.min(d1, Math.hypot(s.x - cx, s.y - cy));
		need = Math.max(need, d1);
	}
	for (const s of segs) {
		// clip each wall to the padded canvas and measure both clip endpoints:
		// a Voronoi vertex can appear only as (x2,y2) (a triangle whose shared-
		// edge partners all precede it is never t1 in voronoiEdges), and a wall
		// can cross the canvas with both raw endpoints outside the pad — either
		// undershoots `need` and freezes the flood before the walls close
		const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
		_lbT0 = 0; _lbT1 = 1;
		if (!lbClip(-dx, s.x1 + pad) || !lbClip(dx, canvasWidth + pad - s.x1)
			|| !lbClip(-dy, s.y1 + pad) || !lbClip(dy, canvasHeight + pad - s.y1)) continue;
		need = Math.max(need,
			Math.hypot(s.x1 + dx * _lbT0 - s.px, s.y1 + dy * _lbT0 - s.py),
			Math.hypot(s.x1 + dx * _lbT1 - s.px, s.y1 + dy * _lbT1 - s.py));
	}
	return need;
}

function advanceGrow(segs) {
	if (growing && !paused) {
		const need = needRadius(segs);
		growR += growSpeed;
		if (growR >= need + 12) { growR = need + 12; growing = false; donePulse = 1; }
	}
	donePulse *= 0.95;
}

// ASCII mode advances every site's own radius, so late-added sites (invaders)
// flood from zero into the standing map while the rest holds its ground.
function advanceAsciiGrow(segs) {
	if (growing && !paused) {
		const need = needRadius(segs);
		let minGr = Infinity;
		for (const s of sites) { s.gr += growSpeed; if (s.gr < minGr) minGr = s.gr; }
		if (minGr >= need + 12) { growing = false; donePulse = 1; asciiSegs = segs.filter(segInCanvas); }
	}
	donePulse *= 0.95;
}

// Portion of each Voronoi edge already reached by both fronts: points p on the
// segment with |p - site| <= R (both generating sites are equidistant there).
// Unclamped roots inside (0,1) are the live collision points where two fronts
// are welding the wall right now — returned as spark positions.
function revealedSubSegs(segs, R) {
	const out = [];
	const sparks = [];
	for (const s of segs) {
		const ax = s.x1 - s.px, ay = s.y1 - s.py;
		const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
		const a = dx * dx + dy * dy;
		if (a < 1e-12) continue;
		const b = 2 * (dx * ax + dy * ay);
		const c = ax * ax + ay * ay - R * R;
		const disc = b * b - 4 * a * c;
		if (disc <= 0) continue;
		const sq = Math.sqrt(disc);
		let t0 = (-b - sq) / (2 * a), t1 = (-b + sq) / (2 * a);
		if (t0 > 0 && t0 < 1) sparks.push([s.x1 + dx * t0, s.y1 + dy * t0]);
		if (t1 > 0 && t1 < 1) sparks.push([s.x1 + dx * t1, s.y1 + dy * t1]);
		if (t0 < 0) t0 = 0;
		if (t1 > 1) t1 = 1;
		if (t1 - t0 <= 0) continue;
		out.push({ x1: s.x1 + dx * t0, y1: s.y1 + dy * t0, x2: s.x1 + dx * t1, y2: s.y1 + dy * t1 });
	}
	return { segs: out, sparks: sparks };
}

function drawSparks(pal, sparks) {
	if (pal.additive) ctx.globalCompositeOperation = "lighter";
	const e = pal.edge;
	const halo = "rgba(" + e[0] + "," + e[1] + "," + e[2] + ",0.14)";
	const mid = "rgba(" + e[0] + "," + e[1] + "," + e[2] + ",0.4)";
	const core = pal.additive ? "rgba(255,255,255,0.95)" : pal.point;
	for (const [x, y] of sparks) {
		const flick = 0.8 + Math.random() * 0.5;
		ctx.fillStyle = halo;
		ctx.beginPath(); ctx.arc(x, y, 9 * flick, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = mid;
		ctx.beginPath(); ctx.arc(x, y, 3.8 * flick, 0, Math.PI * 2); ctx.fill();
		ctx.fillStyle = core;
		ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill();
	}
	ctx.globalCompositeOperation = "source-over";
}

// Flooded territory as a living ASCII glyph lattice (nod to the index page):
// brightness ripples inward from the wavefront, cells keep their owner's
// accent (gold/coral alternating), and glyphs near finished walls stay dense.
var GLYPH_RAMP = [" ", ".", "·", ":", "-", "=", "+", "*", "#", "@"];
var glyphLUTKey = "";
var glyphLUT = null; // [2 colors][10 levels] fill styles
function ensureGlyphLUT(pal) {
	if (glyphLUTKey === pal.bgCss) return;
	glyphLUT = [[], []];
	const cols = [pal.edge, pal.coral];
	for (let ci = 0; ci < 2; ci++) {
		for (let l = 0; l < 10; l++) {
			const al = (0.05 + 0.075 * l).toFixed(3);
			glyphLUT[ci].push("rgba(" + cols[ci][0] + "," + cols[ci][1] + "," + cols[ci][2] + "," + al + ")");
		}
	}
	glyphLUTKey = pal.bgCss;
}

// Glyph atlas: each (char, style, weight) combination is rasterized once into
// a sprite sheet and stamped with drawImage afterwards — thousands of
// per-frame fillText calls were the ASCII mode's dominant cost.
var atlasCanvas = document.createElement("canvas");
atlasCanvas.width = 512;
atlasCanvas.height = 512;
var atlasCtx = atlasCanvas.getContext("2d");
var atlasMap = new Map();
var atlasNext = 0;
var ATLAS_COLS = 32, ATLAS_SLOT = 16;
function atlasReset() {
	atlasMap.clear();
	atlasNext = 0;
	atlasCtx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
}
// rebake once the real webfont arrives (early frames cache fallback glyphs)
if (document.fonts && document.fonts.ready) document.fonts.ready.then(atlasReset);

function atlasStamp(tctx, ch, style, bold, x, y, size) {
	const key = (bold ? "B" : "n") + style + ch;
	let idx = atlasMap.get(key);
	if (idx === undefined) {
		if (atlasNext >= 1024) atlasReset();
		idx = atlasNext++;
		const bx = (idx % ATLAS_COLS) * ATLAS_SLOT, by = ((idx / ATLAS_COLS) | 0) * ATLAS_SLOT;
		atlasCtx.font = bold ? "600 13px 'IBM Plex Mono', monospace" : "12px 'IBM Plex Mono', monospace";
		atlasCtx.textAlign = "center";
		atlasCtx.textBaseline = "middle";
		atlasCtx.fillStyle = style;
		atlasCtx.fillText(ch, bx + 8, by + 8);
		atlasMap.set(key, idx);
	}
	const ax = (idx % ATLAS_COLS) * ATLAS_SLOT, ay = ((idx / ATLAS_COLS) | 0) * ATLAS_SLOT;
	tctx.drawImage(atlasCanvas, ax, ay, ATLAS_SLOT, ATLAS_SLOT, x - size * 0.5, y - size * 0.5, size, size);
}

function drawGlyphField(pal, R, now) {
	ensureGlyphLUT(pal);
	const gs = 15;
	const n = sites.length;
	const boost = 1 + donePulse * 0.8;
	for (let gy = gs * 0.5; gy < canvasHeight; gy += gs) {
		for (let gx = gs * 0.5; gx < canvasWidth; gx += gs) {
			let d1 = Infinity, d2 = Infinity, own = 0;
			for (let s = 0; s < n; s++) {
				const dx = gx - sites[s].x, dy = gy - sites[s].y;
				const d = dx * dx + dy * dy;
				if (d < d1) { d2 = d1; own = s; d1 = d; }
				else if (d < d2) { d2 = d; }
			}
			const r1 = Math.sqrt(d1);
			if (r1 > R) continue;
			const age = R - r1;
			const base = Math.max(0.24, 1 - age / 1000);
			const rip = 0.55 + 0.45 * Math.sin(age * 0.045 - now * 0.002);
			let lvl = Math.round(base * rip * boost * 9);
			// wall glow: both fronts arrived and the border is close by
			if (d2 !== Infinity) {
				const r2 = Math.sqrt(d2);
				if (r2 <= R && r2 - r1 < 12 && lvl < 6) lvl = 6;
			}
			if (lvl < 1) continue;
			if (lvl > 9) lvl = 9;
			atlasStamp(ctx, GLYPH_RAMP[lvl], glyphLUT[own % 2][lvl], false, gx, gy, ATLAS_SLOT);
		}
	}
}

// Expanding wavefronts: each site's circle of radius R, minus the angular
// spans that already collided with a neighbour's front (past the bisector,
// half-angle acos(h/R) toward that neighbour).
function drawFronts(pal, R) {
	const TAU = Math.PI * 2;
	const n = sites.length;
	ctx.beginPath();
	for (let i = 0; i < n; i++) {
		const s = sites[i];
		if (s.x + R < 0 || s.x - R > canvasWidth || s.y + R < 0 || s.y - R > canvasHeight) continue;
		const blocked = [];
		let covered = false;
		for (let j = 0; j < n; j++) {
			if (j === i) continue;
			const dx = sites[j].x - s.x, dy = sites[j].y - s.y;
			const h = Math.hypot(dx, dy) / 2;
			if (h >= R) continue;
			if (h < 1e-6) { covered = true; break; } // coincident sites
			const phi = Math.acos(h / R);
			let a0 = (Math.atan2(dy, dx) - phi) % TAU;
			if (a0 < 0) a0 += TAU;
			let a1 = a0 + 2 * phi;
			if (a1 > TAU) { blocked.push([0, a1 - TAU]); a1 = TAU; }
			blocked.push([a0, a1]);
		}
		if (covered) continue;
		let arcs;
		if (blocked.length === 0) {
			arcs = [[0, TAU]];
		} else {
			blocked.sort(function (p, q) { return p[0] - q[0]; });
			arcs = [];
			let cur = 0;
			for (const [b0, b1] of blocked) {
				if (b0 > cur) arcs.push([cur, b0]);
				if (b1 > cur) cur = b1;
			}
			if (cur < TAU) arcs.push([cur, TAU]);
		}
		for (const [a0, a1] of arcs) {
			ctx.moveTo(s.x + R * Math.cos(a0), s.y + R * Math.sin(a0));
			ctx.arc(s.x, s.y, R, a0, a1);
		}
	}
	// three strokes of the same path: wide soft glow under a crisp leading edge
	ctx.strokeStyle = pal.point;
	ctx.globalAlpha = 0.1;
	ctx.lineWidth = 7;
	ctx.stroke();
	ctx.globalAlpha = 0.28;
	ctx.lineWidth = 3;
	ctx.stroke();
	ctx.globalAlpha = 0.9;
	ctx.lineWidth = 1.1;
	ctx.stroke();
	ctx.globalAlpha = 1;
}

function renderGrow(now) {
	const pal = themePalette();
	ctx.fillStyle = pal.bgCss;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	drawGrid(pal);
	const n = sites.length;
	if (n === 0) return;
	const segs = cachedSegs();

	// growth finished and tint faded out: completed diagram over the glyph field
	if (!growing && growR > 0 && growFill <= 0.005) {
		donePulse *= 0.95;
		if (asciiField) drawGlyphField(pal, growR, now);
		if (segs.length) strokeWalls(segs, pal);
		const hovDone = hoverCellSegs();
		if (hovDone) strokeHoverSegs(hovDone, pal);
		return;
	}

	advanceGrow(segs);
	if (growR <= 0) return;

	// flooded territory: the union of discs equals the union of claimed cells
	if (growFill > 0.005) {
		ctx.fillStyle = "rgba(" + pal.edge[0] + "," + pal.edge[1] + "," + pal.edge[2] + "," + (0.05 * growFill).toFixed(3) + ")";
		ctx.beginPath();
		for (const s of sites) { ctx.moveTo(s.x + growR, s.y); ctx.arc(s.x, s.y, growR, 0, Math.PI * 2); }
		ctx.fill();
	}
	if (!growing && !paused) growFill = Math.max(0, growFill - 0.015);

	if (asciiField) drawGlyphField(pal, growR, now);

	const built = revealedSubSegs(segs, growR);
	if (built.segs.length) strokeWalls(built.segs, pal);

	// hover highlight only on wall portions the flood has already welded
	const hov = hoverCellSegs();
	if (hov) {
		const rev = revealedSubSegs(hov, growR).segs;
		if (rev.length) strokeHoverSegs(rev, pal);
	}

	drawFronts(pal, growR);
	if (built.sparks.length) drawSparks(pal, built.sparks);
}

// Dedicated all-ASCII flood: territory, walls, wavefronts and site markers
// are all glyphs on one lattice — no vector strokes at all. Each site owns a
// letter; its territory spells it. Fresh wall cells run white-hot ("ember")
// and cool into the theme accent. The cursor heats nearby glyphs.
var FRONT_RAMP = [":", "+", "*", "@"];
var SITE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
var emberLUTKey = "";
var emberLUT = null; // hot -> settled wall styles
function ensureEmberLUT(pal) {
	if (emberLUTKey === pal.bgCss) return;
	emberLUT = !pal.additive
		? ["rgba(122,31,10,0.95)", "rgba(200,56,32,0.92)", "rgba(196,88,16,0.9)", "rgba(192,120,0,0.88)"]
		: isViper
			? ["rgba(255,255,255,0.95)", "rgba(210,255,220,0.95)", "rgba(140,255,150,0.92)", "rgba(40,255,69,0.88)"]
			: ["rgba(255,255,255,0.95)", "rgba(255,233,190,0.95)", "rgba(253,216,122,0.92)", "rgba(245,166,35,0.88)"];
	emberLUTKey = pal.bgCss;
}

// GPU path: create the renderer on first use; falls back to the CPU version
// below if WebGL2 or float render targets are unavailable.
function ensureAsciiGL() {
	if (asciiGLR) return asciiGLReady;
	asciiGLR = createAsciiGL(glCanvas);
	asciiGLReady = asciiGLR.available;
	if (asciiGLReady) asciiGLR.resize(canvasWidth, canvasHeight);
	return asciiGLReady;
}
function showAsciiCanvas() {
	if (glCanvas.style.display === "block") return;
	glCanvas.style.display = "block";
	backgroundCanvas.style.visibility = "hidden";
}
function hideAsciiCanvas() {
	if (glCanvas.style.display === "none") return;
	glCanvas.style.display = "none";
	backgroundCanvas.style.visibility = "";
}

// Wave-phase offset per site, feeding the interior ripple (see the glyph shader).
// Hovering: Dijkstra over the Delaunay (Voronoi) adjacency seeded at the hovered
// site (dist = 0 there, not cursor distance — anchoring at the site keeps the
// whole field stable while the cursor roams inside one cell), so the ripple
// propagates cell-to-cell across shared borders instead of as a raw Euclidean
// circle. Not hovering: each site gets a fixed golden-angle phase spread
// over the wave period, so the field keeps breathing (out of step, never in
// unison) instead of freezing into a still image.
// Returns a reused Float64Array. Cheap: n ≤ a few hundred, O(n²) Dijkstra.
var _geoDist = new Float64Array(0);
var _geoDone = new Uint8Array(0);
function computeGeoDist(mSite) {
	const n = sites.length;
	if (_geoDist.length < n) { _geoDist = new Float64Array(n); _geoDone = new Uint8Array(n); }
	const dist = _geoDist;
	if (mSite < 0 || mSite >= n) {
		for (let i = 0; i < n; i++) dist[i] = (i * 137.508) % WAVE_MAXR;
		return dist;
	}
	for (let i = 0; i < n; i++) dist[i] = Infinity;
	if (n < 3) { // no triangulation possible — fall back to straight site distances
		for (let i = 0; i < n; i++) dist[i] = Math.hypot(sites[i].x - sites[mSite].x, sites[i].y - sites[mSite].y);
		dist[mSite] = 0;
		return dist;
	}
	const adj = cachedAdj();
	dist[mSite] = 0;
	const done = _geoDone;
	done.fill(0, 0, n);
	for (let it = 0; it < n; it++) {
		let u = -1, best = Infinity;
		for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
		if (u < 0) break;
		done[u] = 1;
		const a = adj[u];
		for (let e = 0; e < a.length; e += 2) {
			const nd = dist[u] + a[e + 1];
			if (nd < dist[a[e]]) dist[a[e]] = nd;
		}
	}
	return dist;
}

// Hover rings are launched, not free-running: entering a cell stamps waveT0 and
// the ring expands from radius 0 at the hovered site, so the wave is visibly
// born at the cursor's cell instead of appearing mid-flight.
function trackHoverWave(hoverI, now) {
	if (hoverI !== lastHoverI) { lastHoverI = hoverI; waveT0 = now; }
	return hoverI >= 0 ? waveT0 : -1;
}

// Comet-crest sample at geodesic distance W (mirrors the GL glyph shader):
// razor leading edge, long trailing tail. Sets _crest (brightness drive) and
// _hot (color temperature — cools as the ring expands and its amplitude dies).
// Callers guard on hoverI >= 0.
var _crest = 0, _hot = 0;
function crestAt(W, now) {
	_crest = 0; _hot = 0;
	const t = (now - waveT0) * WAVE_HOVER_SPD, S = WAVE_HOVER_SPACING;
	const Ra = t % S, xa = W - Ra;
	const pa = xa > 0 ? Math.exp(-xa * xa / 128) : Math.exp(-xa * xa / 1250);
	const wa = xa < 0 ? Math.exp(xa / 200) : 0;
	const aa = 1 - Ra / WAVE_HOVER_MAXR;
	_crest = (pa + 0.25 * wa) * aa; _hot = pa * aa * aa;
	if (t >= S) {
		const Rb = Ra + S, xb = W - Rb;
		const pb = xb > 0 ? Math.exp(-xb * xb / 128) : Math.exp(-xb * xb / 1250);
		const wb = xb < 0 ? Math.exp(xb / 200) : 0;
		const ab = 1 - Rb / WAVE_HOVER_MAXR;
		_crest += (pb + 0.25 * wb) * ab;
		const hb = pb * ab * ab;
		if (hb > _hot) _hot = hb;
	}
}

function renderAsciiFloodGL(now) {
	const n = sites.length;
	let hoverI = -1;
	if (n >= 2 && mouseX >= 0 && mouseX <= canvasWidth && mouseY >= 0 && mouseY <= canvasHeight) hoverI = nearestSite(mouseX, mouseY).i;
	const geo = computeGeoDist(hoverI);
	const wT0 = trackHoverWave(hoverI, now);
	// growth + wall geometry stay on the CPU; the triangulation is memoized on
	// siteVersion, and ASCII-mode sites never move, so this is a no-op per frame
	if (n > 0 && growing) advanceAsciiGrow(cachedSegs());
	else donePulse *= 0.95;
	asciiGLR.render({
		sites: sites, n: n, now: now, hoverI: hoverI, waveT0: wT0, geo: geo, waveS: WAVE_HOVER_SPACING,
		donePulse: donePulse, mouseX: mouseX, mouseY: mouseY,
		showPoints: showPoints, paused: paused, theme: glTheme(),
	});
}

function renderAsciiFlood(now) {
	const pal = themePalette();
	ctx.fillStyle = pal.bgCss;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	ensureGlyphLUT(pal);
	ensureEmberLUT(pal);
	const n = sites.length;

	// hovered cell: its wall glyphs render at full point-color heat
	let hoverI = -1;
	if (n >= 2 && mouseX >= 0 && mouseX <= canvasWidth && mouseY >= 0 && mouseY <= canvasHeight) hoverI = nearestSite(mouseX, mouseY).i;
	const geo = computeGeoDist(hoverI);
	trackHoverWave(hoverI, now);

	if (n > 0 && growing) {
		advanceAsciiGrow(cachedSegs());
	} else {
		donePulse *= 0.95;
	}

	const gs = 15;
	const e = pal.edge;
	const paperStyle = "rgba(" + e[0] + "," + e[1] + "," + e[2] + ",0.07)";
	const band = gs * 0.42;   // wavefront-ring half-width (thinner = crisper front)
	const boost = 1 + donePulse * 0.8;
	const pr = pal.pointRgb;
	// quantized styles so every draw goes through the glyph atlas
	const frontStyles = [
		"rgba(" + pr[0] + "," + pr[1] + "," + pr[2] + ",0.5)",
		"rgba(" + pr[0] + "," + pr[1] + "," + pr[2] + ",0.65)",
		"rgba(" + pr[0] + "," + pr[1] + "," + pr[2] + ",0.8)",
		"rgba(" + pr[0] + "," + pr[1] + "," + pr[2] + ",0.95)",
	];
	const paperHotStyles = [
		"rgba(" + e[0] + "," + e[1] + "," + e[2] + ",0.17)",
		"rgba(" + e[0] + "," + e[1] + "," + e[2] + ",0.27)",
		"rgba(" + e[0] + "," + e[1] + "," + e[2] + ",0.37)",
		"rgba(" + e[0] + "," + e[1] + "," + e[2] + ",0.47)",
	];

	// per-site tables: squared radii + front-ring bounds keep the hot cell
	// loop in squared space (sqrt only for the few winners per cell)
	const sxA = new Float64Array(n), syA = new Float64Array(n), sgA = new Float64Array(n);
	const sg2A = new Float64Array(n), fInA = new Float64Array(n), fOutA = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const st = sites[i];
		sxA[i] = st.x;
		syA[i] = st.y;
		sgA[i] = st.gr;
		sg2A[i] = st.gr * st.gr;
		const inn = Math.max(0, st.gr - band);
		fInA[i] = inn * inn;
		fOutA[i] = (st.gr + band) * (st.gr + band);
	}

	const wallCells = []; // x, y, ember-bucket, hover-flag quads
	const frontEmits = []; // x, y, style-bucket triples for the persistence trail
	let iy = 0;
	for (let gy = gs * 0.5; gy < canvasHeight; gy += gs, iy++) {
		let ix = 0;
		for (let gx = gs * 0.5; gx < canvasWidth; gx += gs, ix++) {
			// nearest / second-nearest among sites whose flood reached the cell,
			// plus the wavefront ring passing closest to it
			let own = -1, sec = -1, D1 = Infinity, D2 = Infinity;
			let fI = -1, fDd = 0, fRel = Infinity;
			let wBest = Infinity;
			for (let s = 0; s < n; s++) {
				const dx = gx - sxA[s], dy = gy - syA[s];
				const d = dx * dx + dy * dy;
				if (hoverI >= 0) { const w = geo[s] + Math.sqrt(d); if (w < wBest) wBest = w; }
				if (d <= sg2A[s]) {
					if (d < D1) { D2 = D1; sec = own; D1 = d; own = s; }
					else if (d < D2) { D2 = d; sec = s; }
				}
				if (d > fInA[s] && d < fOutA[s]) {
					const rel = d > sg2A[s] ? d - sg2A[s] : sg2A[s] - d;
					if (rel < fRel) { fRel = rel; fI = s; fDd = d; }
				}
			}

			// cursor heat: nearby glyphs brighten and their ripple agitates
			let heat = 0;
			const hdx = gx - mouseX, hdy = gy - mouseY;
			const hd2 = hdx * hdx + hdy * hdy;
			if (hd2 < 22500) heat = 1 - Math.sqrt(hd2) / 150;

			let isWall = false, ember = 3;
			let d1 = 0;
			if (own >= 0) {
				d1 = Math.sqrt(D1);
				if (sec >= 0) {
					const d2 = Math.sqrt(D2);
					if (d2 - d1 < gs * 2.5) {
						// true distance to the cell border: the gap normalized by
						// its gradient |u2-u1|, else walls bloat far from sites
						const ux = (gx - sxA[sec]) / (d2 || 1) - (gx - sxA[own]) / (d1 || 1);
						const uy = (gy - syA[sec]) / (d2 || 1) - (gy - syA[own]) / (d1 || 1);
						const grad = Math.max(Math.sqrt(ux * ux + uy * uy), 0.2);
						if ((d2 - d1) / grad < gs * 0.62) {
							isWall = true;
							// wall age = arrival of the later of the two fronts
							const wa = Math.min(sgA[own] - d1, sgA[sec] - d2);
							ember = Math.min(3, Math.floor(wa / 12));
						}
					}
				}
			}
			if (isWall) {
				wallCells.push(gx, gy, ember, own === hoverI || sec === hoverI ? 1 : 0, wBest);
			} else if (fI >= 0 && (own === -1 || own === fI)) {
				// wavefront ring, brightest at the exact radius; hidden where a
				// closer site already owns the cell (fronts annihilate there)
				const fT = 1 - Math.abs(Math.sqrt(fDd) - sgA[fI]) / band;
				if (fT > 0.3) {   // drop the dim outer skirt → thin crest
					const fb = Math.min(3, (fT * 4) | 0);
					atlasStamp(ctx, FRONT_RAMP[fb], frontStyles[fb], false, gx, gy, ATLAS_SLOT);
					if (fT > 0.55) frontEmits.push(gx, gy, fb);
				}
			} else if (own >= 0) {
				// interior: a resting density ramp (time-independent, so cells
				// don't pulse in unison) plus a travelling wave; letters are
				// reserved for the site marker so cell borders stay legible
				const age = sgA[own] - d1;
				const base = Math.max(0.24, 1 - age / 1000);
				const shade = 0.7 + 0.3 * Math.sin(age * 0.05 + d1 * 0.03);
				// geodesic wave phase while hovering: earliest arrival over ANY relay
				// site, min_i(geo[i] + |p - site_i|) (wBest, from the scan above) —
				// continuous everywhere, no corner seams. Idle keeps per-site phases.
				const W = hoverI >= 0 ? wBest : geo[own] + d1;
				let ring = 0;
				if (hoverI >= 0) {
					// launched comet crest, born at the hovered site (see crestAt)
					crestAt(W, now);
					ring = _crest;
				} else {
					const maxR = WAVE_MAXR, t = now * 0.22, sig = 15;
					const R1 = t % maxR, R2 = (t + maxR * 0.5) % maxR;
					ring = Math.exp(-(W - R1) * (W - R1) / (2 * sig * sig)) * (1 - R1 / maxR)
						+ Math.exp(-(W - R2) * (W - R2) / (2 * sig * sig)) * (1 - R2 / maxR);
				}
				let lvl = Math.round(base * shade * boost * 6.5 + ring * 6 + heat * 2);
				// completion shockwave: one bright ring sweeps out of every site
				if (donePulse > 0.02) {
					const ring = (1 - donePulse) * 1400;
					const rw = 1 - Math.abs(d1 - ring) / 50;
					if (rw > 0) lvl += Math.round(rw * 4);
				}
				if (lvl < 1) continue;
				if (lvl > 9) lvl = 9;
				// energized crest band: point-color styles + sparse letter scramble
				// (quantized approximation of the GL tint/overbright/scramble)
				if (hoverI >= 0 && _hot > 0.3) {
					const h = ((ix * 73 + iy * 151) % 97) / 97;
					const fs = frontStyles[Math.min(3, (_hot * 5) | 0)];
					if (_crest > 0.6 && h < 0.16) atlasStamp(ctx, SITE_LETTERS[(((now / 90) | 0) + ((h * 26) | 0)) % 26], fs, false, gx, gy, ATLAS_SLOT);
					else atlasStamp(ctx, GLYPH_RAMP[lvl], fs, false, gx, gy, ATLAS_SLOT);
				} else {
					atlasStamp(ctx, GLYPH_RAMP[lvl], glyphLUT[own % 2][lvl], false, gx, gy, ATLAS_SLOT);
				}
			} else if (n > 0 && ((ix + iy) & 1) === 0) {
				// unclaimed: sparse dotted paper, warming under the cursor
				const ps = heat > 0.02 ? paperHotStyles[Math.min(3, (heat * 4) | 0)] : paperStyle;
				atlasStamp(ctx, ".", ps, false, gx, gy, ATLAS_SLOT);
			}
		}
	}

	// walls in a bold pass so they read above the field; freshly welded
	// cells strobe as white-hot asterisks, then cool into # embers
	for (let i = 0; i < wallCells.length; i += 5) {
		const em = wallCells[i + 2];
		let ch = em === 0 ? "*" : "#";
		let style = wallCells[i + 3] ? pal.point : emberLUT[em];
		if (!wallCells[i + 3] && hoverI >= 0) {
			// crest ignition: the border flashes white-hot as the wave crosses,
			// then cools back into its ember shade behind the front
			crestAt(wallCells[i + 4], now);
			if (_hot > 0.55) { style = emberLUT[0]; ch = "@"; }
			else if (_hot > 0.25) style = emberLUT[1];
		}
		atlasStamp(ctx, ch, style, true, wallCells[i], wallCells[i + 1], ATLAS_SLOT);
	}

	// site markers: each site's letter, snapped onto the lattice
	if (showPoints) {
		for (let i = 0; i < n; i++) {
			let mStyle = pal.point, lift = 0;
			if (hoverI >= 0) {
				// beacon: the letter flares as the crest sweeps its site, so
				// letters fire in geodesic order (W at the site itself = geo[i]);
				// the shockwave also lifts it — damped-sine pop, fall, settle
				crestAt(geo[i], now);
				if (_hot > 0.3) mStyle = pal.additive ? "#ffffff" : emberLUT[0];
				const t = (now - waveT0) * WAVE_HOVER_SPD, S = WAVE_HOVER_SPACING;
				const Ra = t % S;
				let u = Ra - geo[i];
				if (u < 0 && t >= S) u = Ra + S - geo[i];
				if (u >= 0) lift = Math.sin(u * 0.01256) * Math.exp(-u * 0.004) * Math.max(0, 1 - geo[i] / WAVE_HOVER_MAXR);
			}
			// airborne letters also swell (scaled blit around the lifted center)
			const mSc = 1 + Math.max(lift, 0) * 0.9;
			atlasStamp(ctx, SITE_LETTERS[i % 26], mStyle, true, (Math.floor(sites[i].x / gs) + 0.5) * gs, (Math.floor(sites[i].y / gs) + 0.5) * gs - lift * gs, ATLAS_SLOT * mSc);
		}
	}

	// data packets riding the finished walls, leaving trails behind them
	if (!growing && asciiSegs && asciiSegs.length && n >= 2) {
		if (runners.length < 4 && Math.random() < 0.03) {
			const sg = asciiSegs[Math.floor(Math.random() * asciiSegs.length)];
			const len = Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1);
			const dir = Math.random() < 0.5 ? 1 : -1;
			if (len > 40) runners.push({ seg: sg, t: dir > 0 ? 0 : 1, sp: (2 + Math.random() * 2) / len, dir: dir });
		}
		const runStyle = pal.additive ? "#ffffff" : pal.point;
		for (let i = runners.length - 1; i >= 0; i--) {
			const r = runners[i];
			if (!paused) r.t += r.sp * r.dir;
			if (r.t < 0 || r.t > 1) { runners.splice(i, 1); continue; }
			const x = r.seg.x1 + (r.seg.x2 - r.seg.x1) * r.t;
			const y = r.seg.y1 + (r.seg.y2 - r.seg.y1) * r.t;
			const cx = (Math.floor(x / gs) + 0.5) * gs, cy = (Math.floor(y / gs) + 0.5) * gs;
			atlasStamp(ctx, "+", runStyle, true, cx, cy, ATLAS_SLOT);
			frontEmits.push(cx, cy, 3);
		}
	} else if (runners.length) {
		runners.length = 0;
	}

	// phosphor persistence at half resolution: decay the trail buffer, stamp
	// this frame's emissions (bright fronts + hot wall cells), composite up
	if (!paused) {
		trailBCtx.clearRect(0, 0, trailB.width, trailB.height);
		trailBCtx.globalAlpha = 0.86;
		trailBCtx.drawImage(trailA, 0, 0);
		trailBCtx.globalAlpha = 0.5;
		for (let i = 0; i < frontEmits.length; i += 3) {
			atlasStamp(trailBCtx, "+", frontStyles[frontEmits[i + 2]], false, frontEmits[i] * 0.5, frontEmits[i + 1] * 0.5, 8);
		}
		trailBCtx.globalAlpha = 0.55;
		for (let i = 0; i < wallCells.length; i += 5) {
			if (wallCells[i + 2] > 1) continue;
			atlasStamp(trailBCtx, "#", emberLUT[wallCells[i + 2]], true, wallCells[i] * 0.5, wallCells[i + 1] * 0.5, 8);
		}
		trailBCtx.globalAlpha = 1;
		const swapC = trailA; trailA = trailB; trailB = swapC;
		const swapX = trailACtx; trailACtx = trailBCtx; trailBCtx = swapX;
	}
	ctx.save();
	ctx.globalCompositeOperation = pal.additive ? "lighter" : "source-over";
	ctx.globalAlpha = pal.additive ? 0.7 : 0.3;
	ctx.drawImage(trailA, 0, 0, canvasWidth, canvasHeight);
	ctx.restore();

	applyBloom(pal);
	drawScanlines(pal);
	drawVignette(pal);
}

// CRT phosphor bloom, the cheap way: downscale the frame to quarter res
// (lightly blurred), then composite it back up additively. Full-res
// blur(10px) each frame was a major cost. Dark themes only.
function applyBloom(pal) {
	if (!pal.additive) return;
	bloomCtx.drawImage(backgroundCanvas, 0, 0, bloomCanvas.width, bloomCanvas.height);
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	ctx.globalAlpha = 0.5;
	ctx.drawImage(bloomCanvas, 0, 0, canvasWidth, canvasHeight);
	ctx.restore();
}

// CRT scanlines: every 3rd row dimmed via a cached 1x3 repeating pattern
var scanPatternKey = "";
var scanPattern = null;
function drawScanlines(pal) {
	if (scanPatternKey !== pal.bgCss) {
		const tile = document.createElement("canvas");
		tile.width = 1;
		tile.height = 3;
		const tctx = tile.getContext("2d");
		tctx.fillStyle = pal.additive ? "rgba(0,0,0,0.16)" : "rgba(90,56,32,0.05)";
		tctx.fillRect(0, 2, 1, 1);
		scanPattern = ctx.createPattern(tile, "repeat");
		scanPatternKey = pal.bgCss;
	}
	ctx.fillStyle = scanPattern;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}

// CRT vignette: cached radial gradient, clear centre into shaded corners
var vignetteKey = "";
var vignette = null;
function drawVignette(pal) {
	const key = pal.bgCss + canvasWidth + "x" + canvasHeight;
	if (vignetteKey !== key) {
		const cx = canvasWidth / 2, cy = canvasHeight / 2;
		const rOut = Math.hypot(cx, cy);
		vignette = ctx.createRadialGradient(cx, cy, rOut * 0.45, cx, cy, rOut);
		vignette.addColorStop(0, "rgba(0,0,0,0)");
		vignette.addColorStop(1, pal.additive ? "rgba(0,0,0,0.34)" : "rgba(60,35,15,0.12)");
		vignetteKey = key;
	}
	ctx.fillStyle = vignette;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}
// #endregion

// #region render mesh
function renderDelaunay(overlay) {
	const pal = themePalette();
	if (!overlay) {
		ctx.fillStyle = pal.bgCss;
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);
		drawGrid(pal);
	}
	if (sites.length < 3) return;
	const tris = cachedTris();
	ctx.lineWidth = 1;
	ctx.strokeStyle = "rgba(" + pal.coral[0] + "," + pal.coral[1] + "," + pal.coral[2] + "," + (overlay ? "0.45)" : "0.7)");
	ctx.beginPath();
	for (const tr of tris) {
		const a = sites[tr.a], b = sites[tr.b], c = sites[tr.c];
		ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
		ctx.lineTo(c.x, c.y); ctx.lineTo(a.x, a.y);
	}
	ctx.stroke();
}
// #endregion

function drawPoints() {
	ctx.fillStyle = themePalette().point;
	for (let i = 0; i < sites.length; i++) {
		const s = sites[i];
		ctx.beginPath();
		ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
		ctx.fill();
	}
}

function render(now) {
	if (mode === "grow") {
		hideAsciiCanvas();
		renderGrow(now);
	} else if (mode === "ascii") {
		if (ensureAsciiGL()) {
			showAsciiCanvas();
			renderAsciiFloodGL(now);
		} else {
			hideAsciiCanvas();
			renderAsciiFlood(now); // CPU fallback on the 2D canvas
		}
	} else if (view === "cells") {
		hideAsciiCanvas();
		renderCells();
	} else if (view === "delaunay") {
		hideAsciiCanvas();
		renderDelaunay(false);
	} else {
		hideAsciiCanvas();
		renderCells();
		renderDelaunay(true);
	}
	// ascii mode draws its own lattice-snapped site markers
	if (showPoints && mode !== "ascii") drawPoints();
}

// #region theme
document.addEventListener("themechange", function (e) {
	isLight = e.detail.isLight;
	isViper = e.detail.theme === "viper";
	// drop phosphor in the old palette (both the GL trail and the 2D fallback's)
	if (asciiGLReady) asciiGLR.clearTrail();
	clearTrail2D();
});
// #endregion

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	// resize even on a HUD toggle — the panel opening/closing changes canvasWidth,
	// and leaving the canvases at the old size strips 280px off the render
	applyCanvasSize();
	if (window._hudToggling) return;
	buildSites();
});
// #endregion

// #region inputs
function bindSlider(id, valId, parse, onChange, fmt) {
	const slider = document.getElementById(id);
	const label = document.getElementById(valId);
	slider.value = onChange.initial;
	label.innerHTML = fmt ? fmt(onChange.initial) : onChange.initial;
	slider.oninput = function () {
		const v = parse(this.value);
		label.innerHTML = fmt ? fmt(v) : v;
		onChange(v);
	};
}

bindSlider("countSlider", "countValue", parseInt, Object.assign(function (v) {
	siteCount = v;
	buildSites();
}, { initial: siteCount }));

bindSlider("speedSlider", "speedValue", parseFloat, Object.assign(function (v) {
	motion = v;
}, { initial: motion }), (v) => v.toFixed(2));

bindSlider("growSlider", "growValue", parseFloat, Object.assign(function (v) {
	growSpeed = v;
}, { initial: growSpeed }), (v) => v.toFixed(2));

// Keep the slider thumb, its label and siteCount in step after clicks/clear —
// they all read back as the site count, so R and resize rebuild what the HUD shows.
var countSlider = document.getElementById("countSlider");
var countValue = document.getElementById("countValue");
function syncCountUI() {
	countSlider.value = Math.min(parseInt(countSlider.max, 10), siteCount);
	countValue.textContent = siteCount;
}

var growButton = document.getElementById("growButton");
growButton.onclick = startGrow;
growButton.style.display = "none"; // drift mode at boot

var hintLabel = document.getElementById("hintLabel");

document.querySelectorAll('input[name="mode"]').forEach(function (radio) {
	radio.addEventListener("change", function () {
		if (!this.checked) return;
		mode = this.value;
		growR = 0;
		growing = false;
		for (const s of sites) s.gr = 0;
		asciiSegs = null;
		runners.length = 0;
		if (asciiGLReady) asciiGLR.clearTrail();
		growButton.style.display = mode === "drift" ? "none" : "";
		hintLabel.textContent = mode === "drift"
			? "Click to add a site · right-click removes the nearest"
			: "Click to place sites, then Grow (G) floods until the walls meet";
	});
});

document.getElementById("clearButton").onclick = function () {
	sites = [];
	siteCount = 0;
	siteVersion++;
	growR = 0;
	growing = false;
	growFill = 1;
	donePulse = 0;
	asciiSegs = null;
	runners.length = 0;
	if (asciiGLReady) asciiGLR.clearTrail();
	clearTrail2D();
	syncCountUI();
};

document.querySelectorAll('input[name="view"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) view = this.value; });
});

var pointsCheckbox = document.getElementById("pointsCheckbox");
pointsCheckbox.checked = showPoints;
pointsCheckbox.onclick = function () { showPoints = this.checked; };

var asciiCheckbox = document.getElementById("asciiCheckbox");
asciiCheckbox.checked = asciiField;
asciiCheckbox.onclick = function () { asciiField = this.checked; };

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("resetButton").onclick = buildSites;

window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") buildSites();
	if ((e.key === "g" || e.key === "G") && mode !== "drift") startGrow();
});
// #endregion

// #region mouse
// cursor position for the ASCII-mode heat effect. Handlers bind to both the 2D
// canvas and the GL canvas (whichever is on top intercepts pointer events).
function onBoth(type, fn) {
	backgroundCanvas.addEventListener(type, fn);
	glCanvas.addEventListener(type, fn);
}
var mouseX = -1e9, mouseY = -1e9;
onBoth("mousemove", function (e) {
	const rect = backgroundCanvas.getBoundingClientRect();
	mouseX = e.clientX - rect.left;
	mouseY = e.clientY - rect.top;
});
onBoth("mouseleave", function () {
	mouseX = -1e9;
	mouseY = -1e9;
});

function nearestSite(x, y) {
	let best = -1, bestD = 1e9;
	for (let i = 0; i < sites.length; i++) {
		const dx = sites[i].x - x, dy = sites[i].y - y;
		const d = dx * dx + dy * dy;
		if (d < bestD) { bestD = d; best = i; }
	}
	return { i: best, d: Math.sqrt(bestD) };
}
onBoth("mousedown", function (e) {
	if (e.button !== 0 && e.button !== 2) return; // ignore middle/back/forward
	const rect = backgroundCanvas.getBoundingClientRect();
	const x = e.clientX - rect.left, y = e.clientY - rect.top;
	if (e.button === 2) {
		const n = nearestSite(x, y);
		if (n.i >= 0 && n.d < 40) sites.splice(n.i, 1);
	} else {
		// the ASCII sites texture holds MAX_SITES texels; past that the GL path
		// would silently drop the extras while hover/hit-testing still saw them
		if (sites.length >= MAX_SITES) return;
		const a = Math.random() * Math.PI * 2;
		sites.push({ x, y, vx: Math.cos(a), vy: Math.sin(a), gr: 0 });
	}
	siteCount = sites.length;
	siteVersion++;
	syncCountUI();
	if (mode === "grow" && (growing || growR > 0)) {
		// editing sites mid/post-growth replays the flood with the new layout
		startGrow();
	} else if (mode === "ascii") {
		// invasion: a new site floods from zero and steals what lies closer to
		// it; removals resume growth so neighbours close the abandoned ground
		asciiSegs = null;
		runners.length = 0;
		for (const s of sites) {
			if (s.gr > 0) { growing = true; break; }
		}
	}
});
onBoth("contextmenu", function (e) { e.preventDefault(); });
// #endregion

// debug boot params: ?grow=1 (or ?ascii=1 for the all-ASCII mode) jumps
// straight into flood-fill growth, &gspd=N overrides growth speed
var bootParams = new URLSearchParams(location.search);
var bootMode = bootParams.get("ascii") === "1" ? "ascii" : bootParams.get("grow") === "1" ? "grow" : "";
if (bootMode) {
	const radio = document.querySelector('input[name="mode"][value="' + bootMode + '"]');
	radio.checked = true;
	radio.dispatchEvent(new Event("change"));
	startGrow();
}
var bootGspd = parseFloat(bootParams.get("gspd"));
if (bootGspd > 0) growSpeed = bootGspd;

// #region loop
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (!paused && mode === "drift") moveSites();
	render(now);

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		fpsBadge.textContent = fps + " fps · " + sites.length + " sites";
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
