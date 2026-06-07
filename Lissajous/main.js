import Vector2D from "../Utils/Vector2D.js";
import * as helpers from "../Utils/helpers.js";
import Lissajous from "./LissajousFigure.js";
import LissajousTable from "./LissajousTable.js";
import { onThemeChange } from "../Utils/ThemeManager.js";
import { onWindowResize } from "../Utils/ResizeManager.js";
import { setupCanvases } from "../Utils/CanvasManager.js";

// #region global variables
var canvasHeight = window.innerHeight;
var canvasWidth = window.getCanvasWidth();
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var delta_t = 0.002;
var t = helpers.range(0, 500, delta_t);
var lissFigureSize = 100;
var fadeAway = false;
var showLines = true;
var fadeAwaySpeed = 0.01;
var lissajousTable = new LissajousTable(canvasWidth, canvasHeight, lissFigureSize);
var liveResetCanvas = false;
var resetCanvas = false;
var i = 0;

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
	lissajousTable = new LissajousTable(canvasWidth, canvasHeight, lissFigureSize);
	initTrailCanvases();
	resetCanvas = true;
});
// #endregion

// #region drawing functions
function drawPoint(point) {
	if (typeof point === "undefined" || point === null) {
		return;
	}
	bgCtx.save();
	bgCtx.beginPath();
	bgCtx.fillStyle = "#FFFF00";
	bgCtx.fillRect(point.x, point.y, 1, 1);
	bgCtx.restore();
}

function drawCircle(origin, radius, rgbaStroke) {
	bgCtx.save();
	bgCtx.beginPath();
	bgCtx.strokeStyle = rgbaStroke;
	bgCtx.arc(origin.x, origin.y, radius, 0, 2 * Math.PI);
	bgCtx.stroke();
	bgCtx.restore();
}

function drawFilledCircle(origin, radius, rgbaStroke, rgbaFill) {
	bgCtx.save();
	bgCtx.beginPath();
	bgCtx.fillStyle = rgbaFill;
	bgCtx.strokeStyle = rgbaStroke;
	bgCtx.arc(origin.x, origin.y, radius, 0, 2 * Math.PI);
	bgCtx.fill();
	bgCtx.stroke();
	bgCtx.restore();
}
// #endregion

// #region Inputs
var figureSizeSlider = document.getElementById("figureSizeSlider");
figureSizeSlider.value = lissFigureSize;
var figureSizeValue = document.getElementById("figureSizeValue");
figureSizeValue.innerHTML = figureSizeSlider.value;

figureSizeSlider.oninput = function() {
	figureSizeValue.innerHTML = this.value;
	lissFigureSize = this.value;
	lissajousTable = new LissajousTable(canvasWidth, canvasHeight, lissFigureSize);
	if (liveResetCanvas) {
		resetCanvas = true;
	}
};

var drawingSpeedSlider = document.getElementById("drawingSpeedSlider");
drawingSpeedSlider.value = delta_t;
var drawingSpeedValue = document.getElementById("drawingSpeedValue");
drawingSpeedValue.innerHTML = drawingSpeedSlider.value * 1000;

drawingSpeedSlider.oninput = function() {
	drawingSpeedValue.innerHTML = this.value * 1000;
	delta_t = this.value;
	t = helpers.range(0, 200, delta_t);
	if (liveResetCanvas) {
		resetCanvas = true;
	}
};

var fadeAwaySpeedSlider = document.getElementById("fadeAwaySpeedSlider");
fadeAwaySpeedSlider.value = fadeAwaySpeed;
var fadeAwaySpeedValue = document.getElementById("fadeAwaySpeedValue");
fadeAwaySpeedValue.innerHTML = fadeAwaySpeedSlider.value * 1000;

fadeAwaySpeedSlider.oninput = function() {
	fadeAwaySpeedValue.innerHTML = this.value * 1000;
	fadeAwaySpeed = this.value;
	resetTrail();
};

var fadeAwayCheckbox = document.getElementById("fadeAwayCheckbox");
fadeAwayCheckbox.checked = fadeAway;
fadeAwayCheckbox.onclick = function() { fadeAway = this.checked; };

var showLinesCheckbox = document.getElementById("showLinesCheckbox");
showLinesCheckbox.checked = showLines;
showLinesCheckbox.onclick = function() { showLines = this.checked; };

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
	a.download = 'lissajous-' + Date.now() + '.png';
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

// #region animation
function draw(ts) {
	updateFps(ts || performance.now());
	fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	if (i >= Math.ceil(2 * Math.PI / delta_t) || resetCanvas == true) {
		i = 0;
		resetTrail();
		resetCanvas = false;
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	}

	if (fadeAway) {
		// Double-buffer fade: decay previous trail by (1-speed), draw current frame on top.
		// O(figures) per tick — replaces O(trail_length x figures) FadeTrail replay.
		const [frontCanvas, backCtx] = _trailFront === 'A'
			? [_trailA, _trailCtxB]
			: [_trailB, _trailCtxA];
		backCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		backCtx.globalAlpha = 1 - Number(fadeAwaySpeed);
		backCtx.drawImage(frontCanvas, 0, 0);
		backCtx.globalAlpha = 1.0;
		for (let row = 0; row < lissajousTable.rows; row++) {
			for (let col = 0; col < lissajousTable.cols; col++) {
				if ((row === 0) && (col === 0)) continue;
				lissajousTable.figures[row][col].Draw(backCtx, _dummyCtx, t[i], t[i + 1], showLines);
			}
		}
		_trailFront = _trailFront === 'A' ? 'B' : 'A';
		const newFront = _trailFront === 'A' ? _trailA : _trailB;
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		bgCtx.drawImage(newFront, 0, 0);
		for (let row = 0; row < lissajousTable.rows; row++) {
			for (let col = 0; col < lissajousTable.cols; col++) {
				if ((row === 0) && (col === 0)) continue;
				lissajousTable.figures[row][col].Draw(_dummyCtx, fgCtx, t[i], t[i + 1], showLines);
			}
		}
	} else {
		for (let row = 0; row < lissajousTable.rows; row++) {
			for (let col = 0; col < lissajousTable.cols; col++) {
				if ((row === 0) && (col === 0)) {
					continue;
				}
				lissajousTable.figures[row][col].Draw(bgCtx, fgCtx, t[i], t[i + 1], showLines);
			}
		}
	}
	i++;
	if (document.hidden || paused) return;
	window.requestAnimationFrame(draw);
}
// #endregion

window.requestAnimationFrame(draw);
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
