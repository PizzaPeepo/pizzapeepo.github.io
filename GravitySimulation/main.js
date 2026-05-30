import * as helpers from "../Utils/helpers.js";
import * as RungeKutta from "../Utils/RungeKutta.js";
import Particle from "./particle.js";
import Vector2D from "../Utils/Vector2D.js";
import { BarnesHutTree } from "./BarnesHutTree.js";
import { SpatialHash } from "./SpatialHash.js";

// #region global variables
const HUD_PANEL_WIDTH = 280;
var canvasHeight = window.innerHeight;
var canvasWidth = window.innerWidth - HUD_PANEL_WIDTH;
const whiteLineStrokeStyle = "rgba(255, 255, 255, 1.0)";
var resetCanvas = false;
var stop = false;
var fpsInterval, now, then, elapsed;
const FPS_BUFFER_SIZE = 60;
const fpsBuffer = new Float32Array(FPS_BUFFER_SIZE);
let fpsBufferIdx = 0;
let fpsBufferCount = 0;
let fpsLastDrawTime = 0;

var particleCount = 20;
var particles = [];
var dt = 0.01;
const TRAIL_FADE = 0.04;
const MAX_TRAIL_SPEED = 60;

let repullsionColors = [];
let attractionColors = [];
const LUT_SIZE = 64;
let attractionLUT = [];
let repulsionLUT = [];
let sunColor;
let fadeColor = 'rgba(24,18,14,' + TRAIL_FADE + ')';

const themeColors = {
	dark: {
		bg:         '#18140e',
		sun:        '#FFFF00',
		attraction: ['#FFFFFF', '#ffbbde', '#ffbbde', '#ff3ba0'],
		repulsion:  ['#FFFFFF', '#6fe9ff', '#6fe9ff', '#0066ff'],
	},
	light: {
		bg:         '#f5ede0',
		sun:        '#ff9000',
		attraction: ['#3a2810', '#8a1530', '#c04060', '#ff70a0'],
		repulsion:  ['#3a2810', '#1050b0', '#3090d0', '#50d0ff'],
	},
};

const WallBehaviorEnum = Object.freeze({ none: 1, infinite: 2, collision: 3 });
let wallBehavior = WallBehaviorEnum.collision;
var wallFrictionFactor = 0.8;
let particleCollisionsEnabled = true;
let barnesHutEnabled = true;
let bhTheta = 1.5;
let particleSizeScale = 1.0;
const bhTree = new BarnesHutTree(bhTheta);
let accelBuf = new Float64Array(6000 * 2);
let _sh = null, _shCellSize = 0;

let collisionSparksEnabled = true;
let forceBrushAttract = false;
let forceBrushRepel = false;
const BRUSH_STRENGTH = 5e6;
const BRUSH_SOFT2 = 2500;
let attractionSprites = null, repulsionSprites = null;

var initial_gravitationalConst = 50;
let initial_sunMass = 10000;
let initial_sunRadius = 15;

var gravitationalConst = initial_gravitationalConst;
let sunMass = initial_sunMass;
let sunRadius = initial_sunRadius;

// #region random particle parameters
let initial_xmin = 10;
let initial_xmax = canvasWidth - 10;
let initial_ymin = 10;
let initial_ymax = canvasHeight - 10;
let initial_vxMin = 0;
let initial_vxMax = 10;
let initial_vyMin = 0;
let initial_vyMax = 10;
let initial_radiusMin = 1;
let initial_radiusMax = 10;
let initial_massMin = 1;
let initial_massMax = 2;

let xmin = initial_xmin;
let xmax = initial_xmax;
let ymin = initial_ymin;
let ymax = initial_ymax;
let vxMin = initial_vxMin;
let vxMax = initial_vxMax;
let vyMin = initial_vyMin;
let vyMax = initial_vyMax;
let radiusMin = initial_radiusMin;
let radiusMax = initial_radiusMax;
let massMin = initial_massMin;
let massMax = initial_massMax;
// #endregion

function GenerateRandomizedParticles(particleCount) {
	// sun
	particles = [];
	particles.push(
		new Particle(
			new Vector2D(Math.floor(canvasWidth / 2), Math.floor(canvasHeight / 2)),
			new Vector2D(0, 0),
			new Vector2D(0, 0),
			sunRadius,
			sunMass
		)
	);
	particles = Particle.AddNRandomParticles(
		particles,
		particleCount - 1,
		xmin,
		xmax,
		ymin,
		ymax,
		vxMin,
		vxMax,
		vyMin,
		vyMax,
		radiusMin,
		radiusMax,
		massMin,
		massMax
	);

	if (gravitationalConst > 0) {
		const sunPos = particles[0].position;
		for (let i = 1; i < particles.length; i++) {
			const dx = particles[i].position.x - sunPos.x;
			const dy = particles[i].position.y - sunPos.y;
			const r = Math.sqrt(dx * dx + dy * dy);
			if (r > 0) {
				const orbitalSpeed = Math.sqrt(gravitationalConst * sunMass / r);
				particles[i].velocity = new Vector2D(-dy / r * orbitalSpeed, dx / r * orbitalSpeed);
			}
		}
	}
	if (particleSizeScale !== 1.0) {
		for (let i = 1; i < particles.length; i++) particles[i].radius *= particleSizeScale;
	}
	computeInitialAccelerations();
}

// Computes and stores gravitational acceleration on every particle (direct O(n²)).
// Called on reset and after G changes — leapfrog needs correct stored accelerations.
function computeInitialAccelerations() {
	if (accelBuf.length < particles.length * 2) accelBuf = new Float64Array(particles.length * 2);
	RungeKutta.computeAllAccelerationsInto(particles, gravitationalConst, accelBuf);
	for (let i = 0; i < particles.length; i++) {
		particles[i].acceleration.Update(accelBuf[2 * i], accelBuf[2 * i + 1]);
	}
}

GenerateRandomizedParticles(particleCount);
// #endregion

// #region getting canvas and context of fore- and background
var backgroundCanvas = document.getElementById("backgroundCanvas");
var bgCtx = backgroundCanvas.getContext("2d");
var foregroundCanvas = document.getElementById("foregroundCanvas");
var fgCtx = foregroundCanvas.getContext("2d");

function applyCanvasSize() {
	backgroundCanvas.width  = canvasWidth;
	backgroundCanvas.height = canvasHeight;
	backgroundCanvas.style.width  = canvasWidth  + 'px';
	backgroundCanvas.style.height = canvasHeight + 'px';
	bgCtx.strokeStyle = whiteLineStrokeStyle;
	bgCtx.lineWidth = 2;
	foregroundCanvas.width  = canvasWidth;
	foregroundCanvas.height = canvasHeight;
	foregroundCanvas.style.width  = canvasWidth  + 'px';
	foregroundCanvas.style.height = canvasHeight + 'px';
	fgCtx.strokeStyle = whiteLineStrokeStyle;
	fgCtx.lineWidth = 2;
}
applyCanvasSize();

