import Vector2D from "../Utils/Vector2D.js";
import Line2D from "./Line2D.js";
import { GetRandomLines2D, GetWallLines2D } from "./LineFactory.js";
import Raycaster from "./Raycaster.js";
import "../Utils/simplexNoise.js";
import * as helpers from "../Utils/helpers.js";
import { onThemeChange } from "../Utils/ThemeManager.js";
import { onWindowResize } from "../Utils/ResizeManager.js";

// #region global variables
var canvas_width = window.getCanvasWidth();
var canvas_height = window.innerHeight;

var numberOfRandomWalls = 6;
// per-frame advance through simplex noise for the idle auto-wander of the ray source
const NOISE_TIME_STEP = 0.0005;
var raycount = 200;
var randomWalls = [];
var userWalls = [];
var walls = [];
let canvasWalls = GetWallLines2D(canvas_width, canvas_height);
var initialRaycasterPosition = new Vector2D(Math.floor(canvas_width / 2), Math.floor(canvas_height / 2));
var rayCaster = new Raycaster(initialRaycasterPosition, raycount);

var simplex = new SimplexNoise(Date.now());
var simplexOffsetX = 0;
var simplexOffsetY = 500;
var pointerOnCanvas = false;
var isLight = document.documentElement.classList.contains('light');

var autoRegen = false;
var regenIntervalMs = 5000;
var regenTimerId = null;

var drawMode = true;
var isDrawing = false;
var drawStart = null;
var drawCurrent = null;
var hoveredWall = null;

function rebuildWalls() {
	walls = [...randomWalls, ...canvasWalls, ...userWalls];
}

function GetAndSetRandomLinesAndWalls() {
	randomWalls = GetRandomLines2D(numberOfRandomWalls, 100, canvas_width - 100, 100, canvas_height - 100);
	rebuildWalls();
}

function GetNewRandomLines() {
	GetAndSetRandomLinesAndWalls();
}

function startRegenTimer() {
	stopRegenTimer();
	if (autoRegen) {
		regenTimerId = window.setInterval(GetNewRandomLines, regenIntervalMs);
	}
}

function stopRegenTimer() {
	if (regenTimerId !== null) {
		window.clearInterval(regenTimerId);
		regenTimerId = null;
	}
}

GetAndSetRandomLinesAndWalls();
startRegenTimer();
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
canvas.style.cursor = "crosshair";

var ctx = canvas.getContext("2d");
// #endregion

// #region theme
let wallColor = 'rgba(255, 255, 255, 1.0)';
let rayColor  = 'rgba(255, 255, 255, 0.6)';

function applyThemeColors(light) {
	isLight = light;
	canvas.style.background = light ? '#f5ede0' : '#18140e';
	wallColor = light ? 'rgba(20, 10, 0, 1.0)'  : 'rgba(255, 255, 255, 1.0)';
	rayColor  = light ? 'rgba(20, 10, 0, 0.5)'  : 'rgba(255, 255, 255, 0.6)';
}
onThemeChange(applyThemeColors);
// #endregion

// #region resize
onWindowResize(function() {
	canvas_width  = window.getCanvasWidth();
	canvas_height = window.innerHeight;
	applyCanvasSize();
	canvasWalls = GetWallLines2D(canvas_width, canvas_height);
	rayCaster.position.x = Math.floor(canvas_width / 2);
	rayCaster.position.y = Math.floor(canvas_height / 2);
	if (!window._hudToggling) GetNewRandomLines();
});
// #endregion

