import * as helpers from "../Utils/helpers.js";
import Polygon from "../Utils/polygon.js";
import Vector2D from "../Utils/Vector2D.js";
import FadeTrail from "../Utils/FadeTrail.js";

// #region global variables
const HUD_PANEL_WIDTH = 280;
var canvasHeight = window.innerHeight;
var canvasWidth = window.innerWidth - HUD_PANEL_WIDTH;
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

const trail = new FadeTrail(400);

function ClearAndAddPolygonsToArray() {
	polygons = [];
	// Keep circumradius constant across all N: edgeLength = R * 2*sin(π/N),
	// where R is fixed to the N=4 base (enclosingSize / (2*sin(π/4))).
	const scaledEdgeLength = enclosingSize * Math.sin(Math.PI / sidesCount) / Math.sin(Math.PI / 4);
	for (let i = 0; i < polygonCount; i++) {
		polygons.push(new Polygon(squareOrigin, scaledEdgeLength, 0, sidesCount));
	}
	trail.reset();
	iFloat = 0;
}

ClearAndAddPolygonsToArray();

// #region canvas setup
var backgroundCanvas = document.getElementById("backgroundCanvas");
var bgCtx = backgroundCanvas.getContext("2d");

function applyCanvasSize() {
	backgroundCanvas.width  = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width  = canvasWidth + 'px';
	backgroundCanvas.style.height = canvasHeight + 'px';
	bgCtx.strokeStyle = strokeColor;
	bgCtx.lineWidth = 2;
}
applyCanvasSize();
// #endregion

// #region theme
function applyThemeColors(isLight) {
	backgroundCanvas.style.background = isLight ? '#f5ede0' : '#18140e';
	strokeColor = isLight ? 'rgba(20, 10, 0, 1.0)' : 'rgba(255, 255, 255, 1.0)';
	bgCtx.strokeStyle = strokeColor;
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
	trail.reset();
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
	trail.reset();
};

var fadeSpeedSlider = document.getElementById("fadeSpeedSlider");
fadeSpeedSlider.value = fadeSpeed;
var fadeSpeedValue = document.getElementById("fadeSpeedValue");
fadeSpeedValue.innerHTML = Math.floor(fadeSpeed * 100);

fadeSpeedSlider.oninput = function() {
	fadeSpeed = parseFloat(this.value);
	fadeSpeedValue.innerHTML = Math.floor(fadeSpeed * 100);
	trail.reset();
};

var resetCanvasButton = document.getElementById("resetCanvasButton");
resetCanvasButton.onclick = function() { resetCanvas = true; };

document.getElementById("exportButton").onclick = exportPNG;
// #endregion

// #region mouse
window.addEventListener('mousemove', function(e) {
	mousePos = helpers.GetMousePos(backgroundCanvas, e);
});
// #endregion

function exportPNG() {
	const link = document.createElement('a');
	link.download = 'rotating-polygons.png';
	link.href = backgroundCanvas.toDataURL('image/png');
	link.click();
}

window.addEventListener('keydown', function(e) {
	if (e.key === 's' || e.key === 'S') exportPNG();
	if (e.key === 'r' || e.key === 'R') resetCanvas = true;
});

function drawPolygonsAtAngle(angle, opacity) {
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

function draw() {
	if (resetCanvas) {
		iFloat = 0;
		resetCanvas = false;
		trail.reset();
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
		trail.push(currentAngle);
		trail.render(fadeSpeed, (angle, opacity) => {
			drawPolygonsAtAngle(angle, opacity);
		});
	} else {
		drawPolygonsAtAngle(currentAngle, 1.0);
	}

	if (document.hidden) return;
	window.requestAnimationFrame(draw);
}

draw();
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
