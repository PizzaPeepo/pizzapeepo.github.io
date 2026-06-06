import DoublePendulum from "./DoublePendulum.js";
import PendulumWave from "./PendulumWave.js";

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

const STEP = 0.004;     // integration substep (s)
const SUBSTEPS = 8;     // substeps per frame — fps-independent sim clock

var mode = "double";    // "double" | "wave"
var paused = false;

// Double-pendulum state
var copies = 12;
var gravity = 9.81;
var damping = 0.0;
var arm2 = 1.0;
var traceEnabled = true;
var showRods = true;
var fadeSpeed = 0.06;
var pendulums = [];
var trails = [];        // parallel array of point lists for each pendulum's 2nd bob

// Wave state
var waveCount = 24;
var wavePeriod = 30;
var waveAmplitudeDeg = 40;
var waveTime = 0;
var wave = null;

var isLight = document.documentElement.classList.contains("light");
var darkBg = "#18140e", lightBg = "#f5ede0";
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

function clearCanvas() {
	ctx.fillStyle = isLight ? lightBg : darkBg;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}
// #endregion

// #region theme
function applyThemeColors(light) {
	isLight = light;
	backgroundCanvas.style.background = light ? lightBg : darkBg;
}
applyThemeColors(isLight);
document.addEventListener("themechange", (e) => applyThemeColors(e.detail.isLight));
// #endregion

function maxTrailLength() {
	return Math.min(1600, Math.round(20 / fadeSpeed));
}

function buildDoublePendulums() {
	pendulums = [];
	trails = [];
	for (let i = 0; i < copies; i++) {
		const p = new DoublePendulum({
			L1: 1,
			L2: arm2,
			theta1: 2.3 + i * 1e-3,   // tiny perturbation → chaotic fan-out
			theta2: 2.3,
			hue: copies === 1 ? 18 : 45 - (i / Math.max(copies - 1, 1)) * 70,
		});
		pendulums.push(p);
		trails.push([]);
	}
}

function buildWave() {
	wave = new PendulumWave(waveCount, wavePeriod, (waveAmplitudeDeg * Math.PI) / 180, waveCount + 8);
	waveTime = 0;
}

function resetSim() {
	if (mode === "double") buildDoublePendulums();
	else buildWave();
	clearCanvas();
}

buildDoublePendulums();
buildWave();
clearCanvas();

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	clearCanvas();
});
// #endregion

// #region inputs
function slider(id, valId, parse, fmt, onChange) {
	const s = document.getElementById(id);
	const label = document.getElementById(valId);
	s.oninput = function () {
		const v = parse(this.value);
		if (label) label.innerHTML = fmt ? fmt(v) : v;
		onChange(v);
	};
	return { s, label, fmt };
}

function initSlider(ctrl, value) {
	ctrl.s.value = value;
	if (ctrl.label) ctrl.label.innerHTML = ctrl.fmt ? ctrl.fmt(value) : value;
}

const copiesCtrl = slider("copiesSlider", "copiesValue", parseInt, null, (v) => { copies = v; buildDoublePendulums(); });
const gravityCtrl = slider("gravitySlider", "gravityValue", parseFloat, (v) => v.toFixed(1), (v) => { gravity = v; });
const dampingCtrl = slider("dampingSlider", "dampingValue", parseFloat, (v) => v.toFixed(3), (v) => { damping = v; });
const arm2Ctrl = slider("arm2Slider", "arm2Value", parseFloat, (v) => v.toFixed(2), (v) => { arm2 = v; buildDoublePendulums(); });
const fadeCtrl = slider("fadeSpeedSlider", "fadeSpeedValue", parseInt, null, (v) => { fadeSpeed = v / 100; });

const waveCountCtrl = slider("waveCountSlider", "waveCountValue", parseInt, null, (v) => { waveCount = v; buildWave(); });
const periodCtrl = slider("periodSlider", "periodValue", parseInt, null, (v) => { wavePeriod = v; buildWave(); });
const amplitudeCtrl = slider("amplitudeSlider", "amplitudeValue", parseInt, null, (v) => { waveAmplitudeDeg = v; buildWave(); });

initSlider(copiesCtrl, copies);
initSlider(gravityCtrl, gravity);
initSlider(dampingCtrl, damping);
initSlider(arm2Ctrl, arm2);
initSlider(fadeCtrl, fadeSpeed * 100);
initSlider(waveCountCtrl, waveCount);
initSlider(periodCtrl, wavePeriod);
initSlider(amplitudeCtrl, waveAmplitudeDeg);

var trailCheckbox = document.getElementById("trailCheckbox");
trailCheckbox.checked = traceEnabled;
trailCheckbox.onclick = function () { traceEnabled = this.checked; for (const t of trails) t.length = 0; };

var rodsCheckbox = document.getElementById("rodsCheckbox");
rodsCheckbox.checked = showRods;
rodsCheckbox.onclick = function () { showRods = this.checked; };

var doubleControls = document.getElementById("doubleControls");
var waveControls = document.getElementById("waveControls");
var demoTitle = document.querySelector(".demo-title");