window.addEventListener('resize', function () {
	canvasWidth  = window.innerWidth - HUD_PANEL_WIDTH;
	canvasHeight = window.innerHeight;
	applyCanvasSize();
	resetCanvas = true;
});

// Bake a palette into LUT_SIZE ready-to-use rgba strings, indexed by a clamped [0,1] value.
// Lets the hot draw/trail loops index a string instead of allocating a ColorRGBA (+ its string)
// per particle per frame. 64 steps is visually continuous.
function buildColorLUT(palette) {
	const lut = new Array(LUT_SIZE);
	for (let i = 0; i < LUT_SIZE; i++) {
		lut[i] = helpers.ColorRGBA.LinearInterpolateColors(palette, i / (LUT_SIZE - 1)).RGBA;
	}
	return lut;
}

// Pre-bake one 32×32 OffscreenCanvas per LUT slot: radial gradient from full color at center to
// transparent at edge. drawImage scales to particle glow radius, so no per-frame gradient alloc.
function buildGlowSprites(lut) {
	const sprites = new Array(LUT_SIZE);
	for (let i = 0; i < LUT_SIZE; i++) {
		const off = new OffscreenCanvas(32, 32);
		const ctx = off.getContext('2d');
		const c = lut[i];
		const cFade = c.replace(/,\s*[\d.]+\)$/, ', 0)');
		const cMid  = c.replace(/,\s*[\d.]+\)$/, ', 0.35)');
		const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
		grad.addColorStop(0,   c);
		grad.addColorStop(0.4, cMid);
		grad.addColorStop(1,   cFade);
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, 32, 32);
		sprites[i] = off;
	}
	return sprites;
}

function applyThemeColors(isLight) {
	const t = isLight ? themeColors.light : themeColors.dark;
	backgroundCanvas.style.background = t.bg;
	sunColor        = helpers.HexToRGBA(t.sun);
	attractionColors = t.attraction.map(c => helpers.HexToRGBA(c));
	repullsionColors = t.repulsion.map(c => helpers.HexToRGBA(c));
	attractionLUT = buildColorLUT(attractionColors);
	repulsionLUT = buildColorLUT(repullsionColors);
	attractionSprites = buildGlowSprites(attractionLUT);
	repulsionSprites  = buildGlowSprites(repulsionLUT);
	fadeColor = isLight
		? 'rgba(245,237,224,' + TRAIL_FADE + ')'
		: 'rgba(24,18,14,' + TRAIL_FADE + ')';
	bgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
}
applyThemeColors(document.documentElement.classList.contains('light'));
document.addEventListener('themechange', function (e) {
	applyThemeColors(e.detail.isLight);
});
// #endregion

// #region Inputs
let xSliderMin = 10;
let xSliderMax = 90;
let xSliderStep = 1;
let ySliderMin = 10;
let ySliderMax = 90;
let ySliderStep = 1;
let vxSliderMin = -1000;
let vxSliderMax = 1000;
let vxSliderStep = 1;
let vySliderMin = -1000;
let vySliderMax = 1000;
let vySliderStep = 1;
let radiusSliderMin = 1;
let radiusSliderMax = 30;
let radiusSliderStep = 1;
let massSliderMin = 1;
let massSliderMax = 499;
let massSliderStep = 1;

// #region reset canvas button
var resetCanvasButton = document.getElementById("resetCanvasButton");

resetCanvasButton.onclick = function () {
	resetCanvas = true;
};
// #endregion

// #region reset settings button
var resetSettingsButton = document.getElementById("resetSettingsButton");

resetSettingsButton.onclick = function () {
	gravitationalConst = initial_gravitationalConst;
	gravConstSlider.value = gravitationalConst;
	gravConstValue.innerHTML = gravConstSlider.value;
	sunMass = initial_sunMass;
	sunMassSlider.value = sunMass;
	sunMassValue.innerHTML = sunMassSlider.value;
	particles[0].mass = sunMass;
	sunRadius = initial_sunRadius;
	sunRadiusSlider.value = sunRadius;
	sunRadiusValue.innerHTML = sunRadiusSlider.value;
	particles[0].radius = sunRadius;
	xmin = initial_xmin;
	xminSlider.value = xmin;
	xminValue.innerHTML = xminSlider.value + "%";
	xmax = initial_xmax;
	xmaxSlider.value = xmax;
	xmaxValue.innerHTML = xmaxSlider.value + "%";
	ymin = initial_ymin;
	yminSlider.value = ymin;
	yminValue.innerHTML = yminSlider.value + "%";
	ymax = initial_ymax;
	ymaxSlider.value = ymax;
	ymaxValue.innerHTML = ymaxSlider.value + "%";
	vxMin = initial_vxMin;
	vxminSlider.value = vxMin;
	vxminValue.innerHTML = vxminSlider.value;
	vxMax = initial_vxMax;
	vxmaxSlider.value = vxMax;
	vxmaxValue.innerHTML = vxmaxSlider.value;
	vyMin = initial_vyMin;
	vyminSlider.value = vyMin;
	vyminValue.innerHTML = vyminSlider.value;
	vyMax = initial_vyMax;
	vymaxSlider.value = vyMax;
	vymaxValue.innerHTML = vymaxSlider.value;
	radiusMin = initial_radiusMin;
	radiusMinSlider.value = radiusMin;
	radiusMinValue.innerHTML = radiusMinSlider.value;
	radiusMax = initial_radiusMax;
	radiusMaxSlider.value = radiusMax;
	radiusMaxValue.innerHTML = radiusMaxSlider.value;
	massMin = initial_massMin;
	massMinSlider.value = massMin;
	massMinValue.innerHTML = massMinSlider.value;
	massMax = initial_massMax;
	massMaxSlider.value = massMax;
	massMaxValue.innerHTML = massMaxSlider.value;
};
// #endregion

// #region no walls radio button
var noWallsRadiobutton = document.getElementById("noWallsRadiobutton");
noWallsRadiobutton.checked = false;

noWallsRadiobutton.onclick = function () {
	if (this.checked) {
		wallBehavior = WallBehaviorEnum.none;
	}
};
// #endregion

// #region infinite walls radio button
var infiniteWallsRadiobutton = document.getElementById("infiniteWallsRadiobutton");
infiniteWallsRadiobutton.checked = false;

infiniteWallsRadiobutton.onclick = function () {
	if (this.checked) {
		wallBehavior = WallBehaviorEnum.infinite;
	}
};
// #endregion

// #region collision walls radio button
var collisionWallsRadiobutton = document.getElementById("collisionWallsRadiobutton");
collisionWallsRadiobutton.checked = true;

