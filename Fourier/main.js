// Fourier epicycles — take a closed path, run a DFT, and re-draw it with a chain
// of rotating circles (epicycles). A natural companion to the Lissajous and
// Circular Motion demos: each circle is one rotating phasor, summed tip-to-tail.

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var SAMPLES = 256;       // resample resolution fed to the DFT
var terms = 80;          // epicycles actually drawn / summed
var speed = 1.0;
var showCircles = true;
var showOriginal = true;
var paused = false;

var epicycles = [];      // {freq, amp, phase} sorted by amp desc
var originalPath = [];   // resampled points used for the transform
var trace = [];          // tip positions over the current loop
var t = 0;

var drawing = false;
var rawPoints = [];

var darkBg = "#0c0d12";
var lightBg = "#efece4";
var isLight = document.documentElement.classList.contains("light");
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
applyCanvasSize();
// #endregion

function applyThemeColors(light) {
	isLight = light;
	backgroundCanvas.style.background = light ? lightBg : darkBg;
}

// #region transform
// Resample a polyline to n points evenly spaced by arc length (closed loop).
function resample(points, n) {
	if (points.length < 2) return points.slice();
	const pts = points.slice();
	pts.push(points[0]); // close the loop
	let total = 0;
	const segLen = [];
	for (let i = 0; i < pts.length - 1; i++) {
		const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
		segLen.push(d); total += d;
	}
	if (total === 0) return points.slice();
	const out = [];
	const step = total / n;
	let seg = 0, segPos = 0;
	for (let i = 0; i < n; i++) {
		const target = i * step;
		while (seg < segLen.length - 1 && segPos + segLen[seg] < target) { segPos += segLen[seg]; seg++; }
		const f = segLen[seg] > 0 ? (target - segPos) / segLen[seg] : 0;
		out.push({
			x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * f,
			y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * f,
		});
	}
	return out;
}

function computeEpicycles(points) {
	originalPath = resample(points, SAMPLES);
	const Nn = originalPath.length;
	const list = [];
	for (let k = 0; k < Nn; k++) {
		let re = 0, im = 0;
		for (let n = 0; n < Nn; n++) {
			const phi = -2 * Math.PI * k * n / Nn;
			const c = Math.cos(phi), s = Math.sin(phi);
			const x = originalPath[n].x, y = originalPath[n].y;
			re += x * c - y * s;
			im += x * s + y * c;
		}
		re /= Nn; im /= Nn;
		let freq = k;
		if (k > Nn / 2) freq = k - Nn; // negative frequencies rotate the other way
		list.push({ freq: freq, amp: Math.hypot(re, im), phase: Math.atan2(im, re) });
	}
	list.sort((a, b) => b.amp - a.amp);
	epicycles = list;
	trace = [];
	t = 0;
	document.getElementById("termsSlider").max = Nn;
}
// #endregion

// #region built-in shapes
function shapePoints(name) {
	const cx = canvasWidth / 2, cy = canvasHeight / 2;
	const R = Math.min(canvasWidth, canvasHeight) * 0.3;
	const pts = [];
	const M = 400;
	if (name === "star") {
		const spikes = 5;
		for (let i = 0; i <= M; i++) {
			const a = (i / M) * Math.PI * 2;
			const rr = R * (0.5 + 0.5 * Math.pow(Math.abs(Math.cos(spikes * a / 2)), 3));
			pts.push({ x: cx + Math.cos(a - Math.PI / 2) * rr, y: cy + Math.sin(a - Math.PI / 2) * rr });
		}
	} else if (name === "heart") {
		for (let i = 0; i <= M; i++) {
			const a = (i / M) * Math.PI * 2;
			const x = 16 * Math.pow(Math.sin(a), 3);
			const y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a);
			pts.push({ x: cx + x * R / 17, y: cy - y * R / 17 });
		}
	} else if (name === "square") {
		const s = R;
		const corners = [[-s, -s], [s, -s], [s, s], [-s, s]];
		for (let c = 0; c < 4; c++) {
			const a = corners[c], b = corners[(c + 1) % 4];
			for (let i = 0; i < M / 4; i++) {
				const f = i / (M / 4);
				pts.push({ x: cx + a[0] + (b[0] - a[0]) * f, y: cy + a[1] + (b[1] - a[1]) * f });
			}
		}
	} else { // pi symbol (rough outline as a single stroke)
		const w = R * 0.9, h = R;
		const seq = [
			[-w, -h * 0.5], [w, -h * 0.5],            // top bar
			[w * 0.5, -h * 0.5], [w * 0.55, h * 0.6], // right leg down
			[w * 0.2, h * 0.6], [w * 0.15, -h * 0.5], // back up inside right leg
			[-w * 0.3, -h * 0.5], [-w * 0.3, h * 0.6],// left leg down
			[-w * 0.62, h * 0.6], [-w * 0.6, -h * 0.5],// back up
			[-w, -h * 0.5],
		];
		for (let c = 0; c < seq.length - 1; c++) {
			const a = seq[c], b = seq[c + 1];
			for (let i = 0; i < 40; i++) {
				const f = i / 40;
				pts.push({ x: cx + a[0] + (b[0] - a[0]) * f, y: cy + a[1] + (b[1] - a[1]) * f });
			}
		}
	}
	return pts;
}
// #endregion