document.querySelectorAll('input[name="mode"]').forEach(function (radio) {
	radio.addEventListener("change", function () {
		if (!this.checked) return;
		mode = this.value;
		doubleControls.hidden = mode !== "double";
		waveControls.hidden = mode !== "wave";
		demoTitle.textContent = mode === "double" ? "Double Pendulum" : "Pendulum Wave";
		resetSim();
	});
});

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("resetButton").onclick = resetSim;
document.getElementById("exportButton").onclick = exportPNG;

function exportPNG() {
	const link = document.createElement("a");
	link.download = mode === "double" ? "double-pendulum.png" : "pendulum-wave.png";
	link.href = backgroundCanvas.toDataURL("image/png");
	link.click();
}

window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") resetSim();
	if (e.key === "s" || e.key === "S") exportPNG();
});
// #endregion

// #region rendering — double pendulum
function renderDouble() {
	clearCanvas();
	const pivotX = canvasWidth / 2;
	const pivotY = canvasHeight * 0.32;
	const scale = Math.min(canvasWidth, canvasHeight) * 0.26;
	const maxLen = maxTrailLength();

	for (let i = 0; i < pendulums.length; i++) {
		const p = pendulums[i];
		const pos = p.positions(pivotX, pivotY, scale);

		if (traceEnabled) {
			const tr = trails[i];
			tr.push(pos.x2, pos.y2);
			while (tr.length > maxLen * 2) { tr.shift(); tr.shift(); }
			if (tr.length >= 4) {
				// dark theme: additive blend so overlapping chaotic trails bloom into hot light
				if (!isLight) ctx.globalCompositeOperation = "lighter";
				ctx.beginPath();
				ctx.moveTo(tr[0], tr[1]);
				for (let k = 2; k < tr.length; k += 2) ctx.lineTo(tr[k], tr[k + 1]);
				ctx.strokeStyle = `hsla(${p.hue}, 85%, ${isLight ? 45 : 62}%, ${copies > 6 ? 0.5 : 0.8})`;
				ctx.lineWidth = 1.5;
				ctx.stroke();
				ctx.globalCompositeOperation = "source-over";
			}
		}

		if (showRods) {
			ctx.beginPath();
			ctx.moveTo(pivotX, pivotY);
			ctx.lineTo(pos.x1, pos.y1);
			ctx.lineTo(pos.x2, pos.y2);
			ctx.strokeStyle = isLight ? "rgba(60,40,20,0.45)" : "rgba(220,200,170,0.4)";
			ctx.lineWidth = 1.5;
			ctx.stroke();

			const bobColor = `hsl(${p.hue}, 85%, ${isLight ? 45 : 62}%)`;
			drawBob(pos.x1, pos.y1, 4, bobColor);
			drawBob(pos.x2, pos.y2, 5, bobColor);
		} else {
			drawBob(pos.x2, pos.y2, 3.5, `hsl(${p.hue}, 85%, ${isLight ? 45 : 62}%)`);
		}
	}

	// Pivot marker
	drawBob(pivotX, pivotY, 4, isLight ? "#3a2210" : "#a08060");
}

function drawBob(x, y, r, color) {
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();
}
// #endregion

// #region rendering — pendulum wave
function renderWave() {
	clearCanvas();
	wave.update(waveTime);

	const marginX = canvasWidth * 0.12;
	const railY = canvasHeight * 0.18;
	const usableW = canvasWidth - marginX * 2;
	const gap = wave.count > 1 ? usableW / (wave.count - 1) : 0;
	const minLen = canvasHeight * 0.18;
	const maxLen = canvasHeight * 0.68;

	// Rail
	ctx.beginPath();
	ctx.moveTo(marginX - 20, railY);
	ctx.lineTo(canvasWidth - marginX + 20, railY);
	ctx.strokeStyle = isLight ? "rgba(60,40,20,0.35)" : "rgba(200,180,150,0.3)";
	ctx.lineWidth = 2;
	ctx.stroke();

	for (let i = 0; i < wave.count; i++) {
		const pivotX = marginX + gap * i;
		const len = wave.rodLength(i, minLen, maxLen);
		const angle = wave.angles[i];
		const bx = pivotX + Math.sin(angle) * len;
		const by = railY + Math.cos(angle) * len;

		ctx.beginPath();
		ctx.moveTo(pivotX, railY);
		ctx.lineTo(bx, by);
		ctx.strokeStyle = isLight ? "rgba(60,40,20,0.3)" : "rgba(200,180,150,0.25)";
		ctx.lineWidth = 1;
		ctx.stroke();

		const hue = 45 - (i / Math.max(wave.count - 1, 1)) * 70;
		drawBob(bx, by, 7, `hsl(${(hue + 360) % 360}, 85%, ${isLight ? 48 : 60}%)`);
	}
}
// #endregion

// #region loop
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (!paused) {
		if (mode === "double") {
			for (let s = 0; s < SUBSTEPS; s++) {
				for (let i = 0; i < pendulums.length; i++) pendulums[i].step(STEP, gravity, damping);
			}
		} else {
			waveTime += STEP * SUBSTEPS;
		}
	}

	if (mode === "double") renderDouble();
	else renderWave();

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		fpsBadge.textContent = Math.round((frameCount * 1000) / (now - lastFpsUpdate)) + " fps";
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
// #endregion
