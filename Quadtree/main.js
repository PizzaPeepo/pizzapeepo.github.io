import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";
import { Rectangle } from "../Utils/rectangle.js";
import { Quadtree } from "./Quadtree.js";
import { onThemeChange } from "../Utils/ThemeManager.js";
import { onWindowResize } from "../Utils/ResizeManager.js";
import { setupCanvases } from "../Utils/CanvasManager.js";

// #region global variables
var canvasHeight = window.innerHeight;
var canvasWidth = window.getCanvasWidth();
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var resetCanvas = false;
var paused = false;

var pointCount = 320;
var capacity = 4;
var querySize = 260;
var moving = true;          // points drift, so the tree continuously rebuilds
let points = [];            // { x, y, vx, vy }
// #endregion

// #region canvas setup
var backgroundCanvas = document.getElementById("backgroundCanvas");
var bgCtx = backgroundCanvas.getContext("2d");
var foregroundCanvas = document.getElementById("foregroundCanvas");
var fgCtx = foregroundCanvas.getContext("2d");

function applyCanvasSize() {
	setupCanvases([
		{ canvas: backgroundCanvas, configure: (ctx) => { ctx.strokeStyle = whiteLineStrokeStyle; ctx.lineWidth = 1; } },
		{ canvas: foregroundCanvas, configure: (ctx) => { ctx.strokeStyle = whiteLineStrokeStyle; ctx.lineWidth = 1; } },
	], canvasWidth, canvasHeight);
}
applyCanvasSize();
// #endregion

// #region theme
var isLight = document.documentElement.classList.contains('light');
let cellRGB = '255, 210, 120';      // quadtree grid (gold)
let dotRGB  = '245, 232, 212';      // idle points (cream)
let bgColor = '#18140e';

function applyThemeColors(light) {
	isLight = light;
	bgColor = light ? '#f5ede0' : '#18140e';
	backgroundCanvas.style.background = bgColor;
	cellRGB = light ? '180, 110, 0'  : '255, 210, 120';
	dotRGB  = light ? '60, 40, 20'   : '245, 232, 212';
}
onThemeChange(applyThemeColors);
applyThemeColors(isLight);
// #endregion

// #region points
function makePoint(x, y, speed) {
	const a = Math.random() * Math.PI * 2;
	const s = speed === undefined ? (0.2 + Math.random() * 0.7) : speed;
	return { x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s };
}

function seedPoints(n) {
	points = [];
	for (let i = 0; i < n; i++) {
		points.push(makePoint(helpers.GetRandomInt(canvasWidth), helpers.GetRandomInt(canvasHeight)));
	}
}
seedPoints(pointCount);

function updatePoints() {
	if (!moving) return;
	for (const p of points) {
		p.x += p.vx; p.y += p.vy;
		if (p.x < 0)            { p.x = 0;            p.vx = -p.vx; }
		else if (p.x > canvasWidth)  { p.x = canvasWidth;  p.vx = -p.vx; }
		if (p.y < 0)            { p.y = 0;            p.vy = -p.vy; }
		else if (p.y > canvasHeight) { p.y = canvasHeight; p.vy = -p.vy; }
	}
}
// #endregion

// #region resize
onWindowResize(function() {
	canvasWidth  = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	applyCanvasSize();
	boundary = new Rectangle(0, 0, canvasWidth, canvasHeight);
});
// #endregion

// #region controls
function bindSlider(id, valId, parse, onChange, fmt) {
	const s = document.getElementById(id), v = document.getElementById(valId);
	const set = () => { const val = parse(s.value); if (v) v.textContent = fmt ? fmt(val) : val; onChange(val); };
	s.addEventListener('input', set);
	return { el: s, set };
}

bindSlider('pointCountSlider', 'pointCountValue', v => parseInt(v), v => {
	if (v > points.length) { for (let i = points.length; i < v; i++) points.push(makePoint(helpers.GetRandomInt(canvasWidth), helpers.GetRandomInt(canvasHeight))); }
	else points.length = v;
	pointCount = v;
});
bindSlider('capacitySlider', 'capacityValue', v => parseInt(v), v => { capacity = v; });
bindSlider('querySizeSlider', 'querySizeValue', v => parseInt(v), v => { querySize = v; });

document.getElementById('pointCountSlider').value = pointCount;
document.getElementById('pointCountValue').textContent = pointCount;
document.getElementById('capacitySlider').value = capacity;
document.getElementById('capacityValue').textContent = capacity;
document.getElementById('querySizeSlider').value = querySize;
document.getElementById('querySizeValue').textContent = querySize;

var movingCheckbox = document.getElementById('movingCheckbox');
movingCheckbox.checked = moving;
movingCheckbox.onclick = function () { moving = this.checked; };

var resetCanvasButton = document.getElementById("resetCanvasButton");
resetCanvasButton.onclick = function () { resetCanvas = true; if (paused) setPaused(false); };

var pauseButton = document.getElementById("pauseButton");
function setPaused(p) {
	if (p === paused) return;
	paused = p;
	pauseButton.textContent = paused ? 'Resume (Space)' : 'Pause (Space)';
	if (!paused) { _fpsLast = 0; window.requestAnimationFrame(draw); }
}
pauseButton.onclick = () => setPaused(!paused);


document.addEventListener('keydown', (e) => {
	if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
	if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
	if (e.key === 'r' || e.key === 'R') { resetCanvas = true; if (paused) setPaused(false); }
});
// #endregion

// #region mouse events
let pointerOnCanvas = false;
let isLeftMouseDown = false;
let mouse = new Vector2D(canvasWidth / 2, canvasHeight / 2);

function SetPointerOnCanvas(b) { pointerOnCanvas = b; }

