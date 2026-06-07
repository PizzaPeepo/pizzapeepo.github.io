import * as helpers from "../Utils/helpers.js";
import Polygon from "../Utils/polygon.js";
import Vector2D from "../Utils/Vector2D.js";
import { onThemeChange } from "../Utils/ThemeManager.js";
import { onWindowResize } from "../Utils/ResizeManager.js";
import { setupCanvases } from "../Utils/CanvasManager.js";

// #region global variables
var canvasHeight = window.innerHeight;
var canvasWidth = window.getCanvasWidth();
var resetCanvas = false;
var rainbowColorsEnabled = true;
var hue = 0;
var squareOrigin = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
var enclosingSize = Math.min(canvasWidth, canvasHeight) * 0.5;
var delta_angle = 0.002;
var sidesCount = 4;
var angles = helpers.range(0, (2 * Math.PI) / sidesCount, delta_angle);
var polygonCount = 10;
let strokeColor = 'rgba(255, 255, 255, 1.0)';
let polygons = [];
let trailEnabled = false;
let fadeSpeed = 0.05;
let iFloat = 0;
let mousePos = { x: canvasWidth / 2, y: canvasHeight / 2 };
// #endregion

// Double-buffer fade: ping-pong two offscreen canvases, decay prev by (1-fade) via
// drawImage+globalAlpha (truncates cleanly to 0 in Chrome). O(polygons) per tick, constant
// over time — replaces FadeTrail's O(trail_len x polygons) replay. See Utils/FadeTrail.js.
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

function ClearAndAddPolygonsToArray() {
	polygons = [];
	// Keep circumradius constant across all N: edgeLength = R * 2*sin(π/N),
	// where R is fixed to the N=4 base (enclosingSize / (2*sin(π/4))).
	const scaledEdgeLength = enclosingSize * Math.sin(Math.PI / sidesCount) / Math.sin(Math.PI / 4);
	for (let i = 0; i < polygonCount; i++) {
		polygons.push(new Polygon(squareOrigin, scaledEdgeLength, 0, sidesCount));
	}
	resetTrail();
	iFloat = 0;
}

ClearAndAddPolygonsToArray();

// #region canvas setup
var backgroundCanvas = document.getElementById("backgroundCanvas");
var bgCtx = backgroundCanvas.getContext("2d");

function applyCanvasSize() {
	setupCanvases([
		{ canvas: backgroundCanvas, configure: (ctx) => { ctx.strokeStyle = strokeColor; ctx.lineWidth = 2; } },
	], canvasWidth, canvasHeight);
}
applyCanvasSize();
// #endregion

// #region theme
let bgColor = '#18140e';
function applyThemeColors(isLight) {
	bgColor = isLight ? '#f5ede0' : '#18140e';
	backgroundCanvas.style.background = bgColor;
	strokeColor = isLight ? 'rgba(20, 10, 0, 1.0)' : 'rgba(255, 255, 255, 1.0)';
	bgCtx.strokeStyle = strokeColor;
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
	squareOrigin = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
	enclosingSize = Math.min(canvasWidth, canvasHeight) * 0.5;
	ClearAndAddPolygonsToArray();
	resetCanvas = true;
});
// #endregion

// #region inputs
var rotationSpeedSlider = document.getElementById("rotationSpeedSlider");
rotationSpeedSlider.value = delta_angle;
var rotationSpeedValue = document.getElementById("rotationSpeedValue");
rotationSpeedValue.innerHTML = Math.floor(rotationSpeedSlider.value * 10000);

rotationSpeedSlider.oninput = function() {
	rotationSpeedValue.innerHTML = Math.floor(this.value * 10000);
	delta_angle = parseFloat(this.value);
	angles = helpers.range(0, (2 * Math.PI) / sidesCount, delta_angle);
	resetTrail();
	iFloat = 0;
};

var polygonCountSlider = document.getElementById("polygonCountSlider");
polygonCountSlider.value = polygonCount;
var polygonCountValue = document.getElementById("polygonCountValue");
polygonCountValue.innerHTML = polygonCountSlider.value;

polygonCountSlider.oninput = function() {
	polygonCountValue.innerHTML = this.value;
	polygonCount = parseInt(this.value);
	ClearAndAddPolygonsToArray();
};

var sidesSlider = document.getElementById("sidesSlider");
sidesSlider.value = sidesCount;
var sidesValue = document.getElementById("sidesValue");
sidesValue.innerHTML = sidesCount;

sidesSlider.oninput = function() {
	sidesValue.innerHTML = this.value;
	sidesCount = parseInt(this.value);
	angles = helpers.range(0, (2 * Math.PI) / sidesCount, delta_angle);
	ClearAndAddPolygonsToArray();
};

var baseColorSlider = document.getElementById("baseColorSlider");
baseColorSlider.value = hue;
var baseColorValue = document.getElementById("baseColorValue");
baseColorValue.innerHTML = baseColorSlider.value;

