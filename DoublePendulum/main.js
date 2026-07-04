import DoublePendulum from "./DoublePendulum.js";
import PendulumWave from "./PendulumWave.js";

// #region globals
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

const STEP = 0.004;       // fixed integration substep (s)
const MAX_FRAME_DT = 0.1; // clamp for tab-switch / hiccup gaps (s)
const MAX_STEPS = 200;    // backlog guard — drop time instead of spiraling

var mode = "double";    // "double" | "wave"
var paused = false;
var timeScale = 1.0;    // sim seconds per real second

// Double-pendulum state
var copies = 12;
var gravity = 9.81;
var damping = 0.0;
var arm1 = 1.0;
var arm2 = 1.0;
var mass2 = 1.0;
var spreadExp = -3;         // perturbation between copies = 10^spreadExp rad
var baseTheta1 = 2.3;       // launch angles — updated by dragging the bobs
var baseTheta2 = 2.3;
var baseOmega1 = 0;         // launch angular velocities (rad/s)
var baseOmega2 = 0;
var traceEnabled = true;
var showRods = true;
var fadeSpeed = 0.06;
var pendulums = [];
var lastPos = [];       // last trail point per pendulum (null until first advanced frame)

// Wave state
var waveCount = 24;
var wavePeriod = 30;
var waveAmplitudeDeg = 40;
var waveTime = 0;
var wave = null;

// Phase portrait state
var phaseEnabled = true;
var phasePair = "t2w2"; // "t1t2" | "t2w2"
const PHASE_SIZE = 260;
const OMEGA_RANGE = 12; // rad/s plotted range for omega axis

var isLight = document.documentElement.classList.contains("light");
var isViper = document.documentElement.classList.contains("viper");
var darkBg = "#18140e", viperBg = "#030806", lightBg = "#f5ede0";
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
	ctx.fillStyle = isLight ? lightBg : isViper ? viperBg : darkBg;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}

// Shared pivot/scale so rendering and bob-dragging agree on screen positions.
// Pivot sits at canvas center and scale is fitted to the full reach (arm1+arm2)
// against the nearest edge, so the chaotic swing can never leave the frame.
function layout() {
	const pivotX = canvasWidth / 2;
	const pivotY = canvasHeight / 2;
	const margin = 16; // bob radius + breathing room
	const reach = Math.max(Math.min(pivotX, pivotY) - margin, 20);
	return {
		pivotX,
		pivotY,
		scale: reach / (arm1 + arm2),
	};
}
// #endregion

// #region trail buffers
// Ping-pong accumulation pair for bob trails — only the newest segment is drawn
// each frame and old pixels fade via drawImage+globalAlpha (see CLAUDE.md
// canvas-fade notes). Cost per frame is O(copies), not O(copies × trail length).
const TRAIL_FADE_RATE = 14; // decay k = RATE·fadeSpeed (1/s) — matches the old point-list trail duration
var trailFadeAcc = 1;       // batched fade multiplier (see renderDouble)
var trailFront = document.createElement("canvas");
var trailBack = document.createElement("canvas");
var trailFrontCtx = trailFront.getContext("2d");
var trailBackCtx = trailBack.getContext("2d");

function resetTrails() {
	trailFront.width = trailBack.width = canvasWidth;   // setting size also clears
	trailFront.height = trailBack.height = canvasHeight;
	trailFrontCtx.lineCap = trailBackCtx.lineCap = "round"; // resize resets ctx state
	trailFadeAcc = 1;
	for (let i = 0; i < lastPos.length; i++) lastPos[i] = null;
}
resetTrails();
// #endregion

// #region phase portrait canvases
var phaseCanvas = document.getElementById("phaseCanvas");
var phaseCtx = phaseCanvas.getContext("2d");
// ping-pong pair for a clean drawImage fade (see CLAUDE.md canvas-fade notes)
var phaseFront = document.createElement("canvas");
var phaseBack = document.createElement("canvas");
phaseFront.width = phaseBack.width = PHASE_SIZE;
phaseFront.height = phaseBack.height = PHASE_SIZE;
var phaseFrontCtx = phaseFront.getContext("2d");
var phaseBackCtx = phaseBack.getContext("2d");

function resetPhase() {
	phaseFrontCtx.clearRect(0, 0, PHASE_SIZE, PHASE_SIZE);
	phaseBackCtx.clearRect(0, 0, PHASE_SIZE, PHASE_SIZE);
	compositePhase();
}