// #region wall helpers
function distToSegment(px, py, wall) {
	const ax = wall.offset.x, ay = wall.offset.y;
	const bx = ax + wall.direction.x, by = ay + wall.direction.y;
	const dx = bx - ax, dy = by - ay;
	const lenSq = dx * dx + dy * dy;
	if (lenSq === 0) return Math.hypot(px - ax, py - ay);
	const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const REMOVE_THRESHOLD = 15;

function findClosestEditableWall(mx, my) {
	let closestDist = Infinity;
	let closestSrc = null;
	let closestIdx = -1;

	for (let i = 0; i < randomWalls.length; i++) {
		const d = distToSegment(mx, my, randomWalls[i]);
		if (d < closestDist) { closestDist = d; closestSrc = randomWalls; closestIdx = i; }
	}
	for (let i = 0; i < userWalls.length; i++) {
		const d = distToSegment(mx, my, userWalls[i]);
		if (d < closestDist) { closestDist = d; closestSrc = userWalls; closestIdx = i; }
	}

	if (closestIdx === -1 || closestDist > REMOVE_THRESHOLD) return null;
	return { src: closestSrc, idx: closestIdx, wall: closestSrc[closestIdx] };
}

function removeClosestEditableWall(mx, my) {
	const hit = findClosestEditableWall(mx, my);
	if (!hit) return;
	hit.src.splice(hit.idx, 1);
	hoveredWall = null;
	rebuildWalls();
}
// #endregion

// #region Sliders and controls
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

document.getElementById("regenIntervalSlider").oninput = function () {
	var secs = parseInt(this.value);
	document.getElementById("regenIntervalValue").innerHTML = secs;
	regenIntervalMs = secs * 1000;
	startRegenTimer();
};

document.getElementById("autoRegenToggle").addEventListener("click", function () {
	autoRegen = !autoRegen;
	this.textContent = autoRegen ? "Turn Off" : "Turn On";
	document.getElementById("autoRegenStatus").textContent = autoRegen ? "On" : "Off";
	if (autoRegen) startRegenTimer(); else stopRegenTimer();
});

document.getElementById("newWallsBtn").addEventListener("click", function () {
	GetNewRandomLines();
});

document.getElementById("drawWallToggle").addEventListener("click", function () {
	drawMode = !drawMode;
	isDrawing = false;
	drawStart = null;
	drawCurrent = null;
	this.textContent = drawMode ? "Draw Wall: On" : "Draw Wall: Off";
	this.classList.toggle("active", drawMode);
	canvas.style.cursor = drawMode ? "crosshair" : "default";
});
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

function drawRays(raycaster) {
	ctx.save();
	// dark theme: additive blend → overlapping rays bloom into a bright core near the source.
	// light theme: plain dark strokes (additive is invisible on a light bg).
	if (!isLight) {
		ctx.globalCompositeOperation = 'lighter';
		ctx.strokeStyle = 'rgba(255, 205, 95, 0.14)';
		ctx.lineWidth = 1.2;
	} else {
		ctx.strokeStyle = rayColor;
		ctx.lineWidth = 1;
	}
	ctx.beginPath();
	raycaster.Draw(ctx);
	ctx.stroke();
	ctx.restore();
}

function drawVisibilityPolygon(intersectionPoints, pos) {
	ctx.save();
	ctx.beginPath();
	let first = true;
	for (let pt of intersectionPoints) {
		if (!pt) continue;
		if (first) { ctx.moveTo(pt.x, pt.y); first = false; }
		else ctx.lineTo(pt.x, pt.y);
	}
	ctx.closePath();
	// radial falloff from the source → lit area reads like a real torch beam
	const litR = Math.max(canvas_width, canvas_height) * 0.6;
	const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, litR);
	if (isLight) {
		grad.addColorStop(0,   'rgba(200, 140, 0, 0.22)');
		grad.addColorStop(0.5, 'rgba(200, 140, 0, 0.10)');
		grad.addColorStop(1,   'rgba(200, 140, 0, 0.02)');
	} else {
		grad.addColorStop(0,   'rgba(255, 220, 110, 0.20)');
		grad.addColorStop(0.5, 'rgba(255, 200, 80, 0.08)');
		grad.addColorStop(1,   'rgba(255, 180, 60, 0.01)');
	}
	ctx.fillStyle = grad;
	ctx.fill();
	ctx.restore();
}

function drawSourceGlow(pos) {
	ctx.save();
	const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 70);
	grad.addColorStop(0, isLight ? 'rgba(200, 140, 0, 0.55)' : 'rgba(255, 220, 100, 0.55)');
	grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(pos.x, pos.y, 70, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

function drawHighlightedWall(wall) {
	if (!wall) return;
	ctx.save();
	ctx.strokeStyle = isLight ? 'rgba(200, 40, 0, 0.9)' : 'rgba(255, 80, 60, 0.9)';
	ctx.lineWidth = 4;
	ctx.beginPath();
	wall.Draw(ctx);
	ctx.stroke();
	ctx.restore();
}

function drawWallPreview() {
	if (!isDrawing || !drawStart || !drawCurrent) return;
	ctx.save();
	ctx.strokeStyle = isLight ? 'rgba(200, 100, 0, 0.7)' : 'rgba(255, 180, 60, 0.7)';
	ctx.lineWidth = 2;
	ctx.setLineDash([6, 4]);
	ctx.beginPath();
	ctx.moveTo(drawStart.x, drawStart.y);
	ctx.lineTo(drawCurrent.x, drawCurrent.y);
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
	if (isDrawing) {
		isDrawing = false;
		drawStart = null;
		drawCurrent = null;
	}
});

canvas.addEventListener("mousemove", function (event) {
	let mouse = helpers.GetMousePos(canvas, event);
	rayCaster.position.x = mouse.x;
	rayCaster.position.y = mouse.y;
	if (isDrawing) {
		drawCurrent = { x: mouse.x, y: mouse.y };
	}
	const hit = findClosestEditableWall(mouse.x, mouse.y);
	hoveredWall = hit ? hit.wall : null;
	canvas.style.cursor = hoveredWall ? "pointer" : (drawMode ? "crosshair" : "default");
});

