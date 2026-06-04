import Vector2D from "../Utils/Vector2D.js";
import Line2D from "./Line2D.js";
import Raycaster from "./Raycaster.js";
import "../Utils/simplexNoise.js";
import * as helpers from "../Utils/helpers.js";

// #region global variables
const HUD_PANEL_WIDTH = 280;
var canvas_width = window.innerWidth - HUD_PANEL_WIDTH;
var canvas_height = window.innerHeight;

var numberOfRandomWalls = 6;
var raycount = 80;
var walls = [];
let canvasWalls = Line2D.GetWallLines2D(canvas_width, canvas_height);
var initialRaycasterPosition = new Vector2D(Math.floor(canvas_width / 2), Math.floor(canvas_height / 2));
var rayCaster = new Raycaster(initialRaycasterPosition, raycount);

var simplex = new SimplexNoise(Date.now());
var simplexOffsetX = 0;
var simplexOffsetY = 500;
var pointerOnCanvas = false;
window.setInterval(GetNewRandomLines, 5000);
GetAndSetRandomLinesAndWalls();
// #endregion

// #region canvas setup
var canvas = document.getElementById("myCanvas");

function applyCanvasSize() {
	canvas.width = canvas_width;
	canvas.height = canvas_height;
	canvas.style.width = canvas_width + 'px';
	canvas.style.height = canvas_height + 'px';
}
applyCanvasSize();

var ctx = canvas.getContext("2d");
// #endregion

// #region theme
let wallColor = 'rgba(255, 255, 255, 1.0)';
let rayColor  = 'rgba(255, 255, 255, 0.6)';

function applyThemeColors(isLight) {
	canvas.style.background = isLight ? '#f5ede0' : '#18140e';
	wallColor = isLight ? 'rgba(20, 10, 0, 1.0)'  : 'rgba(255, 255, 255, 1.0)';
	rayColor  = isLight ? 'rgba(20, 10, 0, 0.5)'  : 'rgba(255, 255, 255, 0.6)';
}
applyThemeColors(document.documentElement.classList.contains('light'));
document.addEventListener('themechange', function(e) {
	applyThemeColors(e.detail.isLight);
});
// #endregion

// #region resize
window.addEventListener('resize', function() {
	canvas_width  = window.innerWidth - HUD_PANEL_WIDTH;
	canvas_height = window.innerHeight;
	applyCanvasSize();
	canvasWalls = Line2D.GetWallLines2D(canvas_width, canvas_height);
	rayCaster.position.x = Math.floor(canvas_width / 2);
	rayCaster.position.y = Math.floor(canvas_height / 2);
	GetNewRandomLines();
});
// #endregion

// #region walls
function GetAndSetRandomLinesAndWalls() {
	walls = Line2D.GetRandomLines2D(numberOfRandomWalls, 100, canvas_width - 100, 100, canvas_height - 100);
	for (let wall of canvasWalls) {
		walls.push(wall);
	}
}

function ClearRandomLinesAndWalls() {
	while (walls.length > 0) {
		walls.pop();
	}
}

function GetNewRandomLines() {
	ClearRandomLinesAndWalls();
	GetAndSetRandomLinesAndWalls();
}
// #endregion

// #region Sliders
var wallCountSlider = document.getElementById("wallCountSlider");
wallCountSlider.value = numberOfRandomWalls;
var wallCountValue = document.getElementById("wallCountValue");
wallCountValue.innerHTML = wallCountSlider.value;

wallCountSlider.oninput = function () {
	wallCountValue.innerHTML = this.value;
	numberOfRandomWalls = this.value;
	GetNewRandomLines();
};

var rayCountSlider = document.getElementById("rayCountSlider");
rayCountSlider.value = raycount;
var rayCountVal = document.getElementById("rayCountValue");
rayCountVal.innerHTML = rayCountSlider.value;

rayCountSlider.oninput = function () {
	rayCountVal.innerHTML = this.value;
	rayCaster.rayCount = this.value;
};
// #endregion

