import RotatingLissajousFigure from "./RotatingLissajousFigure.js";
import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";
import FadeTrail from "../Utils/FadeTrail.js";
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

const trail = new FadeTrail(500);

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
	trail.reset();
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
	if (i * delta_phaseshift > 6.28 || resetCanvas) {
		i = 0;
		trail.reset();
		resetCanvas = false;
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	}

	if (fadeAway) {
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		trail.push(t[i]);
		trail.render(fadeAwaySpeed, (ps2, opacity) => {
			lissajous.Update(lissFigureSize, omega1, omega2, 0, ps2);
			lissajous.DrawWholeFigure(bgCtx, fgCtx, opacity);
		});
	} else {
		lissajous.Update(lissFigureSize, omega1, omega2, 0, t[i]);
		lissajous.DrawWholeFigure(bgCtx, fgCtx, 1.0);
	}

	document.getElementById('ratioReadout').textContent = parseFloat(omega1) + ' : ' + parseFloat(omega2);
	document.getElementById('phaseReadout').textContent = (t[i] / 6.28 * 360).toFixed(1) + '°';
	i++;
	if (document.hidden) return;
	window.requestAnimationFrame(draw);
}

draw();
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
