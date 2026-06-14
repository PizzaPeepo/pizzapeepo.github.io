// Verlet cloth — a grid of point masses linked by distance constraints.
// Same position-Verlet integration family as the gravity sim, but here the
// constraints are stiff springs solved by relaxation, and they snap when
// over-stretched (tearing).

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var density = 32;        // cells across the cloth
var gravity = 0.45;
var iterations = 4;      // constraint relaxation passes (stiffness)
var tearFactor = 4.0;    // multiple of rest length before a link snaps
var windStrength = 0;
var pinMode = "top";     // top | corners | sides
var drawMode = "mesh";   // mesh | solid
var paused = false;

const DAMP = 0.99;
const GRAB_RADIUS = 28;
const TEAR_RADIUS = 22;

var cols, rows, spacing, originX, originY;
var P = null;            // {x,y,px,py,pinned}
var links = null;        // {a,b,rest,active}
var hLink = null;        // hLink[r*(cols+1)+c] = horizontal link i->i+1 (or null)
var wind = 0;
var grabbed = -1;

var darkBg = "#101015";
var lightBg = "#efeae0";
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
applyCanvasSize();
// #endregion

function isPinned(c, r) {
	if (r !== 0) {
		// "sides" also pins the leftmost/rightmost columns down the edges
		if (pinMode === "sides" && (c === 0 || c === cols - 1)) return true;
		return false;
	}
	if (pinMode === "corners") return c === 0 || c === cols - 1;
	return true; // top edge fully pinned (top, sides)
}

function build() {
	cols = density;
	const clothW = Math.min(canvasWidth * 0.7, canvasHeight * 0.7);
	spacing = clothW / cols;
	rows = Math.max(4, Math.floor((canvasHeight * 0.62) / spacing));
	originX = (canvasWidth - cols * spacing) / 2;
	originY = canvasHeight * 0.12;

	P = [];
	for (let r = 0; r <= rows; r++) {
		for (let c = 0; c <= cols; c++) {
			const x = originX + c * spacing;
			const y = originY + r * spacing;
			P.push({ x, y, px: x, py: y, pinned: isPinned(c, r) });
		}
	}

	const W = cols + 1;
	links = [];
	hLink = new Array(W * (rows + 1)).fill(null);
	for (let r = 0; r <= rows; r++) {
		for (let c = 0; c <= cols; c++) {
			const i = r * W + c;
			if (c < cols) {
				const L = { a: i, b: i + 1, rest: spacing, active: true };
				links.push(L);
				hLink[i] = L;
			}
			if (r < rows) links.push({ a: i, b: i + W, rest: spacing, active: true });
		}
	}
	grabbed = -1;
}

function applyThemeColors(light) {
	isLight = light;
	isViper = document.documentElement.classList.contains("viper");
	backgroundCanvas.style.background = light ? lightBg : isViper ? "#030806" : darkBg;
}

// #region physics
function integrate() {
	wind = windStrength * (0.5 + 0.5 * Math.sin(performance.now() * 0.0007)) * 0.02;
	for (let i = 0; i < P.length; i++) {
		const p = P[i];
		if (p.pinned) continue;
		const vx = (p.x - p.px) * DAMP;
		const vy = (p.y - p.py) * DAMP;
		p.px = p.x; p.py = p.y;
		p.x += vx + wind;
		p.y += vy + gravity;
	}
}

function solve() {
	for (let it = 0; it < iterations; it++) {
		for (let k = 0; k < links.length; k++) {
			const L = links[k];
			if (!L.active) continue;
			const a = P[L.a], b = P[L.b];
			let dx = b.x - a.x, dy = b.y - a.y;
			let d = Math.sqrt(dx * dx + dy * dy);
			if (d === 0) d = 0.0001;
			if (d > L.rest * tearFactor) { L.active = false; continue; }
			const diff = ((L.rest - d) / d) * 0.5;
			const ox = dx * diff, oy = dy * diff;
			if (!a.pinned) { a.x -= ox; a.y -= oy; }
			if (!b.pinned) { b.x += ox; b.y += oy; }
		}
		// keep inside viewport floor
		for (let i = 0; i < P.length; i++) {
			const p = P[i];
			if (p.y > canvasHeight - 2) { p.y = canvasHeight - 2; }
		}
	}
}
// #endregion

// #region render
function strainColor(d, rest) {
	const s = Math.min(Math.max((d / rest - 1) / (tearFactor - 1), 0), 1);
	const hue = isViper ? 120 - s * 120 : 200 - s * 200; // viper: green->red; dark: blue->red
	return `hsl(${hue}, 80%, ${isLight ? 45 : 60}%)`;
}