function wrapAngle(a) {
	a = (a + Math.PI) % (2 * Math.PI);
	if (a < 0) a += 2 * Math.PI;
	return a - Math.PI;
}

function angleToPx(a) {
	return (wrapAngle(a) / Math.PI * 0.5 + 0.5) * PHASE_SIZE;
}

function omegaToPx(w) {
	if (w > OMEGA_RANGE) w = OMEGA_RANGE;
	if (w < -OMEGA_RANGE) w = -OMEGA_RANGE;
	return (0.5 - w / (2 * OMEGA_RANGE)) * PHASE_SIZE;
}

function updatePhase(dt) {
	// fade the accumulated portrait, then stamp one dot per pendulum
	phaseBackCtx.clearRect(0, 0, PHASE_SIZE, PHASE_SIZE);
	phaseBackCtx.globalAlpha = Math.exp(-0.45 * dt);
	phaseBackCtx.drawImage(phaseFront, 0, 0);
	phaseBackCtx.globalAlpha = 1;

	for (const p of pendulums) {
		let px, py;
		if (phasePair === "t1t2") {
			px = angleToPx(p.theta1);
			py = PHASE_SIZE - angleToPx(p.theta2);
		} else {
			px = angleToPx(p.theta2);
			py = omegaToPx(p.omega2);
		}
		phaseBackCtx.fillStyle = `hsla(${p.hue}, 85%, ${isLight ? 42 : 62}%, 0.9)`;
		phaseBackCtx.fillRect(px - 1, py - 1, 2, 2);
	}

	const tmp = phaseFront; phaseFront = phaseBack; phaseBack = tmp;
	const tmpCtx = phaseFrontCtx; phaseFrontCtx = phaseBackCtx; phaseBackCtx = tmpCtx;
	compositePhase();
}

function compositePhase() {
	phaseCtx.clearRect(0, 0, PHASE_SIZE, PHASE_SIZE);
	phaseCtx.fillStyle = isLight ? "rgba(245,237,224,0.85)" : isViper ? "rgba(2,7,4,0.78)" : "rgba(12,9,6,0.75)";
	phaseCtx.fillRect(0, 0, PHASE_SIZE, PHASE_SIZE);

	// crosshair axes through the origin
	phaseCtx.strokeStyle = isLight ? "rgba(60,40,20,0.22)" : isViper ? "rgba(40,255,69,0.18)" : "rgba(220,200,170,0.18)";
	phaseCtx.lineWidth = 1;
	phaseCtx.beginPath();
	phaseCtx.moveTo(PHASE_SIZE / 2, 0);
	phaseCtx.lineTo(PHASE_SIZE / 2, PHASE_SIZE);
	phaseCtx.moveTo(0, PHASE_SIZE / 2);
	phaseCtx.lineTo(PHASE_SIZE, PHASE_SIZE / 2);
	phaseCtx.stroke();

	if (!isLight) phaseCtx.globalCompositeOperation = "lighter";
	phaseCtx.drawImage(phaseFront, 0, 0);
	phaseCtx.globalCompositeOperation = "source-over";

	phaseCtx.fillStyle = isLight ? "rgba(60,40,20,0.6)" : isViper ? "rgba(40,255,69,0.55)" : "rgba(220,200,170,0.55)";
	phaseCtx.font = "11px monospace";
	phaseCtx.fillText(phasePair === "t1t2" ? "θ₁ × θ₂" : "θ₂ × ω₂", 8, PHASE_SIZE - 8);
}

function updatePhaseVisibility() {
	phaseCanvas.style.display = (mode === "double" && phaseEnabled) ? "block" : "none";
}
// #endregion

// #region theme
function applyThemeColors(light) {
	isLight = light;
	isViper = document.documentElement.classList.contains("viper");
	backgroundCanvas.style.background = light ? lightBg : isViper ? viperBg : darkBg;
	compositePhase();
}
applyThemeColors(isLight);
document.addEventListener("themechange", (e) => { isViper = e.detail.theme === "viper"; applyThemeColors(e.detail.isLight); });
// #endregion

