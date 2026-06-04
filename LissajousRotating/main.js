import RotatingLissajousFigure from "./RotatingLissajousFigure.js";
import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";

// #region global variables
const HUD_PANEL_WIDTH = 280;
var canvasHeight = window.innerHeight;
var canvasWidth = window.innerWidth - HUD_PANEL_WIDTH;
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var fadeAway = true;
var liveResetCanvas = false;
var resetCanvas = false;
var fadeAwaySpeed = 0.3;
var lissFigureSize = Math.min(canvasWidth, canvasHeight) * 0.45;
var delta_phaseshift = 0.015;
var omega1 = 1;
var omega2 = 1;
let fadeColor = 'rgba(24,18,14,';

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
	backgroundCanvas.width  = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width  = canvasWidth + 'px';
	backgroundCanvas.style.height = canvasHeight + 'px';
	bgCtx.strokeStyle = whiteLineStrokeStyle;
	bgCtx.lineWidth = 2;
	foregroundCanvas.width  = canvasWidth;
	foregroundCanvas.height = canvasHeight;
	foregroundCanvas.style.width  = canvasWidth + 'px';
	foregroundCanvas.style.height = canvasHeight + 'px';
	fgCtx.strokeStyle = whiteLineStrokeStyle;
	fgCtx.lineWidth = 2;
}
applyCanvasSize();
// #endregion

// #region theme
function applyThemeColors(isLight) {
	backgroundCanvas.style.background = isLight ? '#f5ede0' : '#18140e';
	fadeColor = isLight ? 'rgba(245,237,224,' : 'rgba(24,18,14,';
}
applyThemeColors(document.documentElement.classList.contains('light'));
document.addEventListener('themechange', function(e) {
	applyThemeColors(e.detail.isLight);
});
// #endregion

// #region resize
window.addEventListener('resize', function() {
	canvasWidth  = window.innerWidth - HUD_PANEL_WIDTH;
	canvasHeight = window.innerHeight;
	applyCanvasSize();
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
resetCanvasButton.onclick = function() { resetCanvas = true; };
// #endregion

function draw() {
	if (fadeAway) {
		bgCtx.save();
		bgCtx.fillStyle = fadeColor + fadeAwaySpeed + ")";
		bgCtx.fillRect(0, 0, canvasWidth, canvasHeight);
		bgCtx.restore();
	}
	if (i * delta_phaseshift > 6.28 || resetCanvas == true) {
		i = 0;
		resetCanvas = false;
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	}

	lissajous.Update(lissFigureSize, omega1, omega2, 0, t[i]);
	lissajous.DrawWholeFigure(bgCtx, fgCtx);
	i++;
	if (document.hidden) return;
	window.requestAnimationFrame(draw);
}

draw();
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