canvas.addEventListener("mousedown", function (event) {
	if (!drawMode || event.button !== 0) return;
	let mouse = helpers.GetMousePos(canvas, event);
	isDrawing = true;
	drawStart = { x: mouse.x, y: mouse.y };
	drawCurrent = { x: mouse.x, y: mouse.y };
});

canvas.addEventListener("mouseup", function (event) {
	if (!drawMode || event.button !== 0) return;
	if (!isDrawing || !drawStart || !drawCurrent) return;
	const dx = drawCurrent.x - drawStart.x;
	const dy = drawCurrent.y - drawStart.y;
	if (Math.hypot(dx, dy) > 5) {
		userWalls.push(new Line2D(
			new Vector2D(drawStart.x, drawStart.y),
			new Vector2D(dx, dy)
		));
		rebuildWalls();
	}
	isDrawing = false;
	drawStart = null;
	drawCurrent = null;
});

canvas.addEventListener("contextmenu", function (event) {
	event.preventDefault();
	let mouse = helpers.GetMousePos(canvas, event);
	removeClosestEditableWall(mouse.x, mouse.y);
});
// #endregion

// #region animation
var paused = false;
var fpsBadge = document.getElementById("fpsBadge");
var _fpsLast = 0, _fpsAccum = 0, _fpsFrames = 0;

function updateFps(ts) {
	if (_fpsLast) { _fpsAccum += ts - _fpsLast; _fpsFrames++; }
	_fpsLast = ts;
	if (_fpsAccum >= 500) {
		fpsBadge.textContent = Math.round(1000 / (_fpsAccum / _fpsFrames)) + ' fps';
		_fpsAccum = 0; _fpsFrames = 0;
	}
}

function savePNG() {
	const out = document.createElement('canvas');
	out.width = canvas_width; out.height = canvas_height;
	const octx = out.getContext('2d');
	octx.fillStyle = isLight ? '#f5ede0' : '#18140e';
	octx.fillRect(0, 0, canvas_width, canvas_height);
	octx.drawImage(canvas, 0, 0);
	const a = document.createElement('a');
	a.download = 'raycaster-' + Date.now() + '.png';
	a.href = out.toDataURL('image/png');
	a.click();
}

var pauseButton = document.getElementById("pauseButton");
function setPaused(p) {
	if (p === paused) return;
	paused = p;
	pauseButton.textContent = paused ? 'Resume (Space)' : 'Pause (Space)';
	if (!paused) { _fpsLast = 0; window.requestAnimationFrame(draw); }
}
pauseButton.onclick = () => setPaused(!paused);
document.getElementById("exportButton").onclick = savePNG;

document.addEventListener('keydown', (e) => {
	if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
	if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
	if (e.key === 'r' || e.key === 'R') GetNewRandomLines();
	if (e.key === 's' || e.key === 'S') savePNG();
});

function draw(ts) {
	updateFps(ts || performance.now());
	if (pointerOnCanvas === false) {
		rayCaster.position.x = Math.floor(canvas_width / 2);
		rayCaster.position.y = Math.floor(canvas_height / 2);

		let tempx = rayCaster.position.x + simplex.noise2D(simplexOffsetX, simplexOffsetY) * 200;
		let tempy = rayCaster.position.y + simplex.noise2D(simplexOffsetY, simplexOffsetX) * 200;
		simplexOffsetX += NOISE_TIME_STEP;
		simplexOffsetY += NOISE_TIME_STEP;

		if (tempx < 0 || tempx > canvas_width || tempy < 0 || tempy > canvas_height) {
			rayCaster.position.x = Math.floor(canvas_width / 2);
			rayCaster.position.y = Math.floor(canvas_height / 2);
		} else {
			rayCaster.position.x = tempx;
			rayCaster.position.y = tempy;
		}
	}

	ctx.clearRect(0, 0, canvas_width, canvas_height);

	rayCaster.UpdateRays();
	const intersectionPoints = rayCaster.FindAllClosestIntersectionPoints(walls);
	rayCaster.CutRaysAtClosestIntersectionPoint(intersectionPoints);

	drawVisibilityPolygon(intersectionPoints, rayCaster.position);
	drawSourceGlow(rayCaster.position);
	drawLines([...randomWalls, ...userWalls]);
	drawHighlightedWall(hoveredWall);
	drawCircle(rayCaster.position, 2, wallColor);
	drawRays(rayCaster);
	drawPoints(intersectionPoints);
	drawWallPreview();

	if (document.hidden || paused) return;
	window.requestAnimationFrame(draw);
}
// #endregion

window.requestAnimationFrame(draw);
document.addEventListener('visibilitychange', () => { if (!document.hidden) draw(); });
