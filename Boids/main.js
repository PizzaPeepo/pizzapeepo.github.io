import Boid from "./Boid.js";
import { SpatialHash } from "../GravitySimulation/SpatialHash.js";

// #region global variables
var canvasWidth = window.getCanvasWidth();
var canvasHeight = window.innerHeight;

// Steering config — mutated live by the sliders.
const cfg = {
	count: 1000,
	separation: 1.5,
	alignment: 1.0,
	cohesion: 0.9,
	perception: 55,
	separationDist: 24,
	maxSpeed: 4,
	maxForce: 0.08,
	mouseRadius: 180,
};

var boids = [];
var paused = false;
var trailsEnabled = true;
var colorBySpeed = true;
var fadeSpeed = 0.12;
var mouseMode = "repel"; // off | attract | repel
var mousePos = { x: canvasWidth / 2, y: canvasHeight / 2, inside: false };

var darkCanvasBg = "#18140e";
var viperCanvasBg = "#030806";
var lightCanvasBg = "#f5ede0";
var isLight = document.documentElement.classList.contains("light");
var isViper = document.documentElement.classList.contains("viper");

let hash = new SpatialHash(cfg.perception);
// #endregion

// #region canvas setup
var backgroundCanvas = document.getElementById("backgroundCanvas");
var ctx = backgroundCanvas.getContext("2d");

function applyCanvasSize() {
	backgroundCanvas.width = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width = canvasWidth + "px";
	backgroundCanvas.style.height = canvasHeight + "px";
}
applyCanvasSize();
// #endregion

// #region theme
function applyThemeColors(light) {
	isLight = light;
	isViper = document.documentElement.classList.contains("viper");
	backgroundCanvas.style.background = light ? lightCanvasBg : isViper ? viperCanvasBg : darkCanvasBg;
	clearCanvas();
}
applyThemeColors(isLight);
document.addEventListener("themechange", function (e) {
	isViper = e.detail.theme === "viper";
	applyThemeColors(e.detail.isLight);
});
// #endregion

function clearCanvas() {
	ctx.fillStyle = isLight ? lightCanvasBg : isViper ? viperCanvasBg : darkCanvasBg;
	ctx.fillRect(0, 0, canvasWidth, canvasHeight);
}

function spawnBoids() {
	boids = [];
	for (let i = 0; i < cfg.count; i++) {
		const angle = Math.random() * Math.PI * 2;
		const sp = cfg.maxSpeed * (0.5 + Math.random() * 0.5);
		boids.push(new Boid(
			Math.random() * canvasWidth,
			Math.random() * canvasHeight,
			Math.cos(angle) * sp,
			Math.sin(angle) * sp
		));
	}
	clearCanvas();
}
spawnBoids();

// #region resize
window.addEventListener("resize", function () {
	canvasWidth = window.getCanvasWidth();
	canvasHeight = window.innerHeight;
	if (window._hudToggling) return;
	applyCanvasSize();
	spawnBoids();
});
// #endregion

// #region inputs
function bindSlider(id, valId, parse, onChange, fmt) {
	const slider = document.getElementById(id);
	const label = document.getElementById(valId);
	slider.value = onChange.initial;
	label.innerHTML = fmt ? fmt(onChange.initial) : onChange.initial;
	slider.oninput = function () {
		const v = parse(this.value);
		label.innerHTML = fmt ? fmt(v) : v;
		onChange(v);
	};
}

bindSlider("countSlider", "countValue", parseInt, Object.assign(function (v) {
	cfg.count = v;
	spawnBoids();
}, { initial: cfg.count }));

bindSlider("separationSlider", "separationValue", parseFloat, Object.assign(function (v) {
	cfg.separation = v;
}, { initial: cfg.separation }), (v) => v.toFixed(2));

bindSlider("alignmentSlider", "alignmentValue", parseFloat, Object.assign(function (v) {
	cfg.alignment = v;
}, { initial: cfg.alignment }), (v) => v.toFixed(2));

bindSlider("cohesionSlider", "cohesionValue", parseFloat, Object.assign(function (v) {
	cfg.cohesion = v;
}, { initial: cfg.cohesion }), (v) => v.toFixed(2));

bindSlider("perceptionSlider", "perceptionValue", parseInt, Object.assign(function (v) {
	cfg.perception = v;
	hash = new SpatialHash(cfg.perception);
}, { initial: cfg.perception }));

bindSlider("speedSlider", "speedValue", parseFloat, Object.assign(function (v) {
	cfg.maxSpeed = v;
}, { initial: cfg.maxSpeed }), (v) => v.toFixed(1));

bindSlider("fadeSpeedSlider", "fadeSpeedValue", parseInt, Object.assign(function (v) {
	fadeSpeed = v / 100;
}, { initial: fadeSpeed * 100 }));

document.querySelectorAll('input[name="mouseMode"]').forEach(function (radio) {
	radio.addEventListener("change", function () {
		if (this.checked) mouseMode = this.value;
	});
});

