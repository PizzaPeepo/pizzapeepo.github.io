import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";
import Circle from "./circle.js";
import FadeTrail from "../Utils/FadeTrail.js";

// #region global variables
var canvasHeight = window.innerHeight;
var canvasWidth = window.getCanvasWidth();
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var fadeAway = false;
var liveResetCanvas = false;
var showWhiteLines = true;
var showBlackBorderAroundPoints = false;
var fadeAwaySpeed = 0.1;
var resetCanvas = false;
var pointCount = 49;
var velocity = 0.0015;
var multiplier = 1.0;
var starStep = 1;
var colorMode = 'angle'; // 'angle' | 'radius'
var deltaCircleRadius = Math.floor(canvasHeight / 2.1 / pointCount);
var pointRadius = 5;
let origin = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));

let circles = [];
FillArrayOfCircles();

let t = helpers.range(0, 2 * Math.PI, velocity);

const trail = new FadeTrail(500);
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

function getColor(j, angle) {
	if (colorMode === 'radius') {
		return "hsl(" + Math.floor(j / circles.length * 360) + ", 100%, 70%)";
	}
	return "hsl(" + helpers.RadianToDegree(angle) + ", 100%, 70%)";
}

function drawTrailFrame(ctx, tVal, opacity) {
	ctx.save();
	ctx.globalAlpha = opacity;
	for (let j = 0; j < circles.length; j++) {
		const angle = multiplier * (circles.length - j) * tVal;
		const colorStyle = getColor(j, angle);
		ctx.beginPath();
		ctx.save();
		circles[j].DrawPointOnCircle(ctx, angle, pointRadius, colorStyle, colorStyle);
		ctx.fill();
		ctx.stroke();
		ctx.restore();
	}
	ctx.restore();
}
// #endregion

// #region canvas setup
var backgroundCanvas = document.getElementById("backgroundCanvas");
var bgCtx = backgroundCanvas.getContext("2d");
var middlegroundCanvas = document.getElementById("middlegroundCanvas");
var mgCtx = middlegroundCanvas.getContext("2d");
var foregroundCanvas = document.getElementById("foregroundCanvas");
var fgCtx = foregroundCanvas.getContext("2d");

function applyCanvasSize() {
	[backgroundCanvas, middlegroundCanvas, foregroundCanvas].forEach(function(c) {
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
	document.body.style.background = isLight ? '#f5ede0' : '#18140e';
}
applyThemeColors(document.documentElement.classList.contains('light'));
document.addEventListener('themechange', function(e) {
	applyThemeColors(e.detail.isLight);
});
// #endregion

// #region resize
window.addEventListener('resize', function() {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	origin = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
	deltaCircleRadius = Math.floor(canvasHeight / 2.1 / pointCount);
	FillArrayOfCircles();
	resetCanvas = true;
});
// #endregion

// #region drag origin
let isDragging = false;
foregroundCanvas.addEventListener('pointerdown', function(e) {
	isDragging = true;
	const pos = helpers.GetMousePos(foregroundCanvas, e);
	origin = new Vector2D(pos.x, pos.y);
	for (const circle of circles) { circle.origin = origin; }
	trail.reset();
});
foregroundCanvas.addEventListener('pointermove', function(e) {
	if (!isDragging) return;
	const pos = helpers.GetMousePos(foregroundCanvas, e);
	origin = new Vector2D(pos.x, pos.y);
	for (const circle of circles) { circle.origin = origin; }
	trail.reset();
});
foregroundCanvas.addEventListener('pointerup', function() { isDragging = false; });
foregroundCanvas.addEventListener('pointerleave', function() { isDragging = false; });
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
	trail.reset();
};

var multiplierSlider = document.getElementById("multiplierSlider");
multiplierSlider.value = multiplier;
var multiplierValue = document.getElementById("multiplierValue");
multiplierValue.innerHTML = multiplier.toFixed(2);

multiplierSlider.oninput = function() {
	multiplier = parseFloat(this.value);
	multiplierValue.innerHTML = multiplier.toFixed(2);
	if (liveResetCanvas) {
		resetCanvas = true;
	}
};

var starStepSlider = document.getElementById("starStepSlider");
starStepSlider.value = starStep;
var starStepValue = document.getElementById("starStepValue");
starStepValue.innerHTML = starStep;

starStepSlider.oninput = function() {
	starStep = parseInt(this.value);
	starStepValue.innerHTML = starStep;
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

document.querySelectorAll('input[name="colorMode"]').forEach(function(radio) {
	radio.addEventListener('change', function() { colorMode = this.value; });
});
// #endregion

let i = 0;

function draw() {
	bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	if (i >= t.length || resetCanvas == true) {
		i = 0;
		trail.reset();
		resetCanvas = false;
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		mgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	}

	if (fadeAway) {
		mgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		trail.push(t[i]);
		trail.render(fadeAwaySpeed, (tVal, opacity) => drawTrailFrame(mgCtx, tVal, opacity));
	} else {
		mgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		drawTrailFrame(mgCtx, t[i], 1.0);
	}

	for (let j = 0; j < circles.length; j++) {
		const angle = multiplier * (circles.length - j) * t[i];
		const colorStyle = getColor(j, angle);

		fgCtx.beginPath();
		fgCtx.save();
		let borderStrokeStyle = colorStyle;
		if (showBlackBorderAroundPoints) {
			borderStrokeStyle = "rgba(0, 0, 0, 1.0)";
		}
		circles[j].DrawPointOnCircle(fgCtx, angle, pointRadius, borderStrokeStyle, colorStyle);
		fgCtx.fill();
		fgCtx.stroke();
		fgCtx.restore();
	}

	if (showWhiteLines) {
		if (starStep === 1) {
			bgCtx.beginPath();
			for (let j = 0; j < circles.length; j++) {
				const angle = multiplier * (circles.length - j) * t[i];
				const p = circles[j].GetPointOnCircle(angle);
				bgCtx.lineTo(p.x, p.y);
			}
			bgCtx.stroke();
		} else {
			for (let j = 0; j < circles.length; j++) {
				const jNext = (j + starStep) % circles.length;
				const angle1 = multiplier * (circles.length - j) * t[i];
				const angle2 = multiplier * (circles.length - jNext) * t[i];
				const p1 = circles[j].GetPointOnCircle(angle1);
				const p2 = circles[jNext].GetPointOnCircle(angle2);
				bgCtx.beginPath();
				bgCtx.moveTo(p1.x, p1.y);
				bgCtx.lineTo(p2.x, p2.y);
				bgCtx.stroke();
			}
		}
	}

	i++;
	if (document.hidden) return;
	window.requestAnimationFrame(draw);
}

draw();
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
