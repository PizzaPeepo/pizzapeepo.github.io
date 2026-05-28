import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";
import Line2D from "../Raycaster/Line2D.js";

// #region global variables
var canvasHeight = window.innerHeight;
var canvasWidth = window.innerWidth;
var numberOfDots = 9;
var shift_angle = (2 * Math.PI) / numberOfDots;
let figureSize = Math.min(canvasWidth, canvasHeight) * 0.75;
let origin = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
let lines = [];
let lineColor = 'rgba(255,255,255,0.5)';

function initLines() {
	origin = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
	figureSize = Math.min(canvasWidth, canvasHeight) * 0.75;
	const baseVec = new Vector2D(0, -Math.floor(figureSize / 2));
	lines = [];
	for (let i = 0; i < numberOfDots; i++) {
		lines.push(new Line2D(origin, baseVec.RotateCCW(i * shift_angle)));
	}
}
initLines();

let t = helpers.range(0, 6.28, 0.02);
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
	bgCtx.lineWidth = 2;
	foregroundCanvas.width  = canvasWidth;
	foregroundCanvas.height = canvasHeight;
	foregroundCanvas.style.width  = canvasWidth + 'px';
	foregroundCanvas.style.height = canvasHeight + 'px';
	fgCtx.lineWidth = 2;
}
applyCanvasSize();
// #endregion

// #region static lines drawing
function drawStaticLines() {
	bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	bgCtx.save();
	bgCtx.strokeStyle = lineColor;
	bgCtx.setLineDash([1, 4]);
	bgCtx.beginPath();
	for (let k = 0; k < lines.length; k++) {
		let temp = new Line2D(lines[k].offset, lines[k].direction);
		temp.Draw(bgCtx);
		temp.direction = temp.direction.Negative();
		temp.Draw(bgCtx);
	}
	bgCtx.stroke();
	bgCtx.restore();
}
drawStaticLines();
// #endregion

// #region theme
function applyThemeColors(isLight) {
	backgroundCanvas.style.background = isLight ? '#f5ede0' : '#18140e';
	lineColor = isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.5)';
	drawStaticLines();
}
applyThemeColors(document.documentElement.classList.contains('light'));
document.addEventListener('themechange', function(e) {
	applyThemeColors(e.detail.isLight);
});
// #endregion

// #region resize
window.addEventListener('resize', function() {
	canvasWidth  = window.innerWidth;
	canvasHeight = window.innerHeight;
	applyCanvasSize();
	initLines();
	drawStaticLines();
});
// #endregion

let i = 0;
let hue = 0;
const delta_hue = Math.floor(360 / numberOfDots);

function draw() {
	fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	if (i >= t.length) {
		i = 0;
	}
	if (hue > 360) {
		hue = 0;
	}

	for (let j = 0; j < lines.length; j++) {
		const pointOrigin = lines[j].GetPointOnLine(Math.sin(t[i] + j * shift_angle));
		const strokeStyle = "hsl(" + hue + ", 100%,  70%)";
		fgCtx.beginPath();
		fgCtx.save();
		fgCtx.fillStyle = strokeStyle;
		fgCtx.strokeStyle = strokeStyle;
		helpers.drawFilledCircle(fgCtx, pointOrigin, 5, strokeStyle, strokeStyle);
		fgCtx.fill();
		fgCtx.stroke();
		fgCtx.restore();
	}

	i++;
	hue++;
	window.requestAnimationFrame(draw);
}

draw();