function render() {
	ctx.fillStyle = isLight ? lightBg : isViper ? "#030806" : darkBg;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);

	if (drawMode === "solid") {
		const W = cols + 1;
		for (let r = 0; r < rows; r++) {
			for (let c = 0; c < cols; c++) {
				const i = r * W + c;
				const a = P[i], b = P[i + 1], cc = P[i + W], d = P[i + W + 1];
				// skip torn quads (top edge missing)
				const top = hLink[i];
				if (!top || !top.active) continue;
				const shade = Math.max(0, Math.min(1, 0.5 + (b.x - a.x - spacing) / spacing));
				const lum = isLight ? 60 - shade * 25 : 35 + shade * 35;
				ctx.fillStyle = `hsl(265, 35%, ${lum}%)`;
				ctx.beginPath();
				ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
				ctx.lineTo(d.x, d.y); ctx.lineTo(cc.x, cc.y);
				ctx.closePath();
				ctx.fill();
			}
		}
	} else {
		ctx.lineWidth = 1;
		for (let k = 0; k < links.length; k++) {
			const L = links[k];
			if (!L.active) continue;
			const a = P[L.a], b = P[L.b];
			const dx = b.x - a.x, dy = b.y - a.y;
			const d = Math.sqrt(dx * dx + dy * dy);
			ctx.strokeStyle = strainColor(d, L.rest);
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
		}
	}

	// pinned anchors
	ctx.fillStyle = isLight ? "#222" : isViper ? "#a8ffa6" : "#fff";
	for (let i = 0; i < P.length; i++) {
		if (P[i].pinned) { ctx.beginPath(); ctx.arc(P[i].x, P[i].y, 2.5, 0, Math.PI * 2); ctx.fill(); }
	}
}
// #endregion

// #region init
build();
applyThemeColors(isLight);
document.addEventListener("themechange", function (e) { isViper = e.detail.theme === "viper"; applyThemeColors(e.detail.isLight); });
// #endregion

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	build();
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

bindSlider("densitySlider", "densityValue", parseInt, Object.assign(function (v) {
	density = v;
	build();
}, { initial: density }));

bindSlider("gravitySlider", "gravityValue", parseFloat, Object.assign(function (v) {
	gravity = v;
}, { initial: gravity }), (v) => v.toFixed(2));

bindSlider("stiffnessSlider", "stiffnessValue", parseInt, Object.assign(function (v) {
	iterations = v;
}, { initial: iterations }));

bindSlider("tearSlider", "tearValue", parseFloat, Object.assign(function (v) {
	tearFactor = v;
}, { initial: tearFactor }), (v) => v.toFixed(1));

bindSlider("windSlider", "windValue", parseInt, Object.assign(function (v) {
	windStrength = v;
}, { initial: windStrength }));

document.querySelectorAll('input[name="pin"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) { pinMode = this.value; build(); } });
});
document.querySelectorAll('input[name="draw"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) drawMode = this.value; });
});

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("resetButton").onclick = build;

window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") build();
});
// #endregion

// #region mouse — grab / tear
var mode = 0; // 0 none, 1 grab, 2 tear
var mx = 0, my = 0;

function canvasPos(e) {
	const rect = backgroundCanvas.getBoundingClientRect();
	return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function nearestPoint(x, y) {
	let best = -1, bestD = GRAB_RADIUS * GRAB_RADIUS;
	for (let i = 0; i < P.length; i++) {
		const dx = P[i].x - x, dy = P[i].y - y;
		const d = dx * dx + dy * dy;
		if (d < bestD) { bestD = d; best = i; }
	}
	return best;
}

function tearAt(x, y) {
	const r2 = TEAR_RADIUS * TEAR_RADIUS;
	for (let k = 0; k < links.length; k++) {
		const L = links[k];
		if (!L.active) continue;
		const a = P[L.a], b = P[L.b];
		const midx = (a.x + b.x) / 2, midy = (a.y + b.y) / 2;
		const dx = midx - x, dy = midy - y;
		if (dx * dx + dy * dy < r2) L.active = false;
	}
}

backgroundCanvas.addEventListener("mousedown", function (e) {
	const p = canvasPos(e);
	mx = p.x; my = p.y;
	if (e.button === 2) { mode = 2; tearAt(mx, my); }
	else { mode = 1; grabbed = nearestPoint(mx, my); backgroundCanvas.classList.add("grabbing"); }
});
window.addEventListener("mousemove", function (e) {
	if (mode === 0) return;
	const p = canvasPos(e);
	mx = p.x; my = p.y;
	if (mode === 2) tearAt(mx, my);
});
window.addEventListener("mouseup", function () {
	mode = 0; grabbed = -1;
	backgroundCanvas.classList.remove("grabbing");
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

	if (!paused) {
		integrate();
		if (mode === 1 && grabbed >= 0) {
			P[grabbed].x = mx; P[grabbed].y = my;
			P[grabbed].px = mx; P[grabbed].py = my;
		}
		solve();
	}
	render();

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		fpsBadge.textContent = fps + " fps";
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