foregroundCanvas.addEventListener("touchstart", (e) => { SetPointerOnCanvas(true); isLeftMouseDown = true; const t = e.changedTouches[0]; mouse.x = t.clientX; mouse.y = t.clientY; e.preventDefault(); });
foregroundCanvas.addEventListener("touchend",   (e) => { isLeftMouseDown = false; e.preventDefault(); });
foregroundCanvas.addEventListener("touchmove",  (e) => { const t = e.changedTouches[0]; mouse.x = t.clientX; mouse.y = t.clientY; e.preventDefault(); });
foregroundCanvas.addEventListener("mouseenter", () => SetPointerOnCanvas(true));
foregroundCanvas.addEventListener("mouseleave", () => { SetPointerOnCanvas(false); isLeftMouseDown = false; });
foregroundCanvas.addEventListener("contextmenu", (e) => e.preventDefault());
foregroundCanvas.addEventListener("mousedown", (e) => { if (e.button === 0) isLeftMouseDown = true; });
foregroundCanvas.addEventListener("mouseup",   (e) => { if (e.button === 0) isLeftMouseDown = false; });
foregroundCanvas.addEventListener("mousemove", (e) => { mouse = helpers.GetMousePos(foregroundCanvas, e); });
// #endregion

// #region drawing
let boundary = new Rectangle(0, 0, canvasWidth, canvasHeight);
let quadtree = new Quadtree(boundary, capacity);
let area = new Rectangle(0, 0, querySize, querySize);

// recursive cell render — deeper subdivisions glow brighter so the tree's structure reads at a glance
function drawCells(node, depth) {
	const b = node.boundary;
	const alpha = Math.min(0.5, 0.07 + depth * 0.09);
	fgCtx.strokeStyle = 'rgba(' + cellRGB + ',' + alpha + ')';
	fgCtx.lineWidth = 1;
	fgCtx.strokeRect(b.x, b.y, b.w, b.h);
	if (node.divided) {
		drawCells(node.NW, depth + 1);
		drawCells(node.NE, depth + 1);
		drawCells(node.SW, depth + 1);
		drawCells(node.SE, depth + 1);
	}
}

function draw(ts) {
	updateFps(ts || performance.now());
	fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	if (resetCanvas) { seedPoints(pointCount); resetCanvas = false; }

	updatePoints();

	// rebuild the tree from scratch each frame — the whole point of the demo
	quadtree = new Quadtree(boundary, capacity);
	for (const p of points) quadtree.insert(p);

	// query box follows the cursor; auto-roams when the pointer is away
	if (pointerOnCanvas) { area.x = mouse.x - querySize / 2; area.y = mouse.y - querySize / 2; }
	else {
		const t = Date.now() * 0.0005;
		area.x = canvasWidth  * 0.5 + Math.cos(t) * canvasWidth  * 0.28 - querySize / 2;
		area.y = canvasHeight * 0.5 + Math.sin(t * 1.3) * canvasHeight * 0.28 - querySize / 2;
	}
	area.w = querySize; area.h = querySize;

	// click sprays new points under the cursor
	if (isLeftMouseDown && pointerOnCanvas) {
		for (let i = 0; i < 3; i++) {
			points.push(makePoint(mouse.x + (Math.random() - 0.5) * 30, mouse.y + (Math.random() - 0.5) * 30));
		}
		pointCount = points.length;
		const s = document.getElementById('pointCountSlider');
		if (pointCount <= +s.max) { s.value = pointCount; document.getElementById('pointCountValue').textContent = pointCount; }
	}

	drawCells(quadtree, 0);

	const queried = quadtree.queryArea(area);
	const qSet = new Set(queried);

	// idle points
	fgCtx.fillStyle = 'rgba(' + dotRGB + ',0.7)';
	for (const p of points) {
		if (qSet.has(p)) continue;
		fgCtx.fillRect(p.x - 1, p.y - 1, 2, 2);
	}

	// query box
	fgCtx.strokeStyle = 'rgba(255, 107, 71, 0.9)';
	fgCtx.lineWidth = 1.5;
	fgCtx.strokeRect(area.x, area.y, area.w, area.h);
	fgCtx.fillStyle = 'rgba(255, 107, 71, 0.06)';
	fgCtx.fillRect(area.x, area.y, area.w, area.h);

	// matched points glow
	fgCtx.save();
	fgCtx.globalCompositeOperation = 'lighter';
	for (const p of queried) {
		fgCtx.fillStyle = 'rgba(255, 150, 90, 0.9)';
		fgCtx.beginPath();
		fgCtx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
		fgCtx.fill();
	}
	fgCtx.restore();

	// readout
	fgCtx.fillStyle = 'rgba(255, 107, 71, 0.95)';
	fgCtx.font = '600 13px DM Sans, system-ui, sans-serif';
	fgCtx.fillText(queried.length + ' in range', area.x + 6, area.y - 8 < 12 ? area.y + area.h + 18 : area.y - 8);

	if (document.hidden || paused) return;
	window.requestAnimationFrame(draw);
}
// #endregion

// #region fps
var fpsBadge = document.getElementById("fpsBadge");
var _fpsLast = 0, _fpsAccum = 0, _fpsFrames = 0;
function updateFps(ts) {
	if (_fpsLast) { _fpsAccum += ts - _fpsLast; _fpsFrames++; }
	_fpsLast = ts;
	if (_fpsAccum >= 500 && fpsBadge) {
		fpsBadge.textContent = Math.round(1000 / (_fpsAccum / _fpsFrames)) + ' fps';
		_fpsAccum = 0; _fpsFrames = 0;
	}
}
// #endregion

window.requestAnimationFrame(draw);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !paused) { _fpsLast = 0; draw(); } });