function buildDoublePendulums() {
	pendulums = [];
	lastPos = [];
	const spread = Math.pow(10, spreadExp);
	for (let i = 0; i < copies; i++) {
		const p = new DoublePendulum({
			L1: arm1,
			L2: arm2,
			m2: mass2,
			theta1: baseTheta1 + i * spread, // tiny perturbation -> chaotic fan-out
			theta2: baseTheta2,
			hue: copies === 1 ? 18 : 45 - (i / Math.max(copies - 1, 1)) * 70,
		});
		p.omega1 = baseOmega1;
		p.omega2 = baseOmega2;
		pendulums.push(p);
		lastPos.push(null);
	}
	resetTrails();
	resetPhase();
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
updatePhaseVisibility();

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	resetTrails();
	clearCanvas();
});
// #endregion

// #region bob dragging
var dragBob = 0; // 0 = none, 1 = first bob, 2 = second bob
const GRAB_RADIUS = 30;

function nearestBob(mx, my) {
	if (mode !== "double" || pendulums.length === 0) return 0;
	const L = layout();
	const pos = pendulums[0].positions(L.pivotX, L.pivotY, L.scale);
	const d1 = Math.hypot(mx - pos.x1, my - pos.y1);
	const d2 = Math.hypot(mx - pos.x2, my - pos.y2);
	if (d2 <= GRAB_RADIUS && d2 <= d1) return 2;
	if (d1 <= GRAB_RADIUS) return 1;
	return 0;
}

// Re-seed every copy from the dragged base angles, velocities zeroed.
function applyBaseState() {
	const spread = Math.pow(10, spreadExp);
	for (let i = 0; i < pendulums.length; i++) {
		const p = pendulums[i];
		p.theta1 = baseTheta1 + i * spread;
		p.theta2 = baseTheta2;
		p.omega1 = baseOmega1;
		p.omega2 = baseOmega2;
	}
	resetTrails();
	resetPhase();
	acc = 0;
}

function applyDrag(mx, my) {
	const L = layout();
	if (dragBob === 1) {
		baseTheta1 = Math.atan2(mx - L.pivotX, my - L.pivotY);
	} else {
		const pos = pendulums[0].positions(L.pivotX, L.pivotY, L.scale);
		baseTheta2 = Math.atan2(mx - pos.x1, my - pos.y1);
	}
	applyBaseState();
	syncInitialSliders();
}

backgroundCanvas.addEventListener("pointerdown", function (e) {
	const bob = nearestBob(e.clientX, e.clientY);
	if (!bob) return;
	dragBob = bob;
	backgroundCanvas.setPointerCapture(e.pointerId);
	backgroundCanvas.style.cursor = "grabbing";
	applyDrag(e.clientX, e.clientY);
});

backgroundCanvas.addEventListener("pointermove", function (e) {
	if (dragBob) {
		applyDrag(e.clientX, e.clientY);
	} else {
		backgroundCanvas.style.cursor = nearestBob(e.clientX, e.clientY) ? "grab" : "default";
	}
});

function endDrag() {
	dragBob = 0;
	backgroundCanvas.style.cursor = "default";
}
backgroundCanvas.addEventListener("pointerup", endDrag);
backgroundCanvas.addEventListener("pointercancel", endDrag);
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

const speedCtrl = slider("speedSlider", "speedValue", parseFloat, (v) => v.toFixed(1), (v) => { timeScale = v; });
const copiesCtrl = slider("copiesSlider", "copiesValue", parseInt, null, (v) => { copies = v; buildDoublePendulums(); });
const gravityCtrl = slider("gravitySlider", "gravityValue", parseFloat, (v) => v.toFixed(1), (v) => { gravity = v; });
const dampingCtrl = slider("dampingSlider", "dampingValue", parseFloat, (v) => v.toFixed(3), (v) => { damping = v; });
const arm1Ctrl = slider("arm1Slider", "arm1Value", parseFloat, (v) => v.toFixed(2), (v) => { arm1 = v; buildDoublePendulums(); });
const arm2Ctrl = slider("arm2Slider", "arm2Value", parseFloat, (v) => v.toFixed(2), (v) => { arm2 = v; buildDoublePendulums(); });
const mass2Ctrl = slider("mass2Slider", "mass2Value", parseFloat, (v) => v.toFixed(1), (v) => { mass2 = v; for (const p of pendulums) p.m2 = v; });
const spreadCtrl = slider("spreadSlider", "spreadValue", parseInt, (v) => "1e" + v, (v) => { spreadExp = v; buildDoublePendulums(); });
const theta1Ctrl = slider("theta1Slider", "theta1Value", parseFloat, (v) => v.toFixed(0) + "°", (v) => { baseTheta1 = (v * Math.PI) / 180; applyBaseState(); });
const theta2Ctrl = slider("theta2Slider", "theta2Value", parseFloat, (v) => v.toFixed(0) + "°", (v) => { baseTheta2 = (v * Math.PI) / 180; applyBaseState(); });
const omega1Ctrl = slider("omega1Slider", "omega1Value", parseFloat, (v) => v.toFixed(1), (v) => { baseOmega1 = v; applyBaseState(); });
const omega2Ctrl = slider("omega2Slider", "omega2Value", parseFloat, (v) => v.toFixed(1), (v) => { baseOmega2 = v; applyBaseState(); });

