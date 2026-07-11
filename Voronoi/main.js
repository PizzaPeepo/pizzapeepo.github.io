import { triangulate, voronoiEdges } from "./Delaunay.js";

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

var sites = [];        // {x, y, vx, vy}

var isLight = document.documentElement.classList.contains("light");
var isViper = document.documentElement.classList.contains("viper");
// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");

function applyCanvasSize() {
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";
}
// #endregion

// Theme palette (mirrors CSS tokens in CSS/theme.css: --bg, --gold, --coral, --tx)
// additive: emissive effects may use "lighter" compositing (dark backgrounds only)
function themePalette() {
	if (isViper) return { bgCss: "#030806", edge: [40, 255, 69], coral: [107, 255, 40], point: "#e8ffe0", additive: true };
	if (isLight) return { bgCss: "#faf5ee", edge: [192, 120, 0], coral: [200, 56, 32], point: "#1a1008", additive: false };
	return { bgCss: "#181210", edge: [245, 166, 35], coral: [255, 107, 71], point: "#f5e8d4", additive: true };
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
	};
}

function buildSites() {
	sites = [];
	for (let i = 0; i < siteCount; i++) sites.push(makeSite());
	growR = 0;
	growing = false;
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
	return voronoiEdges(sites, triangulate(sites), rayLength);
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

function renderCells() {
	const pal = themePalette();
	ctx.fillStyle = pal.bgCss;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	drawGrid(pal);
	const segs = computeSegs();
	if (segs.length) strokeWalls(segs, pal);
}
// #endregion

// #region grow mode (flood fill)
function startGrow() {
	growR = 0;
	growing = true;
	growFill = 1;
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
function drawGlyphField(pal, R, now) {
	if (glyphLUTKey !== pal.bgCss) {
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
	ctx.font = "12px 'IBM Plex Mono', monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
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
			ctx.fillStyle = glyphLUT[own % 2][lvl];
			ctx.fillText(GLYPH_RAMP[lvl], gx, gy);
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
	const segs = computeSegs();

	// growth finished and tint faded out: completed diagram over the glyph field
	if (!growing && growR > 0 && growFill <= 0.005) {
		donePulse *= 0.95;
		if (asciiField) drawGlyphField(pal, growR, now);
		if (segs.length) strokeWalls(segs, pal);
		return;
	}

	// radius at which every canvas corner is claimed and every in-view
	// Voronoi vertex is reached -> growth is visually complete
	let need = 0;
	const pad = 100;
	const corners = [[0, 0], [canvasWidth, 0], [0, canvasHeight], [canvasWidth, canvasHeight]];
	for (const [cx, cy] of corners) {
		let d1 = Infinity;
		for (const s of sites) d1 = Math.min(d1, Math.hypot(s.x - cx, s.y - cy));
		need = Math.max(need, d1);
	}
	for (const s of segs) {
		if (s.x1 < -pad || s.x1 > canvasWidth + pad || s.y1 < -pad || s.y1 > canvasHeight + pad) continue;
		need = Math.max(need, Math.hypot(s.x1 - s.px, s.y1 - s.py));
	}

	if (growing && !paused) {
		growR += growSpeed;
		if (growR >= need + 12) { growR = need + 12; growing = false; donePulse = 1; }
	}
	if (growR <= 0) return;

	// flooded territory: the union of discs equals the union of claimed cells
	if (growFill > 0.005) {
		ctx.fillStyle = "rgba(" + pal.edge[0] + "," + pal.edge[1] + "," + pal.edge[2] + "," + (0.05 * growFill).toFixed(3) + ")";
		ctx.beginPath();
		for (const s of sites) { ctx.moveTo(s.x + growR, s.y); ctx.arc(s.x, s.y, growR, 0, Math.PI * 2); }
		ctx.fill();
	}
	if (!growing && !paused) growFill = Math.max(0, growFill - 0.015);
	donePulse *= 0.95;

	if (asciiField) drawGlyphField(pal, growR, now);

	const built = revealedSubSegs(segs, growR);
	if (built.segs.length) strokeWalls(built.segs, pal);

	drawFronts(pal, growR);
	if (built.sparks.length) drawSparks(pal, built.sparks);
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
	const tris = triangulate(sites);
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
		renderGrow(now);
	} else if (view === "cells") {
		renderCells();
	} else if (view === "delaunay") {
		renderDelaunay(false);
	} else {
		renderCells();
		renderDelaunay(true);
	}
	if (showPoints) drawPoints();
}

// #region theme
document.addEventListener("themechange", function (e) {
	isLight = e.detail.isLight;
	isViper = e.detail.theme === "viper";
});
// #endregion

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
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
		growButton.style.display = mode === "grow" ? "" : "none";
		hintLabel.textContent = mode === "grow"
			? "Click to place sites, then Grow (G) floods until the walls meet"
			: "Click to add a site · right-click removes the nearest";
	});
});

document.getElementById("clearButton").onclick = function () {
	sites = [];
	siteCount = 0;
	growR = 0;
	growing = false;
	document.getElementById("countValue").textContent = 0;
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
	if ((e.key === "g" || e.key === "G") && mode === "grow") startGrow();
});
// #endregion

// #region mouse
function nearestSite(x, y) {
	let best = -1, bestD = 1e9;
	for (let i = 0; i < sites.length; i++) {
		const dx = sites[i].x - x, dy = sites[i].y - y;
		const d = dx * dx + dy * dy;
		if (d < bestD) { bestD = d; best = i; }
	}
	return { i: best, d: Math.sqrt(bestD) };
}
backgroundCanvas.addEventListener("mousedown", function (e) {
	const rect = backgroundCanvas.getBoundingClientRect();
	const x = e.clientX - rect.left, y = e.clientY - rect.top;
	if (e.button === 2) {
		const n = nearestSite(x, y);
		if (n.i >= 0 && n.d < 40) sites.splice(n.i, 1);
	} else {
		const a = Math.random() * Math.PI * 2;
		sites.push({ x, y, vx: Math.cos(a), vy: Math.sin(a) });
	}
	siteCount = sites.length;
	document.getElementById("countSlider").value = Math.min(120, siteCount);
	document.getElementById("countValue").textContent = siteCount;
	// editing sites mid/post-growth replays the flood with the new layout
	if (mode === "grow" && (growing || growR > 0)) startGrow();
});
backgroundCanvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
// #endregion

// debug boot params: ?grow=1 jumps straight into flood-fill growth,
// &gspd=N overrides growth speed (headless verification)
var bootParams = new URLSearchParams(location.search);
if (bootParams.get("grow") === "1") {
	const radio = document.querySelector('input[name="mode"][value="grow"]');
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