collisionWallsRadiobutton.onclick = function () {
	if (this.checked) {
		wallBehavior = WallBehaviorEnum.collision;
	}
};
// #endregion

// #region particle collision checkbox
var particleCollisionCheckbox = document.getElementById("particleCollisionCheckbox");
particleCollisionCheckbox.checked = particleCollisionsEnabled;

particleCollisionCheckbox.onclick = function () {
	particleCollisionsEnabled = this.checked;
};
// #endregion

// #region barnes-hut controls
var barnesHutCheckbox = document.getElementById("barnesHutCheckbox");
barnesHutCheckbox.checked = barnesHutEnabled;
barnesHutCheckbox.onclick = function () {
	barnesHutEnabled = this.checked;
};

var bhThetaSlider = document.getElementById("bhThetaSlider");
bhThetaSlider.value = bhTheta;
var bhThetaValue = document.getElementById("bhThetaValue");
bhThetaValue.innerHTML = bhTheta.toFixed(2);
bhThetaSlider.oninput = function () {
	bhTheta = parseFloat(this.value);
	bhThetaValue.innerHTML = bhTheta.toFixed(2);
};
// #endregion

// #region particle size slider
var particleSizeSlider = document.getElementById("particleSizeSlider");
var particleSizeValue = document.getElementById("particleSizeValue");

particleSizeSlider.oninput = function () {
	const newScale = parseInt(this.value) / 100;
	const ratio = newScale / particleSizeScale;
	particleSizeScale = newScale;
	particleSizeValue.innerHTML = this.value + '%';
	for (let i = 1; i < particles.length; i++) particles[i].radius *= ratio;
};
// #endregion

// #region particle count slider
var particleCountSlider = document.getElementById("particleCountSlider");
particleCountSlider.value = particleCount;
var particleCountValue = document.getElementById("particleCountValue");
particleCountValue.innerHTML = particleCountSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
particleCountSlider.oninput = function () {
	const targetCount = parseInt(this.value);
	particleCountValue.innerHTML = targetCount;

	// Removing: just pop
	while (particleCount > targetCount) {
		particles.pop();
		particleCount--;
	}

	if (particleCount >= targetCount) return;

	// Adding: build spatial hash from existing particles for O(1) overlap checks
	const cellSize = Math.max(radiusMax * particleSizeScale, sunRadius) * 2;
	const addSH = new SpatialHash(cellSize);
	for (let i = 0; i < particles.length; i++) {
		addSH.insert(i, particles[i].position.x, particles[i].position.y);
	}

	let overlappingCounter = 0;
	while (particleCount < targetCount) {
		const particle = Particle.GenerateRandomParticle(
			xmin, xmax, ymin, ymax,
			vxMin, vxMax, vyMin, vyMax,
			radiusMin, radiusMax, massMin, massMax
		);
		// check neighbors only — O(1) average instead of O(n)
		const neighbors = addSH.queryNeighbors(particle.position.x, particle.position.y);
		let twoParticlesOverlap = false;
		for (const k of neighbors) {
			if (particle.Overlaps(particles[k])) {
				twoParticlesOverlap = true;
				overlappingCounter++;
				break;
			}
		}
		if (overlappingCounter > 150000) {
			alert("The radius min/max are probably too large and/or the x/y ranges are too small.");
			break;
		}
		if (!twoParticlesOverlap) {
			if (gravitationalConst > 0) {
				const sunPos = particles[0].position;
				const dx = particle.position.x - sunPos.x;
				const dy = particle.position.y - sunPos.y;
				const r = Math.sqrt(dx * dx + dy * dy);
				if (r > 0) {
					const orbitalSpeed = Math.sqrt(gravitationalConst * sunMass / r);
					particle.velocity = new Vector2D(-dy / r * orbitalSpeed, dx / r * orbitalSpeed);
				}
			}
			if (particleSizeScale !== 1.0) particle.radius *= particleSizeScale;
			particles.push(particle);
			addSH.insert(particles.length - 1, particle.position.x, particle.position.y);
			particleCount++;
		}
	}
};
// #endregion

// #region timestep slider
var timeStepSlider = document.getElementById("timeStepSlider");
timeStepSlider.value = dt;
var timeStepValue = document.getElementById("timeStepValue");
timeStepValue.innerHTML = timeStepSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
timeStepSlider.oninput = function () {
	timeStepValue.innerHTML = this.value;
	dt = this.value;
};
// #endregion

// #region fps value
var fpsValue = document.getElementById("fpsValue");
// #endregion

// #region gravitational constant slider
var gravConstSlider = document.getElementById("gravConstSlider");
gravConstSlider.value = gravitationalConst;
var gravConstValue = document.getElementById("gravConstValue");
gravConstValue.innerHTML = gravConstSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
gravConstSlider.oninput = function () {
	gravConstValue.innerHTML = this.value;
	gravitationalConst = this.value;
};
// #endregion

// #region mass of sun slider
var sunMassSlider = document.getElementById("sunMassSlider");
sunMassSlider.value = sunMass;
var sunMassValue = document.getElementById("sunMassValue");
sunMassValue.innerHTML = sunMassSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
sunMassSlider.oninput = function () {
	sunMassValue.innerHTML = parseInt(this.value);
	sunMass = parseInt(this.value);
	particles[0].mass = parseInt(this.value);
};
// #endregion

// #region radius of sun slider
var sunRadiusSlider = document.getElementById("sunRadiusSlider");
sunRadiusSlider.value = sunRadius;
var sunRadiusValue = document.getElementById("sunRadiusValue");
sunRadiusValue.innerHTML = sunRadiusSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
sunRadiusSlider.oninput = function () {
	sunRadiusValue.innerHTML = parseInt(this.value);
	sunRadius = parseInt(this.value);
	particles[0].radius = parseInt(this.value);
};
// #endregion

// #region xmin slider
var xminSlider = document.getElementById("xminSlider");
xminSlider.value = xmin;
xminSlider.min = xSliderMin;
xminSlider.max = xSliderMax;
xminSlider.step = xSliderStep;
var xminValue = document.getElementById("xminValue");
xminValue.innerHTML = xminSlider.value + "%"; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
xminSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue < xSliderMax) {
		if (currentValue >= parseInt(xmaxSlider.value)) {
			let newVal = parseInt(currentValue + 1);
			xmaxSlider.value = newVal;
			xmaxValue.innerHTML = newVal + "%";
			xmax = parseInt(Math.floor(newVal / 100) * canvasWidth);
		}
		xminValue.innerHTML = currentValue + "%";
		xmin = Math.floor((currentValue / 100) * canvasWidth);
	}
};
// #endregion

