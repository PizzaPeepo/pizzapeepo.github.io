// Wave interference / ripple tank — sum of circular waves from point sources.
// The scalar field is computed on a low-res buffer then scaled up for speed.

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

var wavelength = 70;   // canvas px between crests
var speed = 1.4;       // temporal angular speed
var falloff = 30;      // amplitude decay with distance (0 = none)
var sampleW = 240;     // buffer width in cells
var palette = "ocean"; // ocean | thermal | mono
var showMarkers = true;
var paused = false;

var sources = [];      // {x, y} in canvas px
var t = 0;

var isLight = document.documentElement.classList.contains("light");
// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");

// Low-res offscreen buffer
var buffer = document.createElement("canvas");
var bctx = buffer.getContext("2d");
var sampleH = 1, imageData = null, pixels = null;

function applyCanvasSize() {
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";
	ctx.imageSmoothingEnabled = true;
	allocBuffer();
}

function allocBuffer() {
	sampleH = Math.max(1, Math.round(sampleW * canvasHeight / canvasWidth));
	buffer.width = sampleW;
	buffer.height = sampleH;
	imageData = bctx.createImageData(sampleW, sampleH);
	pixels = imageData.data;
}
applyCanvasSize();
// #endregion

function defaultSources() {
	sources = [
		{ x: canvasWidth * 0.42, y: canvasHeight * 0.5 },
		{ x: canvasWidth * 0.58, y: canvasHeight * 0.5 },
	];
}
defaultSources();

function threeSources() {
	const cx = canvasWidth / 2, cy = canvasHeight / 2, r = Math.min(canvasWidth, canvasHeight) * 0.22;
	sources = [];
	for (let i = 0; i < 3; i++) {
		const a = -Math.PI / 2 + i * (Math.PI * 2 / 3);
		sources.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
	}
}

function lineArray() {
	sources = [];
	const n = 6;
	const y = canvasHeight * 0.5;
	const margin = canvasWidth * 0.2;
	for (let i = 0; i < n; i++) {
		sources.push({ x: margin + (canvasWidth - 2 * margin) * i / (n - 1), y: y });
	}
}

// #region palette
function setPixel(p, v) {
	// v in -1..1
	let r, g, b;
	if (palette === "mono") {
		const c = Math.round((v * 0.5 + 0.5) * 255);
		r = g = b = c;
	} else if (palette === "thermal") {
		const tt = v * 0.5 + 0.5; // 0..1
		r = Math.round(255 * Math.min(1, tt * 1.8));
		g = Math.round(255 * Math.max(0, Math.min(1, tt * 1.8 - 0.5)));
		b = Math.round(255 * Math.max(0, tt * 1.8 - 1.2));
	} else {
		// ocean: trough deep blue, crest warm gold
		if (v >= 0) {
			r = Math.round(20 + v * 230);
			g = Math.round(60 + v * 170);
			b = Math.round(90 - v * 30);
		} else {
			r = Math.round(10 - v * 20);
			g = Math.round(40 - v * 30);
			b = Math.round(70 - v * 160);
		}
	}
	pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = 255;
}
// #endregion

function computeField() {
	const k = (Math.PI * 2) / wavelength;
	const ns = sources.length;
	const fall = falloff / 100;
	const sx = canvasWidth / sampleW;
	const sy = canvasHeight / sampleH;
	const norm = ns > 0 ? 1 / Math.sqrt(ns) : 1; // keep contrast roughly stable

	let p = 0;
	for (let j = 0; j < sampleH; j++) {
		const cy = j * sy;
		for (let i = 0; i < sampleW; i++) {
			const cx = i * sx;
			let sum = 0;
			for (let s = 0; s < ns; s++) {
				const src = sources[s];
				const dx = cx - src.x, dy = cy - src.y;
				const r = Math.sqrt(dx * dx + dy * dy);
				const atten = 1 / (1 + fall * r * 0.02);
				sum += Math.sin(r * k - t) * atten;
			}
			let v = sum * norm;
			if (v > 1) v = 1; else if (v < -1) v = -1;
			setPixel(p, v);
			p += 4;
		}
	}
}

function drawMarkers() {
	for (const s of sources) {
		ctx.beginPath();
		ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
		ctx.fillStyle = "rgba(255,255,255,0.9)";
		ctx.fill();
		ctx.lineWidth = 2;
		ctx.strokeStyle = "rgba(0,0,0,0.5)";
		ctx.stroke();
	}
}

function render() {
	computeField();
	bctx.putImageData(imageData, 0, 0);
	ctx.drawImage(buffer, 0, 0, sampleW, sampleH, 0, 0, canvasWidth, canvasHeight);
	if (showMarkers) drawMarkers();
}

// #region theme — palette already neutral; just re-render
document.addEventListener("themechange", function (e) { isLight = e.detail.isLight; });
// #endregion

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
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

bindSlider("wavelengthSlider", "wavelengthValue", parseInt, Object.assign(function (v) {
	wavelength = v;
}, { initial: wavelength }));

bindSlider("speedSlider", "speedValue", parseFloat, Object.assign(function (v) {
	speed = v;
}, { initial: speed }), (v) => v.toFixed(2));

bindSlider("falloffSlider", "falloffValue", parseInt, Object.assign(function (v) {
	falloff = v;
}, { initial: falloff }));

bindSlider("resSlider", "resValue", parseInt, Object.assign(function (v) {
	sampleW = v;
	allocBuffer();
}, { initial: sampleW }));

document.querySelectorAll('input[name="palette"]').forEach(function (radio) {
	radio.addEventListener("change", function () { if (this.checked) palette = this.value; });
});

var markerCheckbox = document.getElementById("markerCheckbox");
markerCheckbox.checked = showMarkers;
markerCheckbox.onclick = function () { showMarkers = this.checked; };

document.getElementById("twoButton").onclick = defaultSources;
document.getElementById("threeButton").onclick = threeSources;
document.getElementById("lineButton").onclick = lineArray;
document.getElementById("clearButton").onclick = function () { sources = []; };

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}


window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
});
// #endregion

// #region mouse — add / remove / drag sources
var dragging = -1;

function nearestSource(x, y) {
	let best = -1, bestD = 1e9;
	for (let i = 0; i < sources.length; i++) {
		const dx = sources[i].x - x, dy = sources[i].y - y;
		const d = dx * dx + dy * dy;
		if (d < bestD) { bestD = d; best = i; }
	}
	return { i: best, d: Math.sqrt(bestD) };
}

backgroundCanvas.addEventListener("mousedown", function (e) {
	const rect = backgroundCanvas.getBoundingClientRect();
	const x = e.clientX - rect.left, y = e.clientY - rect.top;
	if (e.button === 2) {
		const n = nearestSource(x, y);
		if (n.i >= 0 && n.d < 30) sources.splice(n.i, 1);
		return;
	}
	const n = nearestSource(x, y);
	if (n.i >= 0 && n.d < 14) { dragging = n.i; }
	else { sources.push({ x, y }); dragging = sources.length - 1; }
});
window.addEventListener("mousemove", function (e) {
	if (dragging < 0) return;
	const rect = backgroundCanvas.getBoundingClientRect();
	sources[dragging].x = e.clientX - rect.left;
	sources[dragging].y = e.clientY - rect.top;
});
window.addEventListener("mouseup", function () { dragging = -1; });
backgroundCanvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
// #endregion

// #region loop
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (!paused) t += speed * 0.15;
	render();

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		fpsBadge.textContent = fps + " fps · " + sources.length + " src";
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
