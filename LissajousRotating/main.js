import RotatingLissajousFigure from "./RotatingLissajousFigure.js";
import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";
import { onThemeChange } from "../Utils/ThemeManager.js";
import { onWindowResize } from "../Utils/ResizeManager.js";
import { setupCanvases } from "../Utils/CanvasManager.js";

// #region global variables
var canvasHeight = window.innerHeight;
var canvasWidth = window.getCanvasWidth();
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var fadeAway = true;
var liveResetCanvas = false;
var resetCanvas = false;
var fadeAwaySpeed = 0.3;
var lissFigureSize = Math.min(canvasWidth, canvasHeight) * 0.45;
var delta_phaseshift = 0.015;
var omega1 = 1;
var omega2 = 4;

// Double-buffer fade: ping-pong two offscreen canvases, decay prev by (1-fade) via
// drawImage+globalAlpha (truncates cleanly to 0 in Chrome). O(1 figure) per tick, constant
// over time — replaces FadeTrail's O(trail_len x figure) replay. See Utils/FadeTrail.js.
const _dummyCtx = document.createElement('canvas').getContext('2d');
const _trailA = document.createElement('canvas');
const _trailB = document.createElement('canvas');
let _trailCtxA, _trailCtxB, _trailFront = 'A';
function initTrailCanvases() {
	_trailA.width = canvasWidth; _trailA.height = canvasHeight;
	_trailB.width = canvasWidth; _trailB.height = canvasHeight;
	_trailCtxA = _trailA.getContext('2d');
	_trailCtxB = _trailB.getContext('2d');
}
initTrailCanvases();
function resetTrail() {
	_trailCtxA.clearRect(0, 0, _trailA.width, _trailA.height);
	_trailCtxB.clearRect(0, 0, _trailB.width, _trailB.height);
	_trailFront = 'A';
}

let t = helpers.range(0, 6.28, delta_phaseshift);
let i = 0;

let center = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
let lissajous = new RotatingLissajousFigure(center, lissFigureSize, 1, 4, 0, Math.PI / 2);
// #endregion

// #region canvas setup
var backgroundCanvas = document.getElementById("backgroundCanvas");
var bgCtx = backgroundCanvas.getContext("2d");
var foregroundCanvas = document.getElementById("foregroundCanvas");
var fgCtx = foregroundCanvas.getContext("2d");

function applyCanvasSize() {
	setupCanvases([
		{ canvas: backgroundCanvas, configure: (ctx) => { ctx.strokeStyle = whiteLineStrokeStyle; ctx.lineWidth = 2; } },
		{ canvas: foregroundCanvas, configure: (ctx) => { ctx.strokeStyle = whiteLineStrokeStyle; ctx.lineWidth = 2; } },
	], canvasWidth, canvasHeight);
}
applyCanvasSize();
// #endregion

// #region theme
function applyThemeColors(isLight) {
	backgroundCanvas.style.background = isLight ? '#f5ede0' : '#18140e';
}
onThemeChange(applyThemeColors);
// #endregion

// #region resize
onWindowResize(function() {
	canvasWidth  = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	initTrailCanvases();
	center = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
	lissFigureSize = Math.min(canvasWidth, canvasHeight) * 0.45;
	lissajous = new RotatingLissajousFigure(center, lissFigureSize, omega1, omega2, 0, Math.PI / 2);
	resetCanvas = true;
});
// #endregion

// #region Inputs
var omega1Slider = document.getElementById("omega1Slider");
omega1Slider.value = omega1;
var omega1Value = document.getElementById("omega1Value");
omega1Value.innerHTML = omega1Slider.value;

omega1Slider.oninput = function() {
	omega1Value.innerHTML = this.value;
	omega1 = this.value;
	if (liveResetCanvas) {
		resetCanvas = true;
	}
};

var omega2Slider = document.getElementById("omega2Slider");
omega2Slider.value = omega2;
var omega2Value = document.getElementById("omega2Value");
omega2Value.innerHTML = omega2Slider.value;

omega2Slider.oninput = function() {
	omega2Value.innerHTML = this.value;
	omega2 = this.value;
	if (liveResetCanvas) {
		resetCanvas = true;
	}
};

var phaseshiftSlider = document.getElementById("phaseshiftSlider");
phaseshiftSlider.value = delta_phaseshift;
var phaseshiftValue = document.getElementById("phaseshiftValue");
phaseshiftValue.innerHTML = phaseshiftSlider.value;

phaseshiftSlider.oninput = function() {
	phaseshiftValue.innerHTML = this.value;
	delta_phaseshift = this.value;
	t = helpers.range(0, 6.28, delta_phaseshift);
	if (liveResetCanvas) {
		resetCanvas = true;
	}
};