// #region render
function epicycleChain(time) {
	let x = 0, y = 0;
	const used = Math.min(terms, epicycles.length);
	const pts = [{ x: 0, y: 0 }];
	for (let i = 0; i < used; i++) {
		const e = epicycles[i];
		x += e.amp * Math.cos(e.freq * time + e.phase);
		y += e.amp * Math.sin(e.freq * time + e.phase);
		pts.push({ x: x, y: y });
	}
	return pts;
}

function render() {
	ctx.fillStyle = isLight ? lightBg : darkBg;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);

	if (epicycles.length === 0) return;

	if (showOriginal && originalPath.length) {
		ctx.strokeStyle = isLight ? "rgba(40,40,50,0.25)" : "rgba(200,200,220,0.2)";
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let i = 0; i < originalPath.length; i++) {
			const p = originalPath[i];
			if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
		}
		ctx.closePath();
		ctx.stroke();
	}

	const chain = epicycleChain(t);

	if (showCircles) {
		ctx.lineWidth = 1;
		for (let i = 0; i < chain.length - 1; i++) {
			const a = chain[i], b = chain[i + 1];
			const r = Math.hypot(b.x - a.x, b.y - a.y);
			if (r > 0.5) {
				ctx.strokeStyle = isLight ? "rgba(120,120,140,0.35)" : "rgba(180,180,210,0.22)";
				ctx.beginPath();
				ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
				ctx.stroke();
			}
			ctx.strokeStyle = isLight ? "rgba(180,50,20,0.6)" : "rgba(255,107,71,0.6)";
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
		}
	}

	// traced output
	const tip = chain[chain.length - 1];
	trace.unshift({ x: tip.x, y: tip.y });
	if (trace.length > 1400) trace.pop();

	ctx.save();
	if (!isLight) { ctx.shadowBlur = 12; ctx.shadowColor = "#ffb84d"; }
	ctx.strokeStyle = isLight ? "#b8860b" : "#ffd27a";
	ctx.lineWidth = 2;
	ctx.beginPath();
	for (let i = 0; i < trace.length; i++) {
		if (i === 0) ctx.moveTo(trace[i].x, trace[i].y); else ctx.lineTo(trace[i].x, trace[i].y);
	}
	ctx.stroke();

	// tip dot
	ctx.fillStyle = isLight ? "#b8860b" : "#fff2cc";
	ctx.beginPath();
	ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}
// #endregion

// #region init
computeEpicycles(shapePoints("star"));
applyThemeColors(isLight);
document.addEventListener("themechange", function (e) { applyThemeColors(e.detail.isLight); });
// #endregion

// #region resize
window.addEventListener("resize", function () {
	const oldW = canvasWidth, oldH = canvasHeight;
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	// shift existing path to stay roughly centred
	const dx = (canvasWidth - oldW) / 2, dy = (canvasHeight - oldH) / 2;
	if (originalPath.length) {
		for (const p of originalPath) { p.x += dx; p.y += dy; }
		computeEpicycles(originalPath);
	}
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

bindSlider("termsSlider", "termsValue", parseInt, Object.assign(function (v) {
	terms = v;
	trace = [];
}, { initial: terms }));

bindSlider("speedSlider", "speedValue", parseFloat, Object.assign(function (v) {
	speed = v;
}, { initial: speed }), (v) => v.toFixed(1));

var circlesCheckbox = document.getElementById("circlesCheckbox");
circlesCheckbox.checked = showCircles;
circlesCheckbox.onclick = function () { showCircles = this.checked; };

var originalCheckbox = document.getElementById("originalCheckbox");
originalCheckbox.checked = showOriginal;
originalCheckbox.onclick = function () { showOriginal = this.checked; };

document.querySelectorAll('[data-shape]').forEach(function (btn) {
	btn.addEventListener("click", function () { computeEpicycles(shapePoints(this.dataset.shape)); });
});

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("exportButton").onclick = exportPNG;
function exportPNG() {
	const link = document.createElement("a");
	link.download = "fourier.png";
	link.href = backgroundCanvas.toDataURL("image/png");
	link.click();
}

window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "s" || e.key === "S") exportPNG();
});
// #endregion

// #region drawing
function canvasPos(e) {
	const rect = backgroundCanvas.getBoundingClientRect();
	return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
backgroundCanvas.addEventListener("mousedown", function (e) {
	drawing = true;
	rawPoints = [canvasPos(e)];
	epicycles = [];
	trace = [];
	originalPath = rawPoints.slice();
});
window.addEventListener("mousemove", function (e) {
	if (!drawing) return;
	const p = canvasPos(e);
	const last = rawPoints[rawPoints.length - 1];
	if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 3) {
		rawPoints.push(p);
		originalPath = rawPoints.slice();
	}
});
window.addEventListener("mouseup", function () {
	if (!drawing) return;
	drawing = false;
	if (rawPoints.length > 3) computeEpicycles(rawPoints);
});

// While drawing, show the in-progress stroke directly.
function renderDrawing() {
	ctx.fillStyle = isLight ? lightBg : darkBg;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	ctx.strokeStyle = isLight ? "#b8860b" : "#ffd27a";
	ctx.lineWidth = 2;
	ctx.beginPath();
	for (let i = 0; i < rawPoints.length; i++) {
		const p = rawPoints[i];
		if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
	}
	ctx.stroke();
}
// #endregion

// #region loop
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (drawing) {
		renderDrawing();
	} else {
		if (!paused && epicycles.length) {
			t += speed * (Math.PI * 2) / 600;
			if (t > Math.PI * 2) t -= Math.PI * 2;
		}
		render();
	}

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		fpsBadge.textContent = fps + " fps · " + Math.min(terms, epicycles.length) + " circles";
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