// Reflect the base initial conditions into the Initial-conditions sliders,
// so bob dragging and the sliders stay in sync as two input paths.
function syncInitialSliders() {
	initSlider(theta1Ctrl, Math.round((wrapAngle(baseTheta1) * 180) / Math.PI));
	initSlider(theta2Ctrl, Math.round((wrapAngle(baseTheta2) * 180) / Math.PI));
	initSlider(omega1Ctrl, baseOmega1);
	initSlider(omega2Ctrl, baseOmega2);
}
const fadeCtrl = slider("fadeSpeedSlider", "fadeSpeedValue", parseInt, null, (v) => { fadeSpeed = v / 100; });

const waveCountCtrl = slider("waveCountSlider", "waveCountValue", parseInt, null, (v) => { waveCount = v; buildWave(); });
const periodCtrl = slider("periodSlider", "periodValue", parseInt, null, (v) => { wavePeriod = v; buildWave(); });
const amplitudeCtrl = slider("amplitudeSlider", "amplitudeValue", parseInt, null, (v) => { waveAmplitudeDeg = v; buildWave(); });

initSlider(speedCtrl, timeScale);
initSlider(copiesCtrl, copies);
initSlider(gravityCtrl, gravity);
initSlider(dampingCtrl, damping);
initSlider(arm1Ctrl, arm1);
initSlider(arm2Ctrl, arm2);
initSlider(mass2Ctrl, mass2);
initSlider(spreadCtrl, spreadExp);
syncInitialSliders();
initSlider(fadeCtrl, fadeSpeed * 100);
initSlider(waveCountCtrl, waveCount);
initSlider(periodCtrl, wavePeriod);
initSlider(amplitudeCtrl, waveAmplitudeDeg);

var trailCheckbox = document.getElementById("trailCheckbox");
trailCheckbox.checked = traceEnabled;
trailCheckbox.onclick = function () { traceEnabled = this.checked; resetTrails(); };

var rodsCheckbox = document.getElementById("rodsCheckbox");
rodsCheckbox.checked = showRods;
rodsCheckbox.onclick = function () { showRods = this.checked; };

var phaseCheckbox = document.getElementById("phaseCheckbox");
phaseCheckbox.checked = phaseEnabled;
phaseCheckbox.onclick = function () {
	phaseEnabled = this.checked;
	resetPhase();
	updatePhaseVisibility();
};

document.querySelectorAll('input[name="phasePair"]').forEach(function (radio) {
	radio.addEventListener("change", function () {
		if (!this.checked) return;
		phasePair = this.value;
		resetPhase();
	});
});

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
		updatePhaseVisibility();
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


window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") resetSim();
});
// #endregion

