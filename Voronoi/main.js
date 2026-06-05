import { triangulate } from "./Delaunay.js";

// Voronoi cells via per-pixel nearest-site (low-res buffer, scaled up),
// Delaunay mesh via Bowyer-Watson. Sites drift and bounce.

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var siteCount = 28;
var motion = 0.8;
var sampleW = 220;
var view = "cells";   // cells | delaunay | both
var colorMode = "hue"; // hue | dist
var showPoints = true;
var paused = false;

var sites = [];        // {x, y, vx, vy, hue}
var sampleH = 1;

var isLight = document.documentElement.classList.contains("light");
// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");

var buffer = document.createElement("canvas");
var bctx = buffer.getContext("2d");
var imageData = null, pixels = null;

// Precomputed site colours (parallel to sites)
var siteR = [], siteG = [], siteB = [];

function applyCanvasSize() {
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";
	ctx.imageSmoothingEnabled = false;
	allocBuffer();
}

function allocBuffer() {
	sampleH = Math.max(1, Math.round(sampleW * canvasHeight / canvasWidth));
	buffer.width = sampleW;
	buffer.height = sampleH;
	imageData = bctx.createImageData(sampleW, sampleH);
	pixels = imageData.data;
}
// #endregion

function hslToRgb(h, s, l) {
	h /= 360;
	const a = s * Math.min(l, 1 - l);
	const f = (n) => {
		const k = (n + h * 12) % 12;
		return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
	};
	return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function refreshColors() {
	siteR = []; siteG = []; siteB = [];
	for (let i = 0; i < sites.length; i++) {
		const [r, g, b] = hslToRgb(sites[i].hue, 0.6, isLight ? 0.6 : 0.5);
		siteR.push(r); siteG.push(g); siteB.push(b);
	}
}

function makeSite() {
	const a = Math.random() * Math.PI * 2;
	return {
		x: Math.random() * canvasWidth,
		y: Math.random() * canvasHeight,
		vx: Math.cos(a),
		vy: Math.sin(a),
		hue: Math.random() * 360,
	};
}

function buildSites() {
	sites = [];
	for (let i = 0; i < siteCount; i++) sites.push(makeSite());
	refreshColors();
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
function renderCells() {
	const n = sites.length;
	if (n === 0) { ctx.fillStyle = isLight ? "#eee" : "#111"; ctx.fillRect(0, 0, canvasWidth, canvasHeight); return; }
	const sx = canvasWidth / sampleW;
	const sy = canvasHeight / sampleH;
	// site positions in buffer space
	const px = new Float32Array(n), py = new Float32Array(n);
	for (let i = 0; i < n; i++) { px[i] = sites[i].x / sx; py[i] = sites[i].y / sy; }

	let p = 0;
	for (let j = 0; j < sampleH; j++) {
		for (let i = 0; i < sampleW; i++) {
			let best = 0, bestD = Infinity;
			for (let s = 0; s < n; s++) {
				const dx = i - px[s], dy = j - py[s];
				const d = dx * dx + dy * dy;
				if (d < bestD) { bestD = d; best = s; }
			}
			if (colorMode === "dist") {
				const t = Math.min(Math.sqrt(bestD) / (sampleW * 0.18), 1);
				const c = Math.round((isLight ? 235 : 30) + (isLight ? -180 : 200) * (1 - t));
				pixels[p] = c; pixels[p + 1] = c; pixels[p + 2] = Math.round(c * (isLight ? 0.95 : 1.1));
			} else {
				// slight darkening toward cell edge for depth
				const shade = Math.max(0.55, 1 - Math.sqrt(bestD) / (sampleW * 0.5));
				pixels[p] = siteR[best] * shade;
				pixels[p + 1] = siteG[best] * shade;
				pixels[p + 2] = siteB[best] * shade;
			}
			pixels[p + 3] = 255;
			p += 4;
		}
	}
	bctx.putImageData(imageData, 0, 0);
	ctx.imageSmoothingEnabled = true;
	ctx.drawImage(buffer, 0, 0, sampleW, sampleH, 0, 0, canvasWidth, canvasHeight);
}
// #endregion

// #region render mesh
function renderDelaunay(overlay) {
	if (!overlay) {
		ctx.fillStyle = isLight ? "#f2efe8" : "#0e0e12";
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	}
	if (sites.length < 3) return;
	const tris = triangulate(sites);
	ctx.lineWidth = 1;
	ctx.strokeStyle = overlay
		? (isLight ? "rgba(20,20,20,0.5)" : "rgba(255,255,255,0.5)")
		: (isLight ? "rgba(40,40,40,0.7)" : "rgba(230,220,200,0.7)");
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
	for (let i = 0; i < sites.length; i++) {
		const s = sites[i];
		ctx.beginPath();
		ctx.arc(s.x, s.y, 3, 0, Math.PI * 2);
		ctx.fillStyle = isLight ? "#1a1a1a" : "#fff";
		ctx.fill();
	}
}

function render() {
	if (view === "cells") {
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
	refreshColors();
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

bindSlider("resSlider", "resValue", parseInt, Object.assign(function (v) {
	sampleW = v;
	allocBuffer();
}, { initial: sampleW }));

document.querySelectorAll('input[name="view"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) view = this.value; });
});
document.querySelectorAll('input[name="color"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) colorMode = this.value; });
});

var pointsCheckbox = document.getElementById("pointsCheckbox");
pointsCheckbox.checked = showPoints;
pointsCheckbox.onclick = function () { showPoints = this.checked; };

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("resetButton").onclick = buildSites;
document.getElementById("exportButton").onclick = exportPNG;
function exportPNG() {
	const link = document.createElement("a");
	link.download = "voronoi.png";
	link.href = backgroundCanvas.toDataURL("image/png");
	link.click();
}

window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") buildSites();
	if (e.key === "s" || e.key === "S") exportPNG();
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
		sites.push({ x, y, vx: Math.cos(a), vy: Math.sin(a), hue: Math.random() * 360 });
	}
	siteCount = sites.length;
	document.getElementById("countSlider").value = Math.min(120, siteCount);
	document.getElementById("countValue").textContent = siteCount;
	refreshColors();
});
backgroundCanvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
// #endregion

// #region loop
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (!paused) moveSites();
	render();

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
