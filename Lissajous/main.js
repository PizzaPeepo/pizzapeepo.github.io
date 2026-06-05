import Vector2D from "../Utils/Vector2D.js";
import * as helpers from "../Utils/helpers.js";
import Lissajous from "./LissajousFigure.js";
import LissajousTable from "./LissajousTable.js";
import FadeTrail from "../Utils/FadeTrail.js";
import { onThemeChange } from "../Utils/ThemeManager.js";
import { onWindowResize } from "../Utils/ResizeManager.js";
import { setupCanvases } from "../Utils/CanvasManager.js";

// #region global variables
var canvasHeight = window.innerHeight;
var canvasWidth = window.getCanvasWidth();
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var delta_t = 0.015;
var t = helpers.range(0, 500, delta_t);
var lissFigureSize = 100;
var fadeAway = false;
var fadeAwaySpeed = 0.01;
var lissajousTable = new LissajousTable(canvasWidth, canvasHeight, lissFigureSize);
var liveResetCanvas = false;
var resetCanvas = false;
var i = 0;

const trail = new FadeTrail(500);
const _dummyCtx = document.createElement('canvas').getContext('2d');
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
	trail.reset();
};

var fadeAwayCheckbox = document.getElementById("fadeAwayCheckbox");
fadeAwayCheckbox.checked = fadeAway;
fadeAwayCheckbox.onclick = function() { fadeAway = this.checked; };

var liveResetCheckbox = document.getElementById("liveResetCheckbox");
liveResetCheckbox.checked = liveResetCanvas;
liveResetCheckbox.onclick = function() { liveResetCanvas = this.checked; };

var resetCanvasButton = document.getElementById("resetCanvasButton");
resetCanvasButton.onclick = function() { resetCanvas = true; };
// #endregion

// #region animation
function draw() {
	fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	if (i >= 2 * 629 || resetCanvas == true) {
		i = 0;
		trail.reset();
		resetCanvas = false;
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	}

	if (fadeAway) {
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		trail.push(i);
		trail.render(fadeAwaySpeed, (frameIdx, opacity) => {
			bgCtx.save();
			bgCtx.globalAlpha = opacity;
			for (let row = 0; row < lissajousTable.rows; row++) {
				for (let col = 0; col < lissajousTable.cols; col++) {
					if ((row === 0) && (col === 0)) continue;
					lissajousTable.figures[row][col].Draw(bgCtx, _dummyCtx, t[frameIdx], t[frameIdx + 1]);
				}
			}
			bgCtx.restore();
		});
		// Draw fgCtx head dots for current step only
		for (let row = 0; row < lissajousTable.rows; row++) {
			for (let col = 0; col < lissajousTable.cols; col++) {
				if ((row === 0) && (col === 0)) continue;
				lissajousTable.figures[row][col].Draw(_dummyCtx, fgCtx, t[i], t[i + 1]);
			}
		}
	} else {
		for (let row = 0; row < lissajousTable.rows; row++) {
			for (let col = 0; col < lissajousTable.cols; col++) {
				if ((row === 0) && (col === 0)) {
					continue;
				}
				lissajousTable.figures[row][col].Draw(bgCtx, fgCtx, t[i], t[i + 1]);
			}
		}
	}
	i++;
	if (document.hidden) return;
	window.requestAnimationFrame(draw);
}
// #endregion

window.requestAnimationFrame(draw);
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
