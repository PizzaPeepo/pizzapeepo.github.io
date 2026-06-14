import * as helpers from "../Utils/helpers.js";
import Vector2D from "../Utils/Vector2D.js";
import FadeTrail from "../Utils/FadeTrail.js";
import { onThemeChange } from "../Utils/ThemeManager.js";
import { onWindowResize } from "../Utils/ResizeManager.js";
import { setupCanvases } from "../Utils/CanvasManager.js";

// #region state
var canvasHeight = window.innerHeight;
var canvasWidth = window.getCanvasWidth();

var numberOfDots = 64;
var speed = 0.02;        // global phase advance per frame
var spread = 1.0;        // how much phase shift accumulates across spokes
var dotSize = 4;
var trailLen = 22;
var colorMode = 'spectrum';
var glow = true;
var showSpokes = true;
var connect = false;
var paused = false;

let origin = new Vector2D(canvasWidth / 2, canvasHeight / 2);
let amp = Math.min(canvasWidth, canvasHeight) * 0.38;
let dirX = [], dirY = [], colors = [];
let globalPhase = 0;

const trail = new FadeTrail(400);
// #endregion

// #region canvas
var backgroundCanvas = document.getElementById("backgroundCanvas");
var bgCtx = backgroundCanvas.getContext("2d");
var foregroundCanvas = document.getElementById("foregroundCanvas");
var fgCtx = foregroundCanvas.getContext("2d");

function applyCanvasSize() {
	setupCanvases([
		{ canvas: backgroundCanvas, configure: (ctx) => { ctx.lineWidth = 1; } },
		{ canvas: foregroundCanvas, configure: (ctx) => { ctx.lineWidth = 2; } },
	], canvasWidth, canvasHeight);
}
applyCanvasSize();
// #endregion

// #region theme + geometry
var isLight = document.documentElement.classList.contains('light');
let bgColor = '#18140e';
let spokeColor = 'rgba(255,255,255,0.12)';
let monoColor = 'rgba(245,232,212,1)';

function buildColors() {
	colors = [];
	for (let j = 0; j < numberOfDots; j++) {
		const f = j / numberOfDots;
		if (colorMode === 'spectrum')   colors.push('hsl(' + Math.round(f * 360) + ', 90%, 65%)');
		else if (colorMode === 'warm')  colors.push('hsl(' + Math.round(38 - f * 28) + ', 95%, ' + Math.round(62 - f * 8) + '%)');
		else                            colors.push(monoColor);
	}
}

function rebuildGeometry() {
	origin = new Vector2D(canvasWidth / 2, canvasHeight / 2);
	amp = Math.min(canvasWidth, canvasHeight) * 0.38;
	const shift = (2 * Math.PI) / numberOfDots;
	dirX = []; dirY = [];
	for (let j = 0; j < numberOfDots; j++) {
		// spokes point "up" then rotate evenly around the circle
		const a = j * shift - Math.PI / 2;
		dirX.push(Math.cos(a));
		dirY.push(Math.sin(a));
	}
	buildColors();
	drawSpokes();
}

function drawSpokes() {
	bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
	if (!showSpokes) return;
	bgCtx.save();
	bgCtx.strokeStyle = spokeColor;
	bgCtx.setLineDash([1, 5]);
	bgCtx.lineWidth = 1;
	bgCtx.beginPath();
	for (let j = 0; j < numberOfDots; j++) {
		bgCtx.moveTo(origin.x - dirX[j] * amp, origin.y - dirY[j] * amp);
		bgCtx.lineTo(origin.x + dirX[j] * amp, origin.y + dirY[j] * amp);
	}
	bgCtx.stroke();
	bgCtx.restore();
}

function applyThemeColors(light) {
	isLight = light;
	var isViper = document.documentElement.classList.contains('viper');
	bgColor = light ? '#f5ede0' : isViper ? '#030806' : '#18140e';
	backgroundCanvas.style.background = bgColor;
	spokeColor = light ? 'rgba(40,25,10,0.13)' : isViper ? 'rgba(40,255,69,0.10)' : 'rgba(255,255,255,0.12)';
	monoColor  = light ? 'rgba(40,25,10,0.95)' : isViper ? 'rgba(168,255,166,1)' : 'rgba(245,232,212,1)';
	buildColors();
	drawSpokes();
}
onThemeChange(applyThemeColors);
applyThemeColors(isLight);
rebuildGeometry();
// #endregion