// #region xmax slider
var xmaxSlider = document.getElementById("xmaxSlider");
xmaxSlider.value = xmax;
xmaxSlider.min = xSliderMin;
xmaxSlider.max = xSliderMax;
xmaxSlider.step = xSliderStep;
var xmaxValue = document.getElementById("xmaxValue");
xmaxValue.innerHTML = xmaxSlider.value + "%"; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
xmaxSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue > xSliderMin) {
		if (parseInt(xminSlider.value) >= currentValue) {
			let newVal = parseInt(currentValue - 1);
			xminSlider.value = newVal;
			xminValue.innerHTML = newVal + "%";
			xmin = parseInt(Math.floor(newVal / 100) * canvasWidth);
		}
		xmaxValue.innerHTML = currentValue + "%";
		xmax = Math.floor((currentValue / 100) * canvasWidth);
	}
};
// #endregion

// #region ymin slider
var yminSlider = document.getElementById("yminSlider");
yminSlider.value = ymin;
yminSlider.min = ySliderMin;
yminSlider.max = ySliderMax;
yminSlider.step = ySliderStep;
var yminValue = document.getElementById("yminValue");
yminValue.innerHTML = yminSlider.value + "%"; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
yminSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue < ySliderMax) {
		if (currentValue >= parseInt(ymaxSlider.value)) {
			let newVal = parseInt(currentValue + 1);
			ymaxSlider.value = newVal;
			ymaxValue.innerHTML = newVal + "%";
			ymax = parseInt(Math.floor(newVal / 100) * canvasHeight);
		}
		yminValue.innerHTML = currentValue + "%";
		ymin = Math.floor((currentValue / 100) * canvasHeight);
	}
};
// #endregion

// #region ymax slider
var ymaxSlider = document.getElementById("ymaxSlider");
ymaxSlider.value = ymax;
ymaxSlider.min = ySliderMin;
ymaxSlider.max = ySliderMax;
ymaxSlider.step = ySliderStep;
var ymaxValue = document.getElementById("ymaxValue");
ymaxValue.innerHTML = ymaxSlider.value + "%"; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
ymaxSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue > xSliderMin) {
		if (parseInt(yminSlider.value) >= currentValue) {
			let newVal = parseInt(currentValue - 1);
			yminSlider.value = newVal;
			yminValue.innerHTML = newVal + "%";
			ymin = parseInt(Math.floor(newVal / 100) * canvasHeight);
		}
		ymaxValue.innerHTML = currentValue + "%";
		ymax = Math.floor((currentValue / 100) * canvasHeight);
	}
};
// #endregion

// #region vx-min slider
var vxminSlider = document.getElementById("vxminSlider");
vxminSlider.value = vxMin;
vxminSlider.min = vxSliderMin;
vxminSlider.max = vxSliderMax;
vxminSlider.step = vxSliderStep;
var vxminValue = document.getElementById("vxminValue");
vxminValue.innerHTML = vxminSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
vxminSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue < vxSliderMax) {
		if (currentValue >= parseInt(vxmaxSlider.value)) {
			let newVal = parseInt(currentValue + 1);
			vxmaxSlider.value = newVal;
			vxmaxValue.innerHTML = newVal;
			vxMax = newVal;
		}
		vxminValue.innerHTML = currentValue;
		vxMin = currentValue;
	}
};
// #endregion

// #region vx-max slider
var vxmaxSlider = document.getElementById("vxmaxSlider");
vxmaxSlider.value = vxMax;
vxmaxSlider.min = vxSliderMin;
vxmaxSlider.max = vxSliderMax;
vxmaxSlider.step = vxSliderStep;
var vxmaxValue = document.getElementById("vxmaxValue");
vxmaxValue.innerHTML = vxmaxSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
vxmaxSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue > vxSliderMin) {
		if (parseInt(vxminSlider.value) >= currentValue) {
			let newVal = parseInt(currentValue - 1);
			vxminSlider.value = newVal;
			vxminValue.innerHTML = newVal;
			vxMin = newVal;
		}
		vxmaxValue.innerHTML = this.value;
		vxMax = this.value;
	}
};
// #endregion

// #region vy-min slider
var vyminSlider = document.getElementById("vyminSlider");
vyminSlider.value = vyMin;
vyminSlider.min = vySliderMin;
vyminSlider.max = vySliderMax;
vyminSlider.step = vySliderStep;
var vyminValue = document.getElementById("vyminValue");
vyminValue.innerHTML = vyminSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
vyminSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue < vySliderMax) {
		if (currentValue >= parseInt(vymaxSlider.value)) {
			let newVal = parseInt(currentValue + 1);
			vymaxSlider.value = newVal;
			vymaxValue.innerHTML = newVal;
			vyMax = newVal;
		}
		vyminValue.innerHTML = currentValue;
		vyMin = currentValue;
	}
};
// #endregion

// #region vy-max slider
var vymaxSlider = document.getElementById("vymaxSlider");
vymaxSlider.value = vyMax;
vymaxSlider.min = vySliderMin;
vymaxSlider.max = vySliderMax;
vymaxSlider.step = vySliderStep;
var vymaxValue = document.getElementById("vymaxValue");
vymaxValue.innerHTML = vymaxSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
vymaxSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue > vySliderMin) {
		if (parseInt(vyminSlider.value) >= currentValue) {
			let newVal = parseInt(currentValue - 1);
			vyminSlider.value = newVal;
			vyminValue.innerHTML = newVal;
			vyMin = newVal;
		}
		vymaxValue.innerHTML = this.value;
		vyMax = this.value;
	}
};
// #endregion

// #region radius-min slider
var radiusMinSlider = document.getElementById("radiusMinSlider");
radiusMinSlider.value = radiusMin;
radiusMinSlider.min = radiusSliderMin;
radiusMinSlider.max = radiusSliderMax;
radiusMinSlider.step = radiusSliderStep;
var radiusMinValue = document.getElementById("radiusMinValue");
radiusMinValue.innerHTML = radiusMinSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
radiusMinSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue < radiusSliderMax) {
		if (currentValue >= parseInt(radiusMaxSlider.value)) {
			let newVal = parseInt(currentValue + 1);
			radiusMaxSlider.value = newVal;
			radiusMaxValue.innerHTML = newVal;
			radiusMax = newVal;
		}
		radiusMinValue.innerHTML = currentValue;
		radiusMin = currentValue;
	}
};
// #endregion

// #region radius-max slider
var radiusMaxSlider = document.getElementById("radiusMaxSlider");
radiusMaxSlider.value = radiusMax;
radiusMaxSlider.min = radiusSliderMin;
radiusMaxSlider.max = radiusSliderMax;
radiusMaxSlider.step = radiusSliderStep;
var radiusMaxValue = document.getElementById("radiusMaxValue");
radiusMaxValue.innerHTML = radiusMaxSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
radiusMaxSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue > radiusSliderMin) {
		if (parseInt(radiusMinSlider.value) >= currentValue) {
			let newVal = parseInt(currentValue - 1);
			radiusMinSlider.value = newVal;
			radiusMinValue.innerHTML = newVal;
			radiusMin = newVal;
		}
		radiusMaxValue.innerHTML = currentValue;
		radiusMax = currentValue;
	}
};
// #endregion

