import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";
import { Rectangle } from "../Utils/rectangle.js";
import { Quadtree } from "./Quadtree.js";

// #region global variables
var canvasHeight = window.innerHeight;
var canvasWidth = window.getCanvasWidth();
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var resetCanvas = false;
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
	bgCtx.lineWidth = 1;
	foregroundCanvas.width  = canvasWidth;
	foregroundCanvas.height = canvasHeight;
	foregroundCanvas.style.width  = canvasWidth + 'px';
	foregroundCanvas.style.height = canvasHeight + 'px';
	fgCtx.strokeStyle = whiteLineStrokeStyle;
	fgCtx.lineWidth = 1;
}
applyCanvasSize();
// #endregion

// #region theme
let drawColor = whiteLineStrokeStyle;

function applyThemeColors(isLight) {
	backgroundCanvas.style.background = isLight ? '#f5ede0' : '#18140e';
	drawColor = isLight ? 'rgba(20, 10, 0, 1.0)' : 'rgba(255, 255, 255, 1.0)';
	fgCtx.strokeStyle = drawColor;
	bgCtx.strokeStyle = drawColor;
}
applyThemeColors(document.documentElement.classList.contains('light'));
document.addEventListener('themechange', function(e) {
	applyThemeColors(e.detail.isLight);
});
// #endregion

// #region resize
window.addEventListener('resize', function() {
	canvasWidth  = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	applyCanvasSize();
	boundary = new Rectangle(0, 0, canvasWidth, canvasHeight);
	if (!window._hudToggling) {
		quadtree = new Quadtree(boundary, 4);
		for (let i = 0; i < 10; i++) {
			quadtree.insert(new helpers.Point2D(helpers.GetRandomInt(canvasWidth), helpers.GetRandomInt(canvasHeight)));
		}
	}
});
// #endregion

// #region reset button
var resetCanvasButton = document.getElementById("resetCanvasButton");
resetCanvasButton.onclick = function () {
	resetCanvas = true;
};
// #endregion

// #region mouse events
let pointerOnCanvas = false;
let isLeftMouseDown = false;
let isMiddleMouseDown = false;
let isRightMouseDown = false;
let mouse = new Vector2D(0, 0);

function SetPointerOnCanvas(myBool) {
	if (pointerOnCanvas === !myBool) {
		pointerOnCanvas = myBool;
	}
}

foregroundCanvas.addEventListener("touchstart", function (event) {
	SetPointerOnCanvas(true);
	event.preventDefault();
});

foregroundCanvas.addEventListener("touchend", function (event) {
	SetPointerOnCanvas(false);
	event.preventDefault();
});

foregroundCanvas.addEventListener("touchmove", function (event) {
	let touchobj = event.changedTouches[0];
	mouse.x = touchobj.clientX;
	mouse.y = touchobj.clientY;
	event.preventDefault();
});

foregroundCanvas.addEventListener("mouseenter", function (event) {
	SetPointerOnCanvas(true);
});

foregroundCanvas.addEventListener("mouseleave", function (event) {
	SetPointerOnCanvas(false);
});

foregroundCanvas.addEventListener("mousedown", function (event) {
	switch (event.button) {
		case 0: { isLeftMouseDown = true; break; }
		case 1: { isMiddleMouseDown = true; break; }
		case 2: { isRightMouseDown = true; break; }
	}
});

foregroundCanvas.addEventListener("mouseup", function (event) {
	switch (event.button) {
		case 0: { isLeftMouseDown = false; break; }
		case 1: { isMiddleMouseDown = false; break; }
		case 2: { isRightMouseDown = false; break; }
	}
});

foregroundCanvas.addEventListener("mousemove", function (event) {
	mouse = helpers.GetMousePos(foregroundCanvas, event);
});
// #endregion

let boundary = new Rectangle(0, 0, canvasWidth, canvasHeight);
let quadtree = new Quadtree(boundary, 4);
let area = new Rectangle(75, 190, 350, 200);

for (let i = 0; i < 10; i++) {
	let p = new helpers.Point2D(helpers.GetRandomInt(canvasWidth), helpers.GetRandomInt(canvasHeight));
	quadtree.insert(p);
}

function draw() {
	fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	if (resetCanvas) {
		quadtree = new Quadtree(boundary, 4);
		resetCanvas = false;
	}

	if (isLeftMouseDown) {
		quadtree.insert(new helpers.Point2D(mouse.x, mouse.y));
	}

	if (isMiddleMouseDown) {
		area.x = mouse.x - area.w / 2;
		area.y = mouse.y - area.h / 2;
	}

	let querried = quadtree.queryArea(area);
	quadtree.draw(fgCtx, drawColor);

	fgCtx.beginPath();
	helpers.drawRectangle(fgCtx, area, "rgba(0,255,0,1.0)");
	fgCtx.stroke();

	querried.forEach((p) => {
		fgCtx.beginPath();
		helpers.drawFilledCircle(fgCtx, p, 2, "rgba(0,255,0,1.0)", "rgba(0,255,0,1.0)");
		fgCtx.stroke();
	});

	if (document.hidden) return;
	window.requestAnimationFrame(draw);
}

draw();
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