var fadeAwaySpeedSlider = document.getElementById("fadeAwaySpeedSlider");
fadeAwaySpeedSlider.value = fadeAwaySpeed;
var fadeAwaySpeedValue = document.getElementById("fadeAwaySpeedValue");
fadeAwaySpeedValue.innerHTML = fadeAwaySpeedSlider.value;

fadeAwaySpeedSlider.oninput = function() {
	fadeAwaySpeedValue.innerHTML = this.value;
	fadeAwaySpeed = this.value;
	resetTrail();
	if (liveResetCanvas) {
		resetCanvas = true;
	}
};

var fadeAwayCheckbox = document.getElementById("fadeAwayCheckbox");
fadeAwayCheckbox.checked = fadeAway;
fadeAwayCheckbox.onclick = function() { fadeAway = this.checked; };

var liveResetCheckbox = document.getElementById("liveResetCheckbox");
liveResetCheckbox.checked = liveResetCanvas;
liveResetCheckbox.onclick = function() { liveResetCanvas = this.checked; };

var resetCanvasButton = document.getElementById("resetCanvasButton");
resetCanvasButton.onclick = function() { resetCanvas = true; if (paused) setPaused(false); };

// pause / save / fps
var paused = false;
var pauseButton = document.getElementById("pauseButton");
function setPaused(p) {
	if (p === paused) return;
	paused = p;
	if (pauseButton) pauseButton.textContent = paused ? 'Resume (Space)' : 'Pause (Space)';
	if (!paused) { _fpsLast = 0; window.requestAnimationFrame(draw); }
}
if (pauseButton) pauseButton.onclick = () => setPaused(!paused);

function savePNG() {
	const out = document.createElement('canvas');
	out.width = canvasWidth; out.height = canvasHeight;
	const octx = out.getContext('2d');
	octx.fillStyle = document.documentElement.classList.contains('light') ? '#f5ede0' : '#18140e';
	octx.fillRect(0, 0, canvasWidth, canvasHeight);
	octx.drawImage(backgroundCanvas, 0, 0);
	octx.drawImage(foregroundCanvas, 0, 0);
	const a = document.createElement('a');
	a.download = 'lissajous-rotating-' + Date.now() + '.png';
	a.href = out.toDataURL('image/png');
	a.click();
}
var exportButton = document.getElementById("exportButton");
if (exportButton) exportButton.onclick = savePNG;

document.addEventListener('keydown', (e) => {
	if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
	if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
	if (e.key === 'r' || e.key === 'R') { resetCanvas = true; if (paused) setPaused(false); }
	if (e.key === 's' || e.key === 'S') savePNG();
});

var fpsBadge = document.getElementById("fpsBadge");
var _fpsLast = 0, _fpsAccum = 0, _fpsFrames = 0;
function updateFps(ts) {
	if (_fpsLast) { _fpsAccum += ts - _fpsLast; _fpsFrames++; }
	_fpsLast = ts;
	if (_fpsAccum >= 500 && fpsBadge) {
		fpsBadge.textContent = Math.round(1000 / (_fpsAccum / _fpsFrames)) + ' fps';
		_fpsAccum = 0; _fpsFrames = 0;
	}
}
// #endregion

function draw(ts) {
	updateFps(ts || performance.now());
	if (i * delta_phaseshift > 6.28 || resetCanvas) {
		i = 0;
		resetTrail();
		resetCanvas = false;
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	}

	if (fadeAway) {
		// double-buffer fade (see initTrailCanvases): O(1 figure) per tick, constant over time
		const [frontCanvas, backCtx] = _trailFront === 'A' ? [_trailA, _trailCtxB] : [_trailB, _trailCtxA];
		backCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		backCtx.globalAlpha = 1 - Number(fadeAwaySpeed);
		backCtx.drawImage(frontCanvas, 0, 0);
		backCtx.globalAlpha = 1.0;
		lissajous.Update(lissFigureSize, omega1, omega2, 0, t[i]);
		lissajous.DrawWholeFigure(backCtx, _dummyCtx, 1.0);
		_trailFront = _trailFront === 'A' ? 'B' : 'A';
		const newFront = _trailFront === 'A' ? _trailA : _trailB;
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		bgCtx.drawImage(newFront, 0, 0);
	} else {
		lissajous.Update(lissFigureSize, omega1, omega2, 0, t[i]);
		lissajous.DrawWholeFigure(bgCtx, fgCtx, 1.0);
	}

	document.getElementById('ratioReadout').textContent = parseFloat(omega1) + ' : ' + parseFloat(omega2);
	document.getElementById('phaseReadout').textContent = (t[i] / 6.28 * 360).toFixed(1) + '°';
	i++;
	if (document.hidden || paused) return;
	window.requestAnimationFrame(draw);
}

draw();
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
