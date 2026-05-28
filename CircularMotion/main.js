import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";
import Circle from "./circle.js";

// #region global variables
const HUD_PANEL_WIDTH = 280;
var canvasHeight = window.innerHeight;
var canvasWidth = window.innerWidth - HUD_PANEL_WIDTH;
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var fadeAway = false;
var liveResetCanvas = false;
var showWhiteLines = true;
var showBlackBorderAroundPoints = false;
var fadeAwaySpeed = 0.1;
var resetCanvas = false;
var pointCount = 49;
var velocity = 0.0015;
var deltaCircleRadius = Math.floor(canvasHeight / 2.1 / pointCount);
var pointRadius = 5;
let origin = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
let fadeColor = 'rgba(24,18,14,';

let circles = [];
FillArrayOfCircles();

let t = helpers.range(0, 2 * Math.PI, velocity);
// #endregion

// #region functions
function FillArrayOfCircles() {
	while (circles.length > 0) {
		circles.pop();
	}
	for (let i = 0; i < pointCount; i++) {
		circles.push(new Circle(origin, 20 + i * deltaCircleRadius));
	}
}
// #endregion

// #region canvas setup
var blackbackgroundCanvas = document.getElementById("blackbackgroundCanvas");
var backgroundCanvas = document.getElementById("backgroundCanvas");
var bgCtx = backgroundCanvas.getContext("2d");
var middlegroundCanvas = document.getElementById("middlegroundCanvas");
var mgCtx = middlegroundCanvas.getContext("2d");
var foregroundCanvas = document.getElementById("foregroundCanvas");
var fgCtx = foregroundCanvas.getContext("2d");

function applyCanvasSize() {
	[blackbackgroundCanvas, backgroundCanvas, middlegroundCanvas, foregroundCanvas].forEach(function(c) {
		c.width = canvasWidth;
		c.height = canvasHeight;
		c.style.width = canvasWidth + 'px';
		c.style.height = canvasHeight + 'px';
	});
	bgCtx.strokeStyle = whiteLineStrokeStyle;
	bgCtx.lineWidth = 2;
	mgCtx.strokeStyle = whiteLineStrokeStyle;
	mgCtx.lineWidth = 2;
	fgCtx.strokeStyle = whiteLineStrokeStyle;
	fgCtx.lineWidth = 2;
}
applyCanvasSize();
// #endregion

// #region theme
function applyThemeColors(isLight) {
	blackbackgroundCanvas.style.background = isLight ? '#f5ede0' : '#18140e';
	fadeColor = isLight ? 'rgba(245,237,224,' : 'rgba(24,18,14,';
}
applyThemeColors(document.documentElement.classList.contains('light'));
document.addEventListener('themechange', function(e) {
	applyThemeColors(e.detail.isLight);
});
// #endregion

// #region resize
window.addEventListener('resize', function() {
	canvasWidth = window.innerWidth - HUD_PANEL_WIDTH;
	canvasHeight = window.innerHeight;
	applyCanvasSize();
	origin = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
	deltaCircleRadius = Math.floor(canvasHeight / 2.1 / pointCount);
	FillArrayOfCircles();
	resetCanvas = true;
});
// #endregion

// #region Inputs
var pointCountSlider = document.getElementById("pointCountSlider");
pointCountSlider.value = pointCount;
var pointCountValue = document.getElementById("pointCountValue");
pointCountValue.innerHTML = pointCountSlider.value;

pointCountSlider.oninput = function() {
	pointCountValue.innerHTML = this.value;
	pointCount = this.value;
	deltaCircleRadius = Math.floor(canvasHeight / 2.1 / pointCount);
	FillArrayOfCircles();
	if (liveResetCanvas) {
		resetCanvas = true;
	}
};

var drawingSpeedSlider = document.getElementById("drawingSpeedSlider");
drawingSpeedSlider.value = velocity;
var drawingSpeedValue = document.getElementById("drawingSpeedValue");
drawingSpeedValue.innerHTML = Math.floor(drawingSpeedSlider.value * 10000);

drawingSpeedSlider.oninput = function() {
	drawingSpeedValue.innerHTML = Math.floor(this.value * 10000);
	velocity = this.value;
	t = helpers.range(0, 6.28, velocity);
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
};

var fadeAwayCheckbox = document.getElementById("fadeAwayCheckbox");
fadeAwayCheckbox.checked = fadeAway;
fadeAwayCheckbox.onclick = function() { fadeAway = this.checked; };

var liveResetCheckbox = document.getElementById("liveResetCheckbox");
liveResetCheckbox.checked = liveResetCanvas;
liveResetCheckbox.onclick = function() { liveResetCanvas = this.checked; };

var showWhiteLinesCheckbox = document.getElementById("showWhiteLinesCheckbox");
showWhiteLinesCheckbox.checked = showWhiteLines;
showWhiteLinesCheckbox.onclick = function() { showWhiteLines = this.checked; };

var showBlackBorderAroundPointsCheckbox = document.getElementById("showBlackBorderAroundPointsCheckbox");
showBlackBorderAroundPointsCheckbox.checked = showBlackBorderAroundPoints;
showBlackBorderAroundPointsCheckbox.onclick = function() { showBlackBorderAroundPoints = this.checked; };

var resetCanvasButton = document.getElementById("resetCanvasButton");
resetCanvasButton.onclick = function() { resetCanvas = true; };
// #endregion

let i = 0;

function draw() {
	bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	if (fadeAway) {
		mgCtx.save();
		mgCtx.fillStyle = fadeColor + fadeAwaySpeed + ")";
		mgCtx.fillRect(0, 0, canvasWidth, canvasHeight);
		mgCtx.restore();
	} else {
		mgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	}

	if (i >= t.length || resetCanvas == true) {
		i = 0;
		resetCanvas = false;
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		mgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	}

	bgCtx.beginPath();

	for (let j = 0; j < circles.length; j++) {
		const rainbowColorStyle = "hsl(" + helpers.RadianToDegree((circles.length - j) * t[i]) + ", 100%,  70%)";
		mgCtx.beginPath();
		mgCtx.save();
		const angle = (circles.length - j) * t[i];
		circles[j].DrawPointOnCircle(mgCtx, angle, pointRadius, rainbowColorStyle, rainbowColorStyle);
		mgCtx.fill();
		mgCtx.stroke();
		mgCtx.restore();

		fgCtx.beginPath();
		fgCtx.save();
		let borderStrokeStyle = rainbowColorStyle;
		if (showBlackBorderAroundPoints) {
			borderStrokeStyle = "rgba(0, 0, 0, 1.0)";
		}
		circles[j].DrawPointOnCircle(fgCtx, angle, pointRadius, borderStrokeStyle, rainbowColorStyle);
		fgCtx.fill();
		fgCtx.stroke();
		fgCtx.restore();

		if (showWhiteLines && j < circles.length) {
			const tempPoint1 = circles[j].GetPointOnCircle(angle);
			bgCtx.lineTo(tempPoint1.x, tempPoint1.y);
		}
	}

	bgCtx.stroke();
	bgCtx.restore();

	i++;
	window.requestAnimationFrame(draw);
}

draw();