// #region mass-min slider
var massMinSlider = document.getElementById("massMinSlider");
massMinSlider.value = massMin;
massMinSlider.min = massSliderMin;
massMinSlider.max = massSliderMax;
massMinSlider.step = massSliderStep;
var massMinValue = document.getElementById("massMinValue");
massMinValue.innerHTML = massMinSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
massMinSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue < massSliderMax) {
		if (currentValue >= parseInt(massMaxSlider.value)) {
			let newVal = parseInt(currentValue + 1);
			massMaxSlider.value = newVal;
			massMaxValue.innerHTML = newVal;
			massMax = newVal;
		}
		massMinValue.innerHTML = currentValue;
		massMin = currentValue;
	}
};
// #endregion

// #region mass-max slider
var massMaxSlider = document.getElementById("massMaxSlider");
massMaxSlider.value = massMax;
massMaxSlider.min = massSliderMin;
massMaxSlider.max = massSliderMax;
massMaxSlider.step = massSliderStep;
var massMaxValue = document.getElementById("massMaxValue");
massMaxValue.innerHTML = massMaxSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
massMaxSlider.oninput = function () {
	let currentValue = parseInt(this.value);
	if (currentValue > massSliderMin) {
		if (parseInt(massMinSlider.value) >= currentValue) {
			let newVal = parseInt(currentValue - 1);
			massMinSlider.value = newVal;
			massMinValue.innerHTML = newVal;
			massMin = newVal;
		}
		massMaxValue.innerHTML = currentValue;
		massMax = currentValue;
	}
};
// #endregion

// #region Handle mouse events
let pointerOnCanvas = false;
let isLeftMouseDown = false; // button 0
let isMiddleMouseDown = false; // button 1
let isRightMouseDown = false; // button 2
let mouse = new Vector2D(0, 0);
let dragStart = null;

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
	particles[0].position.x = touchobj.clientX;
	particles[0].position.y = touchobj.clientY;
	event.preventDefault();
});

foregroundCanvas.addEventListener("contextmenu", function (event) {
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
		case 0: {
			isLeftMouseDown = true;
			dragStart = { x: mouse.x, y: mouse.y };
			break;
		}
		case 1: {
			isMiddleMouseDown = true;
			break;
		}
		case 2: {
			isRightMouseDown = true;
			break;
		}
	}
});

foregroundCanvas.addEventListener("mouseup", function (event) {
	switch (event.button) {
		case 0: {
			isLeftMouseDown = false;
			if (dragStart) {
				const dx = mouse.x - dragStart.x;
				const dy = mouse.y - dragStart.y;
				if (Math.sqrt(dx * dx + dy * dy) > 5) {
					const r = Math.max(radiusMin, Math.min(radiusMax, (radiusMin + radiusMax) / 2)) * particleSizeScale;
					const m = Math.max(massMin, Math.min(massMax, (massMin + massMax) / 2));
					const newParticle = new Particle(
						new Vector2D(dragStart.x, dragStart.y),
						new Vector2D(dx, dy),
						new Vector2D(0, 0),
						r, m
					);
					particles.push(newParticle);
					particleCount++;
					particleCountSlider.value = particleCount;
					particleCountValue.innerHTML = particleCount;
				}
				dragStart = null;
			}
			break;
		}
		case 1: {
			isMiddleMouseDown = false;
			break;
		}
		case 2: {
			isRightMouseDown = false;
			break;
		}
	}
});

foregroundCanvas.addEventListener("mousemove", function (event) {
	mouse = helpers.GetMousePos(foregroundCanvas, event);
});
//#endregion
// #endregion

function resolveCollision(i, k) {
	const pi = particles[i], pk = particles[k];
	const dx = pi.position.x - pk.position.x;
	const dy = pi.position.y - pk.position.y;
	let dist = Math.sqrt(dx * dx + dy * dy);
	if (dist < 0.001) dist = 0.001;
	const overlap = pi.radius + pk.radius - dist;
	if (overlap <= 0) return;
	const nx = dx / dist, ny = dy / dist;
	const totalMass = pi.mass + pk.mass;
	const fi = pk.mass / totalMass, fk = pi.mass / totalMass;
	pi.position.x += fi * overlap * nx; pi.position.y += fi * overlap * ny;
	pk.position.x -= fk * overlap * nx; pk.position.y -= fk * overlap * ny;
	const v1x = pi.velocity.x, v1y = pi.velocity.y;
	const v2x = pk.velocity.x, v2y = pk.velocity.y;
	const approach = (v1x - v2x) * nx + (v1y - v2y) * ny;
	if (approach < 0) {
		const m1 = (2 * pk.mass) / totalMass, m2 = (2 * pi.mass) / totalMass;
		pi.velocity.x = v1x - m1 * approach * nx; pi.velocity.y = v1y - m1 * approach * ny;
		pk.velocity.x = v2x + m2 * approach * nx; pk.velocity.y = v2y + m2 * approach * ny;
		if (collisionSparksEnabled && Math.abs(approach) > 30) {
			const mx = (pi.position.x + pk.position.x) * 0.5;
			const my = (pi.position.y + pk.position.y) * 0.5;
			const intensity = Math.min(1, Math.abs(approach) / 150);
			const flashR = (pi.radius + pk.radius) * (1 + intensity * 2);
			const savedOp = bgCtx.globalCompositeOperation;
			bgCtx.globalCompositeOperation = 'lighter';
			const grad = bgCtx.createRadialGradient(mx, my, 0, mx, my, flashR);
			grad.addColorStop(0, `rgba(255,255,200,${intensity})`);
			grad.addColorStop(1, 'rgba(255,140,0,0)');
			bgCtx.fillStyle = grad;
			bgCtx.beginPath();
			bgCtx.arc(mx, my, flashR, 0, Math.PI * 2);
			bgCtx.fill();
			bgCtx.globalCompositeOperation = savedOp;
		}
	}
}

function drawSunCorona(particle) {
	const x = particle.position.x, y = particle.position.y;
	const r = particle.radius;
	const pulse = 1 + 0.12 * Math.sin(Date.now() * 0.003);
	const outerR = r * 2.5 * pulse;
	const grad = fgCtx.createRadialGradient(x, y, r * 0.25, x, y, outerR);
	grad.addColorStop(0,    'rgba(255,255,220,1)');
	grad.addColorStop(0.18, sunColor.RGBA);
	grad.addColorStop(0.5,  'rgba(255,100,0,0.45)');
	grad.addColorStop(1,    'rgba(255,40,0,0)');
	fgCtx.beginPath();
	fgCtx.arc(x, y, outerR, 0, Math.PI * 2);
	fgCtx.fillStyle = grad;
	fgCtx.fill();
}