// #region resize
onWindowResize(function() {
	canvasWidth  = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	rebuildGeometry();
});
// #endregion

// #region controls
function bind(id, valId, parse, set, fmt) {
	const s = document.getElementById(id), v = document.getElementById(valId);
	s.addEventListener('input', () => { const val = parse(s.value); if (v) v.textContent = fmt ? fmt(val) : val; set(val); });
	return s;
}
const dotsSlider = bind('dotsSlider', 'dotsValue', v => parseInt(v), v => { numberOfDots = v; trail.reset(); rebuildGeometry(); });
bind('speedSlider', 'speedValue', v => parseFloat(v), v => { speed = v; }, v => v.toFixed(3));
bind('spreadSlider', 'spreadValue', v => parseFloat(v), v => { spread = v; trail.reset(); }, v => v.toFixed(1));
bind('sizeSlider', 'sizeValue', v => parseFloat(v), v => { dotSize = v; });
bind('trailSlider', 'trailValue', v => parseInt(v), v => { trailLen = v; trail.reset(); });

dotsSlider.value = numberOfDots; document.getElementById('dotsValue').textContent = numberOfDots;
document.getElementById('speedSlider').value = speed; document.getElementById('speedValue').textContent = speed.toFixed(3);
document.getElementById('spreadSlider').value = spread; document.getElementById('spreadValue').textContent = spread.toFixed(1);
document.getElementById('sizeSlider').value = dotSize; document.getElementById('sizeValue').textContent = dotSize;
document.getElementById('trailSlider').value = trailLen; document.getElementById('trailValue').textContent = trailLen;

document.querySelectorAll('input[name="colorMode"]').forEach(r => {
	r.addEventListener('change', () => { if (r.checked) { colorMode = r.value; buildColors(); } });
});
document.getElementById('glowCheckbox').onclick   = function () { glow = this.checked; };
document.getElementById('spokesCheckbox').onclick = function () { showSpokes = this.checked; drawSpokes(); };
document.getElementById('connectCheckbox').onclick = function () { connect = this.checked; };

document.getElementById('resetButton').onclick = () => { globalPhase = 0; trail.reset(); if (paused) setPaused(false); };

var pauseButton = document.getElementById('pauseButton');
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
	if (e.key === 'r' || e.key === 'R') { globalPhase = 0; trail.reset(); if (paused) setPaused(false); }
});
// #endregion

// #region render
function renderFrame(phase, opacity) {
	const phaseOffset = spread * (2 * Math.PI) / numberOfDots;
	if (connect) {
		fgCtx.globalAlpha = opacity * 0.5;
		fgCtx.strokeStyle = colorMode === 'mono' ? monoColor : (isLight ? 'rgba(180,110,0,0.6)' : document.documentElement.classList.contains('viper') ? 'rgba(40,255,69,0.6)' : 'rgba(255,200,110,0.5)');
		fgCtx.lineWidth = 1.5;
		fgCtx.beginPath();
		for (let j = 0; j < numberOfDots; j++) {
			const along = Math.sin(phase + j * phaseOffset) * amp;
			const x = origin.x + dirX[j] * along, y = origin.y + dirY[j] * along;
			if (j === 0) fgCtx.moveTo(x, y); else fgCtx.lineTo(x, y);
		}
		fgCtx.stroke();
	}
	for (let j = 0; j < numberOfDots; j++) {
		const along = Math.sin(phase + j * phaseOffset) * amp;
		const x = origin.x + dirX[j] * along, y = origin.y + dirY[j] * along;
		fgCtx.globalAlpha = opacity;
		fgCtx.fillStyle = colors[j];
		fgCtx.beginPath();
		fgCtx.arc(x, y, dotSize, 0, Math.PI * 2);
		fgCtx.fill();
	}
}

function draw(ts) {
	updateFps(ts || performance.now());
	fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

	globalPhase += speed;
	trail.push(globalPhase);

	// fadeSpeed tuned so the oldest visible frame lands ~trailLen frames back
	const fadeSpeed = 1 - Math.pow(1 / 255, 1 / Math.max(1, trailLen));

	fgCtx.save();
	if (glow) fgCtx.globalCompositeOperation = 'lighter';
	trail.render(fadeSpeed, renderFrame);
	fgCtx.restore();
	fgCtx.globalAlpha = 1;

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