baseColorSlider.oninput = function() {
	baseColorValue.innerHTML = this.value;
	hue = parseFloat(this.value);
	if (!rainbowColorsEnabled) {
		bgCtx.strokeStyle = "hsl(" + hue + ", 100%, 70%)";
	}
};

var rainbowColorCheckbox = document.getElementById("rainbowColorCheckbox");
rainbowColorCheckbox.checked = rainbowColorsEnabled;
rainbowColorCheckbox.onclick = function() { rainbowColorsEnabled = this.checked; };

var trailCheckbox = document.getElementById("trailCheckbox");
trailCheckbox.checked = trailEnabled;
trailCheckbox.onclick = function() {
	trailEnabled = this.checked;
	resetTrail();
};

var fadeSpeedSlider = document.getElementById("fadeSpeedSlider");
fadeSpeedSlider.value = fadeSpeed;
var fadeSpeedValue = document.getElementById("fadeSpeedValue");
fadeSpeedValue.innerHTML = Math.floor(fadeSpeed * 100);

fadeSpeedSlider.oninput = function() {
	fadeSpeed = parseFloat(this.value);
	fadeSpeedValue.innerHTML = Math.floor(fadeSpeed * 100);
	resetTrail();
};

var resetCanvasButton = document.getElementById("resetCanvasButton");
resetCanvasButton.onclick = function() { resetCanvas = true; if (paused) setPaused(false); };


// pause / fps
var paused = false;
var pauseButton = document.getElementById("pauseButton");
function setPaused(p) {
	if (p === paused) return;
	paused = p;
	if (pauseButton) pauseButton.textContent = paused ? 'Resume (Space)' : 'Pause (Space)';
	if (!paused) { _fpsLast = 0; window.requestAnimationFrame(draw); }
}
if (pauseButton) pauseButton.onclick = () => setPaused(!paused);

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

// #region mouse
window.addEventListener('mousemove', function(e) {
	mousePos = helpers.GetMousePos(backgroundCanvas, e);
});
// #endregion


window.addEventListener('keydown', function(e) {
	if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
	if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
	if (e.key === 'r' || e.key === 'R') { resetCanvas = true; if (paused) setPaused(false); }
});

function drawPolygonsAtAngle(ctx, angle, opacity) {
	const bgCtx = ctx; // draw onto supplied target (back buffer when trailing, visible canvas otherwise)
	bgCtx.save();
	bgCtx.globalAlpha = opacity;
	for (let j = 1; j < polygons.length; j++) {
		bgCtx.beginPath();
		polygons[j].RotateInsidePolygon(polygons[j - 1], polygons[j - 1].alpha + angle);
		bgCtx.save();
		if (rainbowColorsEnabled) {
			bgCtx.strokeStyle =
				"hsl(" + helpers.RadianToDegree(polygons[j].alpha / 2 + helpers.DegreeToRadian(hue)) + ", 100%, 70%)";
		} else {
			bgCtx.strokeStyle = strokeColor;
		}
		polygons[j].Draw(bgCtx);
		bgCtx.stroke();
		bgCtx.restore();
	}

	bgCtx.beginPath();
	bgCtx.save();
	if (rainbowColorsEnabled) {
		bgCtx.strokeStyle =
			"hsl(" + helpers.RadianToDegree(polygons[1].alpha / 2 + helpers.DegreeToRadian(hue)) + ", 100%, 70%)";
	} else {
		bgCtx.strokeStyle = strokeColor;
	}
	polygons[0].Draw(bgCtx);
	bgCtx.stroke();
	bgCtx.restore();

	bgCtx.restore();
}

function draw(ts) {
	updateFps(ts || performance.now());
	if (resetCanvas) {
		iFloat = 0;
		resetCanvas = false;
		resetTrail();
	}

	if (iFloat >= angles.length) iFloat = 0;

	const i = Math.floor(iFloat);
	const currentAngle = angles[i];

	const dist = Math.hypot(mousePos.x - squareOrigin.x, mousePos.y - squareOrigin.y);
	const maxDist = Math.min(canvasWidth, canvasHeight) * 0.5;
	const proximity = 1 - Math.min(dist / maxDist, 1);
	const speedMult = 1 + proximity * 4;
	iFloat += speedMult;

	bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	if (trailEnabled) {
		// double-buffer fade (see initTrailCanvases): O(polygons) per tick, constant over time
		const [frontCanvas, backCtx] = _trailFront === 'A' ? [_trailA, _trailCtxB] : [_trailB, _trailCtxA];
		backCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		backCtx.globalAlpha = 1 - Number(fadeSpeed);
		backCtx.drawImage(frontCanvas, 0, 0);
		backCtx.globalAlpha = 1.0;
		drawPolygonsAtAngle(backCtx, currentAngle, 1.0);
		_trailFront = _trailFront === 'A' ? 'B' : 'A';
		const newFront = _trailFront === 'A' ? _trailA : _trailB;
		bgCtx.drawImage(newFront, 0, 0);
	} else {
		drawPolygonsAtAngle(bgCtx, currentAngle, 1.0);
	}

	if (document.hidden || paused) return;
	window.requestAnimationFrame(draw);
}

draw();
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