var trailCheckbox = document.getElementById("trailCheckbox");
trailCheckbox.checked = trailsEnabled;
trailCheckbox.onclick = function () {
	trailsEnabled = this.checked;
	clearCanvas();
};

var colorCheckbox = document.getElementById("colorCheckbox");
colorCheckbox.checked = colorBySpeed;
colorCheckbox.onclick = function () { colorBySpeed = this.checked; };

var pauseButton = document.getElementById("pauseButton");
pauseButton.onclick = togglePause;
function togglePause() {
	paused = !paused;
	pauseButton.textContent = paused ? "Resume (Space)" : "Pause (Space)";
}

document.getElementById("resetButton").onclick = spawnBoids;
// #endregion

// #region mouse
window.addEventListener("mousemove", function (e) {
	const rect = backgroundCanvas.getBoundingClientRect();
	mousePos.x = e.clientX - rect.left;
	mousePos.y = e.clientY - rect.top;
	mousePos.inside = mousePos.x >= 0 && mousePos.x < canvasWidth && mousePos.y >= 0 && mousePos.y < canvasHeight;
});
window.addEventListener("mouseout", function () { mousePos.inside = false; });
// #endregion


window.addEventListener("keydown", function (e) {
	if (e.code === "Space") { e.preventDefault(); togglePause(); }
	if (e.key === "r" || e.key === "R") spawnBoids();
});

// #region rendering
function drawBoid(b) {
	const vx = b.velocity.x, vy = b.velocity.y;
	const speed = Math.sqrt(vx * vx + vy * vy) || 1;
	const dirX = vx / speed, dirY = vy / speed;
	const size = 6;

	// Tip ahead, two tails behind
	const tipX = b.position.x + dirX * size;
	const tipY = b.position.y + dirY * size;
	const backX = b.position.x - dirX * size * 0.6;
	const backY = b.position.y - dirY * size * 0.6;
	const perpX = -dirY, perpY = dirX;
	const wing = size * 0.5;

	ctx.beginPath();
	ctx.moveTo(tipX, tipY);
	ctx.lineTo(backX + perpX * wing, backY + perpY * wing);
	ctx.lineTo(backX - perpX * wing, backY - perpY * wing);
	ctx.closePath();

	if (colorBySpeed) {
		const t = Math.min(b.hue, 1); // 0 slow .. 1 fast
		const hue = isViper ? 130 - t * 30 : 45 - t * 35;
		const lum = isLight ? 45 : isViper ? 65 : 62;
		const sat = isViper ? 100 : 85;
		ctx.fillStyle = `hsl(${hue}, ${sat}%, ${lum}%)`;
	} else {
		ctx.fillStyle = isLight ? "rgba(40,24,8,0.9)" : isViper ? "rgba(40,255,69,0.9)" : "rgba(245,210,150,0.9)";
	}
	ctx.fill();
}
// #endregion

// #region simulation step
function step() {
	hash.clear();
	for (let i = 0; i < boids.length; i++) {
		hash.insert(i, boids[i].position.x, boids[i].position.y);
	}

	const repel = mouseMode === "repel";
	const useMouse = mouseMode !== "off" && mousePos.inside;

	for (let i = 0; i < boids.length; i++) {
		const b = boids[i];
		const idxs = hash.queryNeighbors(b.position.x, b.position.y);
		// Map shared scratch indices to boid objects (copy needed before next query)
		const neighbours = [];
		for (let k = 0; k < idxs.length; k++) neighbours.push(boids[idxs[k]]);
		b.flock(neighbours, cfg);
		if (useMouse) b.applyMouse(mousePos.x, mousePos.y, repel ? -1 : 1, cfg);
	}

	for (let i = 0; i < boids.length; i++) {
		boids[i].update(cfg.maxSpeed, canvasWidth, canvasHeight);
	}
}
// #endregion

// #region FPS
var fpsBadge = document.getElementById("fpsBadge");
var lastFpsUpdate = performance.now();
var frameCount = 0;
// #endregion

function draw(now) {
	window.requestAnimationFrame(draw);
	if (document.hidden) return;

	if (trailsEnabled) {
		// Fade previous frame toward background — leaves motion trails.
		ctx.fillStyle = isLight
			? `rgba(245,237,224,${fadeSpeed})`
			: isViper ? `rgba(3,8,6,${fadeSpeed})` : `rgba(24,20,14,${fadeSpeed})`;
		ctx.fillRect(0, 0, canvasWidth, canvasHeight);
	} else {
		clearCanvas();
	}

	if (!paused) step();
	for (let i = 0; i < boids.length; i++) drawBoid(boids[i]);

	// FPS badge
	frameCount++;
	if (now - lastFpsUpdate >= 500) {
		const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
		fpsBadge.textContent = fps + " fps · " + boids.length;
		frameCount = 0;
		lastFpsUpdate = now;
	}
}

window.requestAnimationFrame(draw);
document.addEventListener("visibilitychange", () => { if (!document.hidden) window.requestAnimationFrame(draw); });
