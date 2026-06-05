// Boilerplate for a legacy dual-canvas demo. Copy this folder, rename it, and fill in the TODOs.
// See CLAUDE.md ("Canvas Patterns") for the dual-canvas vs modern single-canvas + HUD split.
//
// Common utilities you will likely want — uncomment as needed:
// import * as helpers from "../Utils/helpers.js";
// import Vector2D from "../Utils/Vector2D.js";

// #region global variables
var canvasWidth = 800;
var canvasHeight = 800;
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var resetCanvas = false;
// TODO: add your own demo state here
// #endregion

// #region canvas setup
var backgroundCanvas = document.getElementById("backgroundCanvas"); // persistent / slow-update layer
var bgCtx = backgroundCanvas.getContext("2d");
backgroundCanvas.width = canvasWidth;
backgroundCanvas.height = canvasHeight;
bgCtx.strokeStyle = whiteLineStrokeStyle;
bgCtx.lineWidth = 2;

var foregroundCanvas = document.getElementById("foregroundCanvas"); // per-frame interactive layer
var fgCtx = foregroundCanvas.getContext("2d");
foregroundCanvas.width = canvasWidth;
foregroundCanvas.height = canvasHeight;
fgCtx.strokeStyle = whiteLineStrokeStyle;
fgCtx.lineWidth = 2;
// #endregion

// #region inputs (optional — add the matching elements to the HTML, then the guards become true)
// TODO: replace "mySlider" / "mySliderValue" with your slider and its value-label element ids.
var mySlider = document.getElementById("mySlider");
var mySliderValue = document.getElementById("mySliderValue");
if (mySlider && mySliderValue) {
	mySliderValue.textContent = mySlider.value;
	mySlider.addEventListener("input", function () {
		mySliderValue.textContent = this.value;
		// TODO: react to the new slider value
	});
}

// TODO: replace "resetCanvasButton" with your reset button element id.
var resetCanvasButton = document.getElementById("resetCanvasButton");
if (resetCanvasButton) {
	resetCanvasButton.addEventListener("click", function () {
		resetCanvas = true;
	});
}
// #endregion

function draw() {
	fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	if (resetCanvas) {
		bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		resetCanvas = false;
	}

	// TODO: draw your frame here

	if (document.hidden) return;
	window.requestAnimationFrame(draw);
}

draw();
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