// #region Draw functions
function drawPoints(points) {
	if (typeof points === "undefined") {
		return;
	}
	ctx.beginPath();
	for (let i = 0; i < points.length; i++) {
		drawPoint(points[i]);
	}
}

function drawPoint(point) {
	if (typeof point === "undefined" || point === null) {
		return;
	}
	ctx.save();
	ctx.fillStyle = "#FFFF00";
	ctx.fillRect(point.x, point.y, 1, 1);
	ctx.restore();
}

function drawCircle(origin, radius, rgba) {
	ctx.save();
	ctx.beginPath();
	ctx.fillStyle = rgba;
	ctx.arc(origin.x, origin.y, radius, 0, 2 * Math.PI);
	ctx.fill();
	ctx.stroke();
	ctx.restore();
}

function drawLines(lines) {
	ctx.save();
	ctx.strokeStyle = wallColor;
	ctx.lineWidth = 2;
	ctx.beginPath();
	for (let i = 0; i < lines.length; i++) {
		lines[i].Draw(ctx);
	}
	ctx.stroke();
	ctx.restore();
}

function drawRays(Raycaster) {
	ctx.save();
	ctx.strokeStyle = rayColor;
	ctx.lineWidth = 1;
	ctx.beginPath();
	Raycaster.Draw(ctx);
	ctx.stroke();
	ctx.restore();
}
// #endregion

// #region mouse events
function SetPointerOnCanvas(myBool) {
	if (pointerOnCanvas === !myBool) {
		pointerOnCanvas = myBool;
	}
}

canvas.addEventListener("touchstart", function (event) {
	SetPointerOnCanvas(true);
	event.preventDefault();
});

canvas.addEventListener("touchend", function (event) {
	SetPointerOnCanvas(false);
	event.preventDefault();
});

canvas.addEventListener("touchmove", function (event) {
	let touchobj = event.changedTouches[0];
	rayCaster.position.x = touchobj.clientX;
	rayCaster.position.y = touchobj.clientY;
	event.preventDefault();
});

canvas.addEventListener("mouseenter", function (event) {
	SetPointerOnCanvas(true);
});

canvas.addEventListener("mouseleave", function (event) {
	SetPointerOnCanvas(false);
});

canvas.addEventListener("mousemove", function (event) {
	let mouse = helpers.GetMousePos(canvas, event);
	rayCaster.position.x = mouse.x;
	rayCaster.position.y = mouse.y;
});
// #endregion

// #region animation
function draw() {
	if (pointerOnCanvas === false) {
		rayCaster.position.x = Math.floor(canvas_width / 2);
		rayCaster.position.y = Math.floor(canvas_height / 2);

		let tempx = rayCaster.position.x + simplex.noise2D(simplexOffsetX, simplexOffsetY) * 200;
		let tempy = rayCaster.position.y + simplex.noise2D(simplexOffsetY, simplexOffsetX) * 200;
		simplexOffsetX += 0.0005;
		simplexOffsetY += 0.0005;

		if (tempx < 0 || tempx > canvas_width || tempy < 0 || tempy > canvas_height) {
			rayCaster.position.x = Math.floor(canvas_width / 2);
			rayCaster.position.y = Math.floor(canvas_height / 2);
		} else {
			rayCaster.position.x = tempx;
			rayCaster.position.y = tempy;
		}
	}
	ctx.clearRect(0, 0, canvas_width, canvas_height);
	drawLines(walls);
	drawCircle(rayCaster.position, 2, wallColor);

	rayCaster.UpdateRays();
	const intersectionPoints = rayCaster.FindAllClosestIntersectionPoints(walls);
	rayCaster.CutRaysAtClosestIntersectionPoint(intersectionPoints);
	drawRays(rayCaster);
	drawPoints(intersectionPoints);

	if (document.hidden) return;
	window.requestAnimationFrame(draw);
}
// #endregion

window.requestAnimationFrame(draw);
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