// #region rendering — double pendulum
function renderDouble(advanced, dt) {
	clearCanvas();
	const L = layout();
	const pivotX = L.pivotX;
	const pivotY = L.pivotY;
	const scale = L.scale;

	if (traceEnabled && advanced) {
		// Fade in batches: a tiny per-frame alpha dies in 8-bit rounding, so
		// accumulate the multiplier and ping-pong only once it has real bite.
		trailFadeAcc *= Math.exp(-TRAIL_FADE_RATE * fadeSpeed * dt);
		if (trailFadeAcc <= 0.94) {
			trailBackCtx.clearRect(0, 0, canvasWidth, canvasHeight);
			trailBackCtx.globalAlpha = trailFadeAcc;
			trailBackCtx.drawImage(trailFront, 0, 0);
			trailBackCtx.globalAlpha = 1;
			const tmp = trailFront; trailFront = trailBack; trailBack = tmp;
			const tmpCtx = trailFrontCtx; trailFrontCtx = trailBackCtx; trailBackCtx = tmpCtx;
			trailFadeAcc = 1;
		}

		// dark theme: additive blend so overlapping chaotic trails bloom into hot light
		if (!isLight) trailFrontCtx.globalCompositeOperation = "lighter";
		const baseAlpha = copies > 6 ? 0.5 : 0.8;
		const lightness = isLight ? 45 : 62;
		trailFrontCtx.lineWidth = 1.8;
		for (let i = 0; i < pendulums.length; i++) {
			const p = pendulums[i];
			const pos = p.positions(pivotX, pivotY, scale);
			const prev = lastPos[i];
			if (prev) {
				trailFrontCtx.beginPath();
				trailFrontCtx.moveTo(prev.x, prev.y);
				trailFrontCtx.lineTo(pos.x2, pos.y2);
				trailFrontCtx.strokeStyle = `hsla(${p.hue}, 85%, ${lightness}%, ${baseAlpha})`;
				trailFrontCtx.stroke();
				prev.x = pos.x2; prev.y = pos.y2;
			} else {
				lastPos[i] = { x: pos.x2, y: pos.y2 };
			}
		}
		trailFrontCtx.globalCompositeOperation = "source-over";
	}

	if (traceEnabled) {
		if (!isLight) ctx.globalCompositeOperation = "lighter";
		ctx.drawImage(trailFront, 0, 0);
		ctx.globalCompositeOperation = "source-over";
	}

	for (let i = 0; i < pendulums.length; i++) {
		const p = pendulums[i];
		const pos = p.positions(pivotX, pivotY, scale);

		if (showRods) {
			ctx.beginPath();
			ctx.moveTo(pivotX, pivotY);
			ctx.lineTo(pos.x1, pos.y1);
			ctx.lineTo(pos.x2, pos.y2);
			ctx.strokeStyle = isLight ? "rgba(60,40,20,0.45)" : isViper ? "rgba(40,255,69,0.35)" : "rgba(220,200,170,0.4)";
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
	drawBob(pivotX, pivotY, 4, isLight ? "#3a2210" : isViper ? "#4f8f3f" : "#a08060");
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
	// Clamp rod length so the outermost bobs at full amplitude stay inside
	// the side edges and the longest rod stays above the bottom edge.
	const pad = 14;
	const maxSin = Math.sin(Math.min((waveAmplitudeDeg * Math.PI) / 180, Math.PI / 2));
	let maxLen = Math.min(canvasHeight * 0.68, canvasHeight - railY - pad);
	if (maxSin > 0) maxLen = Math.min(maxLen, (marginX - pad) / maxSin);
	maxLen = Math.max(maxLen, 40);
	const minLen = Math.min(canvasHeight * 0.18, maxLen * 0.4);

	// Rail
	ctx.beginPath();
	ctx.moveTo(marginX - 20, railY);
	ctx.lineTo(canvasWidth - marginX + 20, railY);
	ctx.strokeStyle = isLight ? "rgba(60,40,20,0.35)" : isViper ? "rgba(40,255,69,0.25)" : "rgba(200,180,150,0.3)";
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
		ctx.strokeStyle = isLight ? "rgba(60,40,20,0.3)" : isViper ? "rgba(40,255,69,0.20)" : "rgba(200,180,150,0.25)";
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
var lastTime = performance.now();
var acc = 0; // unsimulated time backlog (s) — decouples sim clock from display fps

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	let dt = (now - lastTime) / 1000;
	lastTime = now;
	if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
	if (dt < 0) dt = 0;

	let advanced = false;
	if (!paused && !dragBob) {
		if (mode === "double") {
			acc += dt * timeScale;
			let steps = 0;
			while (acc >= STEP && steps < MAX_STEPS) {
				for (let i = 0; i < pendulums.length; i++) pendulums[i].step(STEP, gravity, damping);
				acc -= STEP;
				steps++;
			}
			if (steps >= MAX_STEPS) acc = 0;
			advanced = steps > 0;
		} else {
			waveTime += dt * timeScale;
			advanced = true;
		}
	}

	if (mode === "double") {
		renderDouble(advanced, dt);
		if (phaseEnabled && advanced) updatePhase(dt);
	} else {
		renderWave();
	}

	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		fpsBadge.textContent = Math.round((frameCount * 1000) / (now - lastFpsUpdate)) + " fps";
		frameCount = 0;
		lastFpsUpdate = now;
	}
}
window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => {
	if (!document.hidden) {
		lastTime = performance.now();
		window.requestAnimationFrame(draw);
	}
});
// #endregion
