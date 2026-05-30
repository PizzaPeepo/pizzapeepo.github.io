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
let barnesHutEnabled = false;
let bhTheta = 0.5;
const bhTree = new BarnesHutTree(bhTheta);
let accelBuf = new Float64Array(6000 * 2);
let _sh = null, _shCellSize = 0;

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
	computeInitialAccelerations();
}

// Computes and stores gravitational acceleration on every particle (direct O(n²)).
// Called on reset and after G changes — leapfrog needs correct stored accelerations.
function computeInitialAccelerations() {
	if (accelBuf.length < particles.length * 2) accelBuf = new Float64Array(particles.length * 2);
	RungeKutta.computeAllAccelerationsInto(particles, gravitationalConst, accelBuf);
	for (let i = 0; i < particles.length; i++) {
		particles[i].acceleration.x = accelBuf[2 * i];
		particles[i].acceleration.y = accelBuf[2 * i + 1];
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

function applyThemeColors(isLight) {
	const t = isLight ? themeColors.light : themeColors.dark;
	backgroundCanvas.style.background = t.bg;
	sunColor        = helpers.HexToRGBA(t.sun);
	attractionColors = t.attraction.map(c => helpers.HexToRGBA(c));
	repullsionColors = t.repulsion.map(c => helpers.HexToRGBA(c));
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

// #region particle count slider
var particleCountSlider = document.getElementById("particleCountSlider");
particleCountSlider.value = particleCount;
var particleCountValue = document.getElementById("particleCountValue");
particleCountValue.innerHTML = particleCountSlider.value; // Display the default slider value

// Update the current slider value (each time you drag the slider handle)
particleCountSlider.oninput = function () {
	particleCountValue.innerHTML = this.value;
	let overlappingCounter = 0;
	while (particleCount != this.value) {
		if (particleCount > this.value) {
			particles.pop();
			particleCount--;
		} else if (particleCount < this.value) {
			let particle = Particle.GenerateRandomParticle(
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
			// check if no other particle overlap with the to be added particle
			let twoParticlesOverlap = false;
			for (let j = 0; j < particles.length; j++) {
				if (particle.Overlaps(particles[j])) {
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
				particles.push(particle);
				//console.log(particle.mass);
				particleCount++;
			}
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
					const r = Math.max(radiusMin, Math.min(radiusMax, (radiusMin + radiusMax) / 2));
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
		const cellSize = Math.max(radiusMax, sunRadius) * 2;
		if (!_sh || _shCellSize !== cellSize) { _sh = new SpatialHash(cellSize); _shCellSize = cellSize; }
		else _sh.clear();
		for (let i = 0; i < particles.length; i++) {
			_sh.insert(i, particles[i].position.x, particles[i].position.y);
		}
		for (let i = 0; i < particles.length; i++) {
			const neighbors = _sh.queryNeighbors(particles[i].position.x, particles[i].position.y);
			for (const k of neighbors) {
				if (k <= i) continue;
				if (!particles[i].Overlaps(particles[k])) continue;
				let distance = particles[i].position.DistanceTo(particles[k].position);
				if (distance < 0.001) distance = 0.001;
				const overlap = particles[i].radius + particles[k].radius - distance;
				const nx = (particles[i].position.x - particles[k].position.x) / distance;
				const ny = (particles[i].position.y - particles[k].position.y) / distance;
				const totalMass = particles[i].mass + particles[k].mass;
				const f_i = particles[k].mass / totalMass;
				const f_k = particles[i].mass / totalMass;
				particles[i].position.x += f_i * overlap * nx;
				particles[i].position.y += f_i * overlap * ny;
				particles[k].position.x -= f_k * overlap * nx;
				particles[k].position.y -= f_k * overlap * ny;
				const v1x = particles[i].velocity.x;
				const v1y = particles[i].velocity.y;
				const v2x = particles[k].velocity.x;
				const v2y = particles[k].velocity.y;
				const approach = (v1x - v2x) * nx + (v1y - v2y) * ny;
				if (approach < 0) {
					const massFac1 = (2 * particles[k].mass) / totalMass;
					const massFac2 = (2 * particles[i].mass) / totalMass;
					particles[i].velocity.x = v1x - massFac1 * approach * nx;
					particles[i].velocity.y = v1y - massFac1 * approach * ny;
					particles[k].velocity.x = v2x + massFac2 * approach * nx;
					particles[k].velocity.y = v2y + massFac2 * approach * ny;
				}
			}
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
			particles.forEach((particle) => {
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
			});
			break;
		}
		case WallBehaviorEnum.collision: {
			particles.forEach((particle) => {
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
			});
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
			const [ax, ay] = bhTree.computeAccelAt(p.position.x, p.position.y, p, gravitationalConst);
			accelBuf[2 * i] = ax; accelBuf[2 * i + 1] = ay;
		}
	} else {
		RungeKutta.computeAllAccelerationsInto(particles, gravitationalConst, accelBuf);
	}

	for (let i = 0; i < particles.length; i++) {
		const ax = accelBuf[2 * i], ay = accelBuf[2 * i + 1];
		particles[i].velocity.x += ax * (dt * 0.5);
		particles[i].velocity.y += ay * (dt * 0.5);
		particles[i].acceleration.x = ax;
		particles[i].acceleration.y = ay;
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
		particles.forEach((particle) => {
			if (!particle.isHeavyParticle) {
				const vx = particle.velocity.x, vy = particle.velocity.y;
				const speedPct = Math.min(1, Math.sqrt(vx * vx + vy * vy) / MAX_TRAIL_SPEED);
				const clr = gravitationalConst >= 0
					? helpers.ColorRGBA.LinearInterpolateColors(attractionColors, speedPct)
					: helpers.ColorRGBA.LinearInterpolateColors(repullsionColors, speedPct);
				bgCtx.fillStyle = clr.RGBA;
				bgCtx.fillRect(particle.position.x - 1, particle.position.y - 1, 2, 2);
			}
		});

		// draw particles
		particles.forEach((particle) => {
			if (!particle.isHeavyParticle) {
				let clr = new helpers.ColorRGBA(255, 255, 255, 1.0);
				//particle.Draw(fgCtx, whiteLineStrokeStyle, whiteLineStrokeStyle);
				if (gravitationalConst >= 0) {
					let percentage = particle.acceleration.length / 100 > 1 ? 1 : particle.acceleration.length / 100;
					clr = helpers.ColorRGBA.LinearInterpolateColors(attractionColors, percentage);
					particle.Draw(fgCtx, clr.RGBA, clr.RGBA);
				} else {
					let percentage = particle.acceleration.length / 100 > 1 ? 1 : particle.acceleration.length / 100;
					clr = helpers.ColorRGBA.LinearInterpolateColors(repullsionColors, percentage);
				}
				particle.Draw(fgCtx, clr.RGBA, clr.RGBA);
			} else {
				let dist = Math.floor(helpers.Distance(particle.position.x, particle.position.y, mouse.x, mouse.y));
				if (dist < 50 && particle.radius < sunRadius * 1.2) {
					particle.radius += 0.2;
				} else if (particle.radius > sunRadius) {
					particle.radius -= 0.2;
				}
				particle.Draw(fgCtx, sunColor.RGBA, sunColor.RGBA);
			}
		});

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
			}
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

startAnimating(60);