function supernova() {
	const sun = particles[0];
	const IMPULSE = 500;
	for (let i = 1; i < particles.length; i++) {
		const dx = particles[i].position.x - sun.position.x;
		const dy = particles[i].position.y - sun.position.y;
		const r = Math.sqrt(dx * dx + dy * dy) || 1;
		particles[i].velocity.x += (dx / r) * IMPULSE;
		particles[i].velocity.y += (dy / r) * IMPULSE;
	}
}

function spawnDisk(cx, cy, bulkVx, bulkVy, n, localSunMass) {
	const diskR = Math.min(canvasWidth, canvasHeight) * 0.17;
	for (let i = 0; i < n; i++) {
		const angle = Math.random() * Math.PI * 2;
		const r = (0.3 + Math.random() * 0.7) * diskR;
		const x = cx + Math.cos(angle) * r;
		const y = cy + Math.sin(angle) * r;
		const orbV = Math.sqrt(+gravitationalConst * localSunMass / r);
		const vx = bulkVx - Math.sin(angle) * orbV;
		const vy = bulkVy + Math.cos(angle) * orbV;
		particles.push(new Particle(
			new Vector2D(x, y), new Vector2D(vx, vy), new Vector2D(0, 0),
			helpers.GetRandomIntFromRange(radiusMin, radiusMax),
			helpers.GetRandomIntFromRange(massMin, massMax)
		));
	}
}

function syncPresetUI() {
	gravConstSlider.value = gravitationalConst;
	gravConstValue.innerHTML = gravitationalConst;
	sunMassSlider.value = sunMass;
	sunMassValue.innerHTML = sunMass;
	particleCount = particles.length;
	particleCountSlider.value = particleCount;
	particleCountValue.innerHTML = particleCount;
	then = Date.now();
}

function applyPreset(name) {
	switch (name) {
		case 'orbital': {
			gravitationalConst = 50;
			sunMass = 10000;
			sunRadius = 15;
			particles[0].mass = sunMass;
			particles[0].radius = sunRadius;
			wallBehavior = WallBehaviorEnum.none;
			noWallsRadiobutton.checked = true;
			resetCanvas = true;
			syncPresetUI();
			break;
		}
		case 'ring': {
			gravitationalConst = 50;
			sunMass = 10000;
			particles = [];
			particles.push(new Particle(
				new Vector2D(canvasWidth / 2, canvasHeight / 2),
				new Vector2D(0, 0), new Vector2D(0, 0), 15, sunMass
			));
			const ringR = Math.min(canvasWidth, canvasHeight) * 0.35;
			const ringN = Math.max(particleCount - 1, 30);
			for (let i = 0; i < ringN; i++) {
				const angle = (i / ringN) * Math.PI * 2;
				const orbV = Math.sqrt(+gravitationalConst * sunMass / ringR);
				particles.push(new Particle(
					new Vector2D(canvasWidth / 2 + Math.cos(angle) * ringR, canvasHeight / 2 + Math.sin(angle) * ringR),
					new Vector2D(-Math.sin(angle) * orbV, Math.cos(angle) * orbV),
					new Vector2D(0, 0), 3, 1.5
				));
			}
			wallBehavior = WallBehaviorEnum.none;
			noWallsRadiobutton.checked = true;
			computeInitialAccelerations();
			syncPresetUI();
			break;
		}
		case 'galaxy-collision': {
			gravitationalConst = 50;
			const gSunMass = 8000, gSunR = 18;
			particles = [];
			const cx1 = canvasWidth * 0.27, cy1 = canvasHeight * 0.5;
			const cx2 = canvasWidth * 0.73, cy2 = canvasHeight * 0.5;
			const cv = 70;
			particles.push(new Particle(new Vector2D(cx1, cy1), new Vector2D(cv,  12), new Vector2D(0, 0), gSunR, gSunMass));
			particles.push(new Particle(new Vector2D(cx2, cy2), new Vector2D(-cv, -12), new Vector2D(0, 0), gSunR, gSunMass));
			const nEach = Math.floor(Math.max(particleCount, 60) / 2);
			spawnDisk(cx1, cy1,  cv,  12, nEach, gSunMass);
			spawnDisk(cx2, cy2, -cv, -12, nEach, gSunMass);
			wallBehavior = WallBehaviorEnum.none;
			noWallsRadiobutton.checked = true;
			computeInitialAccelerations();
			syncPresetUI();
			break;
		}
		case 'collapse': {
			gravitationalConst = 80;
			sunMass = 500;
			particles = [];
			particles.push(new Particle(
				new Vector2D(canvasWidth / 2, canvasHeight / 2),
				new Vector2D(0, 0), new Vector2D(0, 0), 10, sunMass
			));
			const spread = Math.min(canvasWidth, canvasHeight) * 0.42;
			const colN = Math.max(particleCount - 1, 80);
			for (let i = 0; i < colN; i++) {
				const angle = Math.random() * Math.PI * 2;
				const r = Math.random() * spread;
				particles.push(new Particle(
					new Vector2D(canvasWidth / 2 + Math.cos(angle) * r, canvasHeight / 2 + Math.sin(angle) * r),
					new Vector2D(0, 0), new Vector2D(0, 0), 2, 1
				));
			}
			wallBehavior = WallBehaviorEnum.collision;
			collisionWallsRadiobutton.checked = true;
			computeInitialAccelerations();
			syncPresetUI();
			break;
		}
	}
}

function startAnimating(fps) {
	fpsInterval = 1000 / fps;
	then = Date.now();
	draw();
}

