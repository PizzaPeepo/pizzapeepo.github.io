import * as helpers from "../Utils/helpers.js";
import * as RungeKutta from "../Utils/RungeKutta.js";
import Particle from "./particle.js";
import Vector2D from "../Utils/Vector2D.js";

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

let repullsionColors = [];
let attractionColors = [];
let sunColor;

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

var initial_gravitationalConst = 10;
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

	let tempParticles = [];
	// use Runge-Kutta-Integration to update position / velocity of particles
	for (let k = 0; k < particles.length; k++) {
		tempParticles.push(RungeKutta.RK4_ParticlesInGravField(k, particles, dt, gravitationalConst));
	}

	// Collision handling
	if (particleCollisionsEnabled) {
		for (let i = 0; i < tempParticles.length; i++) {
			for (let k = 0; k < tempParticles.length; k++) {
				if (i != k) {
					if (tempParticles[i].Overlaps(tempParticles[k])) {
						// resolve the issue when particles overlap by pushing them away from eachother sothat they don't overlap
						let distance = tempParticles[i].position.DistanceTo(tempParticles[k].position);
						let overlap = tempParticles[i].radius + tempParticles[k].radius - distance;
						let massRatio = tempParticles[i].mass / tempParticles[k].mass;
						if (massRatio > 100) {
							// particle 1 much more massive than particle 2 => only move particle 2
							tempParticles[k].position.x -=
								(overlap * (tempParticles[i].position.x - tempParticles[k].position.x)) / distance;
							tempParticles[k].position.y -=
								(overlap * (tempParticles[i].position.y - tempParticles[k].position.y)) / distance;
						}
						// else if (massRatio < 0.01) {
						// 	// particle 2 much more massive than particle 1 => only move particle 1
						// 	tempParticles[i].position.x +=
						// 		(overlap * (tempParticles[i].position.x - tempParticles[k].position.x)) / distance;
						// 	tempParticles[i].position.y +=
						// 		(overlap * (tempParticles[i].position.y - tempParticles[k].position.y)) / distance;
						// }
						else {
							// particles are not insanely different in mass => move both
							tempParticles[i].position.x +=
								((overlap / 2) * (tempParticles[i].position.x - tempParticles[k].position.x)) /
								distance;
							tempParticles[i].position.y +=
								((overlap / 2) * (tempParticles[i].position.y - tempParticles[k].position.y)) /
								distance;

							tempParticles[k].position.x -=
								((overlap / 2) * (tempParticles[i].position.x - tempParticles[k].position.x)) /
								distance;
							tempParticles[k].position.y -=
								((overlap / 2) * (tempParticles[i].position.y - tempParticles[k].position.y)) /
								distance;
						}

						// elastic scattering
						const massFac1 = (2 * tempParticles[k].mass) / (tempParticles[i].mass + tempParticles[k].mass);
						const normalFac1 =
							(massFac1 *
								tempParticles[i].velocity
									.Add(tempParticles[k].velocity.Negative())
									.DotProduct(tempParticles[i].position.Add(tempParticles[k].position.Negative()))) /
							tempParticles[i].position.DistanceTo(tempParticles[k].position) ** 2;
						tempParticles[i].velocity = tempParticles[i].velocity.Add(
							tempParticles[i].position
								.Add(tempParticles[k].position.Negative())
								.Multiply(-1 * normalFac1)
						);

						const massFac2 = (2 * tempParticles[i].mass) / (tempParticles[i].mass + tempParticles[k].mass);
						const normalFac2 =
							(massFac2 *
								tempParticles[k].velocity
									.Add(tempParticles[i].velocity.Negative())
									.DotProduct(tempParticles[k].position.Add(tempParticles[i].position.Negative()))) /
							tempParticles[k].position.DistanceTo(tempParticles[i].position) ** 2;
						tempParticles[k].velocity = tempParticles[k].velocity.Add(
							tempParticles[k].position
								.Add(tempParticles[i].position.Negative())
								.Multiply(-1 * normalFac2)
						);
					}
				}
			}
		}
	}

	for (let j = 0; j < particles.length; j++) {
		particles[j] = tempParticles[j].DeepCopy();
	}

	// Wall behavior handling
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

	// calc elapsed time since last loop
	now = Date.now();
	elapsed = now - then;

	// if enough time has elapsed, draw the next frame
	if (elapsed > fpsInterval) {
		// Get ready for next frame by setting then=now, but...
		// Also, adjust for fpsInterval not being multiple of 16.67
		then = now - (elapsed % fpsInterval);

		fgCtx.clearRect(0, 0, canvasWidth, canvasHeight);
		// draw stuff here
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

		if (isLeftMouseDown) {
			particles[0].lastMousePos.x += (mouse.x - particles[0].lastMousePos.x) * 0.05;
			particles[0].lastMousePos.y += (mouse.y - particles[0].lastMousePos.y) * 0.05;
			particles[0].position.x = particles[0].lastMousePos.x;
			particles[0].position.y = particles[0].lastMousePos.y;
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
