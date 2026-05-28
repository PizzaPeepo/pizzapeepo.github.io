import * as helpers from "../Utils/helpers.js";
import Square from "../Utils/square.js";
import Vector2D from "../Utils/Vector2D.js";

// #region global variables
const HUD_PANEL_WIDTH = 280;
var canvasHeight = window.innerHeight;
var canvasWidth = window.innerWidth - HUD_PANEL_WIDTH;
var resetCanvas = false;
var rainbowColorsEnabled = true;
var hue = 0;
var squareOrigin = new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2));
var enclosingSquareLength = Math.min(canvasWidth, canvasHeight) * 0.5;
var delta_angle = 0.005;
var angles = helpers.range(0, Math.PI / 2, delta_angle);
var squareCount = 10;
let strokeColor = 'rgba(255, 255, 255, 1.0)';
let squares = [];
// #endregion

ClearAndAddSquaresToArray();

function ClearAndAddSquaresToArray() {
	while (squares.length > 0) {
		squares.pop();
	}
	for (let i = 0; i < squareCount; i++) {
		squares.push(new Square(squareOrigin, enclosingSquareLength, 0));
	}
}

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
	enclosingSquareLength = Math.min(canvasWidth, canvasHeight) * 0.5;
	ClearAndAddSquaresToArray();
	resetCanvas = true;
});
// #endregion

// #region Inputs
var rotationSpeedSlider = document.getElementById("rotationSpeedSlider");
rotationSpeedSlider.value = delta_angle;
var rotationSpeedValue = document.getElementById("rotationSpeedValue");
rotationSpeedValue.innerHTML = Math.floor(rotationSpeedSlider.value * 10000);

rotationSpeedSlider.oninput = function() {
	rotationSpeedValue.innerHTML = Math.floor(this.value * 10000);
	delta_angle = this.value;
	angles = helpers.range(0, Math.PI / 2, delta_angle);
};

var squareCountSlider = document.getElementById("squareCountSlider");
squareCountSlider.value = squareCount;
var squareCountValue = document.getElementById("squareCountValue");
squareCountValue.innerHTML = squareCountSlider.value;

squareCountSlider.oninput = function() {
	squareCountValue.innerHTML = this.value;
	squareCount = this.value;
	ClearAndAddSquaresToArray();
};

var baseColorSlider = document.getElementById("baseColorSlider");
baseColorSlider.value = hue;
var baseColorValue = document.getElementById("baseColorValue");
baseColorValue.innerHTML = baseColorSlider.value;

baseColorSlider.oninput = function() {
	baseColorValue.innerHTML = this.value;
	hue = this.value;
	const rainbowColorStyle = "hsl(" + helpers.RadianToDegree(helpers.DegreeToRadian(hue)) + ", 100%,  70%)";
	bgCtx.strokeStyle = rainbowColorStyle;
};

var rainbowColorCheckbox = document.getElementById("rainbowColorCheckbox");
rainbowColorCheckbox.checked = rainbowColorsEnabled;
rainbowColorCheckbox.onclick = function() { rainbowColorsEnabled = this.checked; };

var resetCanvasButton = document.getElementById("resetCanvasButton");
resetCanvasButton.onclick = function() { resetCanvas = true; };
// #endregion

let i = 0;

function draw() {
	bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	if (i > angles.length || resetCanvas) {
		i = 0;
		resetCanvas = false;
	}

	for (let j = 1; j < squares.length; j++) {
		bgCtx.beginPath();
		squares[j].RotateInsideSquare(squares[j - 1], squares[j - 1].alpha + angles[i]);
		bgCtx.save();
		if (rainbowColorsEnabled) {
			const rainbowColorStyle =
				"hsl(" + helpers.RadianToDegree(squares[j].alpha / 2 + helpers.DegreeToRadian(hue)) + ", 100%,  70%)";
			bgCtx.strokeStyle = rainbowColorStyle;
		}

		squares[j].Draw(bgCtx);
		bgCtx.stroke();
		bgCtx.restore();
	}

	bgCtx.beginPath();
	bgCtx.save();
	if (rainbowColorsEnabled) {
		const rainbowColorStyle =
			"hsl(" + helpers.RadianToDegree(squares[1].alpha / 2 + helpers.DegreeToRadian(hue)) + ", 100%,  70%)";
		bgCtx.strokeStyle = rainbowColorStyle;
	}
	squares[0].Draw(bgCtx);
	bgCtx.stroke();
	bgCtx.restore();

	i++;
	window.requestAnimationFrame(draw);
}

draw();