function draw() {
	// stop
	if (stop) {
		return;
	}

	// request another frame
	window.requestAnimationFrame(draw);

	if (resetCanvas) {
		GenerateRandomizedParticles(particleCount);
		then = Date.now();
		resetCanvas = false;
	}

	// Leapfrog velocity Verlet: half-kick → drift → recompute accel → half-kick
	// 1 force evaluation per step (vs RK4's 4), symplectic → conserves energy for orbits
	for (const p of particles) {
		p.velocity.x += p.acceleration.x * (dt * 0.5);
		p.velocity.y += p.acceleration.y * (dt * 0.5);
	}
	for (const p of particles) {
		p.position.x += p.velocity.x * dt;
		p.position.y += p.velocity.y * dt;
	}

	// Collision + wall BEFORE force recomputation — prevents huge forces from overlapping pairs
	if (particleCollisionsEnabled) {
		// Phase 1: particle-particle — cell size based on particle radii only (NOT sun radius).
		// Keeps cells small so clusters near the sun don't collapse into one giant cell → O(n²).
		const ppCellSize = Math.max(radiusMax * particleSizeScale * 2, 1);
		if (!_sh || _shCellSize !== ppCellSize) { _sh = new SpatialHash(ppCellSize); _shCellSize = ppCellSize; }
		else _sh.clear();
		for (let i = 1; i < particles.length; i++) {
			_sh.insert(i, particles[i].position.x, particles[i].position.y);
		}
		for (let i = 1; i < particles.length; i++) {
			const neighbors = _sh.queryNeighbors(particles[i].position.x, particles[i].position.y);
			for (const k of neighbors) {
				if (k <= i) continue;
				if (particles[i].Overlaps(particles[k])) resolveCollision(i, k);
			}
		}
		// Phase 2: particle-sun — direct O(n), sun radius is large so spatial hash can't help here.
		for (let i = 1; i < particles.length; i++) {
			if (particles[i].Overlaps(particles[0])) resolveCollision(0, i);
		}
	}

	// Wall behavior
	switch (wallBehavior) {
		case WallBehaviorEnum.none: {
			for(let i = particles.length - 1; i >= 0; i--){
				if(particles[i].position.x < -1 * particles[i].radius || particles[i].position.x > canvasWidth + particles[i].radius
					|| particles[i].position.y < -1 * particles[i].radius || particles[i].position.y > canvasHeight + particles[i].radius){
					helpers.RemoveItemAtIndex(particles, i);
					particleCount--;
					particleCountSlider.value = particleCount;
					particleCountValue.innerHTML = particleCount;
				}
			}
			break;
		}
		case WallBehaviorEnum.infinite: {
			for (let i = 0; i < particles.length; i++) {
				const particle = particles[i];
				if (particle.position.x < 0) {
					particle.position.x = canvasWidth;
				}
				if (particle.position.x > canvasWidth) {
					particle.position.x = 0;
				}
				if (particle.position.y < 0) {
					particle.position.y = canvasHeight;
				}
				if (particle.position.y > canvasHeight) {
					particle.position.y = 0;
				}
			}
			break;
		}
		case WallBehaviorEnum.collision: {
			for (let i = 0; i < particles.length; i++) {
				const particle = particles[i];
				if (particle.position.x <= particle.radius) {
					particle.position.x = particle.radius;
					particle.velocity.x *= -1 * wallFrictionFactor;
				} else if (particle.position.x >= canvasWidth - particle.radius) {
					particle.position.x = canvasWidth - particle.radius;
					particle.velocity.x *= -1 * wallFrictionFactor;
				}

				if (particle.position.y <= particle.radius) {
					particle.position.y = particle.radius;
					particle.velocity.y *= -1 * wallFrictionFactor;
				} else if (particle.position.y >= canvasHeight - particle.radius) {
					particle.position.y = canvasHeight - particle.radius;
					particle.velocity.y *= -1 * wallFrictionFactor;
				}
			}
			break;
		}
	}

	// Force recomputation at corrected (post-collision, post-wall) positions
	if (barnesHutEnabled && particles.length > 0) {
		let minX = particles[0].position.x, maxX = minX;
		let minY = particles[0].position.y, maxY = minY;
		for (const p of particles) {
			if (p.position.x < minX) minX = p.position.x;
			else if (p.position.x > maxX) maxX = p.position.x;
			if (p.position.y < minY) minY = p.position.y;
			else if (p.position.y > maxY) maxY = p.position.y;
		}
		const margin = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 100);
		bhTree.theta = bhTheta;
		bhTree.reset(minX - margin, minY - margin, maxX - minX + 2 * margin, maxY - minY + 2 * margin);
		for (const p of particles) bhTree.insert(p);
	}

	if (accelBuf.length < particles.length * 2) accelBuf = new Float64Array(particles.length * 2);
	if (barnesHutEnabled && particles.length > 0) {
		for (let i = 0; i < particles.length; i++) {
			const p = particles[i];
			bhTree.computeAccelAt(p.position.x, p.position.y, p, gravitationalConst);
			accelBuf[2 * i] = bhTree._ax; accelBuf[2 * i + 1] = bhTree._ay;
		}
	} else {
		RungeKutta.computeAllAccelerationsInto(particles, gravitationalConst, accelBuf);
	}

	for (let i = 0; i < particles.length; i++) {
		const ax = accelBuf[2 * i], ay = accelBuf[2 * i + 1];
		particles[i].velocity.x += ax * (dt * 0.5);
		particles[i].velocity.y += ay * (dt * 0.5);
		particles[i].acceleration.Update(ax, ay);
	}

	// force brush
	if (pointerOnCanvas && (forceBrushAttract || forceBrushRepel)) {
		const sign = forceBrushAttract ? 1 : -1;
		const dtNum = +dt;
		for (let i = 1; i < particles.length; i++) {
			const dx = mouse.x - particles[i].position.x;
			const dy = mouse.y - particles[i].position.y;
			const r2 = dx * dx + dy * dy + BRUSH_SOFT2;
			const r  = Math.sqrt(r2);
			const f  = sign * BRUSH_STRENGTH * dtNum / (r2 * r);
			particles[i].velocity.x += f * dx;
			particles[i].velocity.y += f * dy;
		}
	}

	// calc elapsed time since last loop
	now = Date.now();
	elapsed = now - then;

	// if enough time has elapsed, draw the next frame
	if (elapsed > fpsInterval) {
		// Get ready for next frame by setting then=now, but...
		// Also, adjust for fpsInterval not being multiple of 16.67
		then = now - (elapsed % fpsInterval);

		fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);

		// fade bg canvas toward background color, then stamp current positions as trail dots
		bgCtx.fillStyle = fadeColor;
		bgCtx.fillRect(0, 0, canvasWidth, canvasHeight);
		const trailLUT = gravitationalConst >= 0 ? attractionLUT : repulsionLUT;
		for (let pi = 0; pi < particles.length; pi++) {
			const particle = particles[pi];
			if (particle.isHeavyParticle) continue;
			const vx = particle.velocity.x, vy = particle.velocity.y;
			const speedPct = Math.min(1, Math.sqrt(vx * vx + vy * vy) / MAX_TRAIL_SPEED);
			bgCtx.fillStyle = trailLUT[(speedPct * (LUT_SIZE - 1)) | 0];
			bgCtx.fillRect(particle.position.x - 1, particle.position.y - 1, 2, 2);
		}

		// draw particles — glow pass (additive blend via lighter composite)
		const drawLUT    = gravitationalConst >= 0 ? attractionLUT    : repulsionLUT;
		const drawSprites = gravitationalConst >= 0 ? attractionSprites : repulsionSprites;
		if (drawSprites) {
			fgCtx.globalCompositeOperation = 'lighter';
			for (let pi = 1; pi < particles.length; pi++) {
				const particle = particles[pi];
				const accLen = particle.acceleration.length;
				const slot = Math.min(LUT_SIZE - 1, accLen > 100 ? LUT_SIZE - 1 : (accLen / 100 * (LUT_SIZE - 1)) | 0);
				const gr = particle.radius * 3;
				fgCtx.drawImage(drawSprites[slot], particle.position.x - gr, particle.position.y - gr, gr * 2, gr * 2);
			}
			fgCtx.globalCompositeOperation = 'source-over';
		}

		// hard core pass
		for (let pi = 1; pi < particles.length; pi++) {
			const particle = particles[pi];
			const accLen = particle.acceleration.length;
			const percentage = accLen > 100 ? 1 : accLen / 100;
			const rgba = drawLUT[(percentage * (LUT_SIZE - 1)) | 0];
			particle.Draw(fgCtx, rgba, rgba);
		}

		// sun(s) — radial gradient corona
		for (let pi = 0; pi < particles.length; pi++) {
			if (particles[pi].isHeavyParticle) {
				const particle = particles[pi];
				if (pi === 0) {
					const dist = Math.floor(helpers.Distance(particle.position.x, particle.position.y, mouse.x, mouse.y));
					if (dist < 50 && particle.radius < sunRadius * 1.2) particle.radius += 0.2;
					else if (particle.radius > sunRadius) particle.radius -= 0.2;
				}
				drawSunCorona(particle);
			}
		}

		if (isRightMouseDown) {
			particles[0].lastMousePos.x += (mouse.x - particles[0].lastMousePos.x) * 0.05;
			particles[0].lastMousePos.y += (mouse.y - particles[0].lastMousePos.y) * 0.05;
			particles[0].position.x = particles[0].lastMousePos.x;
			particles[0].position.y = particles[0].lastMousePos.y;
		}

		if (isLeftMouseDown && dragStart) {
			const dx = mouse.x - dragStart.x;
			const dy = mouse.y - dragStart.y;
			fgCtx.save();
			fgCtx.strokeStyle = 'rgba(255,255,255,0.8)';
			fgCtx.fillStyle = 'rgba(255,255,255,0.8)';
			fgCtx.lineWidth = 2;
			fgCtx.beginPath();
			fgCtx.arc(dragStart.x, dragStart.y, 4, 0, Math.PI * 2);
			fgCtx.fill();
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > 5) {
				const angle = Math.atan2(dy, dx);
				const headLen = 10;
				fgCtx.beginPath();
				fgCtx.moveTo(dragStart.x, dragStart.y);
				fgCtx.lineTo(mouse.x, mouse.y);
				fgCtx.stroke();
				fgCtx.beginPath();
				fgCtx.moveTo(mouse.x, mouse.y);
				fgCtx.lineTo(mouse.x - headLen * Math.cos(angle - Math.PI / 6), mouse.y - headLen * Math.sin(angle - Math.PI / 6));
				fgCtx.lineTo(mouse.x - headLen * Math.cos(angle + Math.PI / 6), mouse.y - headLen * Math.sin(angle + Math.PI / 6));
				fgCtx.closePath();
				fgCtx.fill();

				// trajectory preview — forward simulate under sun gravity
				const simDt2 = parseFloat(dt) * 2;
				let sx = dragStart.x, sy = dragStart.y;
				let svx = dx, svy = dy;
				fgCtx.fillStyle = 'rgba(255,255,255,0.22)';
				for (let step = 0; step < 150; step++) {
					const sun = particles[0];
					const gdx = sun.position.x - sx;
					const gdy = sun.position.y - sy;
					const gr2 = gdx * gdx + gdy * gdy + 1;
					const gf  = +gravitationalConst * sun.mass / (gr2 * Math.sqrt(gr2));
					svx += gdx * gf * simDt2;
					svy += gdy * gf * simDt2;
					sx  += svx * simDt2;
					sy  += svy * simDt2;
					if (step % 3 === 0) fgCtx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
				}
			}
			fgCtx.restore();
		}

		// force brush indicator
		if (pointerOnCanvas && (forceBrushAttract || forceBrushRepel)) {
			fgCtx.save();
			fgCtx.strokeStyle = forceBrushAttract ? 'rgba(255,200,80,0.7)' : 'rgba(80,200,255,0.7)';
			fgCtx.fillStyle   = fgCtx.strokeStyle;
			fgCtx.lineWidth   = 2;
			fgCtx.setLineDash([5, 5]);
			fgCtx.beginPath();
			fgCtx.arc(mouse.x, mouse.y, 45, 0, Math.PI * 2);
			fgCtx.stroke();
			fgCtx.setLineDash([]);
			fgCtx.font = '12px system-ui';
			fgCtx.fillText(forceBrushAttract ? '▼ attract' : '▲ repel', mouse.x + 50, mouse.y + 4);
			fgCtx.restore();
		}

		// TESTING...Report #seconds since start and achieved fps.
		if (fpsLastDrawTime > 0) {
			fpsBuffer[fpsBufferIdx] = now - fpsLastDrawTime;
			fpsBufferIdx = (fpsBufferIdx + 1) % FPS_BUFFER_SIZE;
			if (fpsBufferCount < FPS_BUFFER_SIZE) fpsBufferCount++;
			let sum = 0;
			for (let i = 0; i < fpsBufferCount; i++) sum += fpsBuffer[i];
			fpsValue.innerHTML = Math.round(1000 / (sum / fpsBufferCount)) + " fps";
		}
		fpsLastDrawTime = now;
	}
}

// #region new feature wiring
document.getElementById('supernovaButton').onclick = supernova;

var collisionSparksCheckbox = document.getElementById('collisionSparksCheckbox');
collisionSparksCheckbox.checked = collisionSparksEnabled;
collisionSparksCheckbox.onclick = function () { collisionSparksEnabled = this.checked; };

document.getElementById('presetOrbital').onclick  = () => applyPreset('orbital');
document.getElementById('presetRing').onclick     = () => applyPreset('ring');
document.getElementById('presetGalaxy').onclick   = () => applyPreset('galaxy-collision');
document.getElementById('presetCollapse').onclick = () => applyPreset('collapse');

document.addEventListener('keydown', (e) => {
	if (e.key === 'g' || e.key === 'G') forceBrushAttract = true;
	if (e.key === 'h' || e.key === 'H') forceBrushRepel   = true;
});
document.addEventListener('keyup', (e) => {
	if (e.key === 'g' || e.key === 'G') forceBrushAttract = false;
	if (e.key === 'h' || e.key === 'H') forceBrushRepel   = false;
});
// #endregion

startAnimating(60);
