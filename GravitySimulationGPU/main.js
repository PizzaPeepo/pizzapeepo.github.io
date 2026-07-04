// Barnes-Hut N-body galaxy — CPU tree or GPU compute, GPU render, full 3D.
//
// Two compute paths, toggled from the HUD:
// - CPU tree (default): each frame the CPU builds a Barnes-Hut octree (./Octree.js),
//   flattens it to typed arrays, and walks it with a stackless skip-pointer traversal
//   to get 3D forces — O(n log n). Positions stream to the GPU as instanced
//   attributes (one-way upload, no readback). Capped at 100k.
// - GPU n²: a TSL compute kernel integrates entirely on the GPU — positions/velocities
//   live in storage buffers the render shader reads directly, so nothing crosses the
//   bus per frame. Exact all-pairs n² up to ~50k; above that each particle samples a
//   random strided subset of partners per frame (mass-compensated, fresh offset every
//   frame) to stay inside a fixed pair budget — Monte-Carlo far field, up to 1M.
//
// Rendering: particles are camera-facing gaussian-splat billboards (2 tris each),
// velocity-stretched like a long exposure. Speed drives hue, local density (a free
// by-product of the force walk) drives brightness, and a static per-particle
// attribute scatters size/hue so the field reads as stars, not dots. A second pass
// re-draws a configurable slice of the particles as dark normal-blended blobs —
// occluding dust lanes the additive pass can't produce. Post chain: afterimage
// trails → bloom → optional depth of field → chromatic aberration →
// grade/vignette/grain, tone-mapped at output.
//
// Softening/min-cell constants are tuned for ~800px space, so we simulate in that
// pixel-scale and frame the camera to it.

import * as THREE from 'three/webgpu';
import {
	Fn, attribute, positionLocal, uniform, color, pass,
	float, vec2, vec3, vec4, uv, time, screenUV, screenSize, luminance, mix, smoothstep, hash, rtt, texture,
	mx_fractal_noise_float, instancedArray, instanceIndex, Loop, If, uint, uniformArray
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { rgbShift } from 'three/addons/tsl/display/RGBShiftNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Octree } from './Octree.js';
import { onWindowResize } from "../Utils/ResizeManager.js";

// ── config ──
const MAX = 100000;           // CPU-path capacity = largest count the tree handles
const GPU_MAX = 1000000;      // GPU-path capacity (storage buffers, render meshes)
let pairBudget = 2.5e9;       // GPU pair interactions per frame; exact n² ≤ √budget (HUD slider)
const DISK_R = 300;           // disk radius in sim (pixel-scale) units
const BASE_DISK_MASS = 5000;  // total disk mass; per-particle = BASE_DISK_MASS / count
let theta = 1.5;              // Barnes-Hut opening angle (higher = faster, looser)

// ── tunables (driven by the HUD) ──
let count = 10000;
let G = 50;
let coreMass = 10000;
let spin = 1.0;
let coreSoft = 8.0;
let dt = 0.01;
let paused = false;
let massEach = BASE_DISK_MASS / count;
let trailFade = 0.90;         // afterimage damp; 0 = trails off
let bloomMode = 1;            // 0 = off, 1 = low, 2 = high
let gpuMode = false;          // false = CPU Barnes-Hut tree, true = GPU compute
let dustFrac = 0.15;          // fraction of particles re-drawn as dark dust
let dustN = 0;                // = round(count · dustFrac), kept by updateDustCount()
let dofOn = true;             // depth-of-field post pass
let clashRatio = 1.0;         // galaxy-2 : galaxy-1 mass ratio (clash preset, on reset)
let clashRetro = false;       // galaxy 2 spins retrograde (clash preset, on reset)
let colorMode = 0;            // 0 = speed, 1 = radius (temperature), 2 = galaxy ID
let lensStrength = 0;         // gravitational lens strength; 0 = off (blackhole preset sets it)
let drag = 0;                 // gas drag per unit time (blackhole preset sets it)
let accrR = 0;                // accretion radius; particles inside respawn on the rim (0 = off)
let darkMatter = 0;           // isothermal-halo strength (0–1) → flat rotation curve
let diskHeat = 1;             // seeding velocity-dispersion multiplier (Toomre-ish, on reset)
let arms = 2;                 // spiral arm count (on reset)
let pitchDeg = 20;            // spiral arm pitch angle, degrees (on reset)
let asciiOn = false;          // ASCII terminal render mode (post pass)
let fastMode = false;         // fast quality: skip DOF + chromatic aberration
let resScale = 1;             // internal resolution scale (0.4–1)
const EXTRA_MESH_CAP = 300000; // hide dust/secondary-lens passes above this count
let preBH = null;             // knob snapshot to restore when leaving the blackhole preset
const BH_RIN = 45, BH_ROUT = 250; // accretion-disk annulus, sim units
const COLOR_LABELS = ['Color: Speed', 'Color: Radius', 'Color: Galaxy', 'Color: Heatmap'];

// ── movable cores (≤4 massive bodies; core physics on the CPU always — N is tiny) ──
// Each: {x,y,z, vx,vy,vz, frac, mass}; mass = coreMass·frac, kept in sync by the slider.
const NCORES = 4;
let cores = [];

function setCores(list) {
	cores = list.map(c => ({ vx: 0, vy: 0, vz: 0, ...c, mass: coreMass * c.frac }));
	updateCoreMode();
}

// symplectic Euler over core↔core gravity; cores don't feel particle back-reaction
// ponytail: no dynamical friction — the drag knob makes mergers sink
function stepCores() {
	const soft2 = coreSoft * coreSoft;
	const n = cores.length;
	for (let a = 0; a < n; a++) {
		const ca = cores[a];
		let ax = 0, ay = 0, az = 0;
		for (let b = 0; b < n; b++) {
			if (b === a) continue;
			const cb = cores[b];
			const dx = cb.x - ca.x, dy = cb.y - ca.y, dz = cb.z - ca.z;
			const inv = 1 / Math.sqrt(dx * dx + dy * dy + dz * dz + soft2);
			const f = G * cb.mass * inv * inv * inv;
			ax += f * dx; ay += f * dy; az += f * dz;
		}
		ca.vx += ax * dt; ca.vy += ay * dt; ca.vz += az * dt;
	}
	for (let a = 0; a < n; a++) {
		const c = cores[a];
		c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
	}
}

// ── CPU particle state (structure-of-arrays; grown to GPU_MAX on first GPU use) ──
let px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
let vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
let dens = new Float32Array(MAX); // Σ m/r² accumulated during the force walk
let gal = new Float32Array(MAX);  // per-particle galaxy ID (0/1), synced into instVar.z on reset
let cap = MAX;

function ensureCapacity(n) {
	if (cap >= n) return;
	const grow = a => { const b = new Float32Array(n); b.set(a); return b; };
	px = grow(px); py = grow(py); pz = grow(pz);
	vx = grow(vx); vy = grow(vy); vz = grow(vz);
	dens = grow(dens); gal = grow(gal);
	cap = n;
}

// persistent particle views the tree consumes ({ position:{x,y}, mass }); reused, no per-frame alloc
const parts = new Array(MAX);
for (let i = 0; i < MAX; i++) parts[i] = { position: { x: 0, y: 0, z: 0 }, mass: 0 };

// pool sized for ~2 nodes/particle at max count; grows lazily if ever exceeded
const tree = new Octree(MAX * 2);

// Flattened tree (DFS pre-order, skip pointers). Node count is bounded by the
// min-cell floor (not particle count); flat arrays sized generously for 3D.
// tSize[idx] = cube side for internal nodes, -1 for leaves.
const MAXNODES = MAX * 3;
const tComX = new Float32Array(MAXNODES), tComY = new Float32Array(MAXNODES), tComZ = new Float32Array(MAXNODES);
const tMass = new Float32Array(MAXNODES), tSize = new Float32Array(MAXNODES);
const tSkip = new Int32Array(MAXNODES);
let nNodes = 0;

function flattenNode(node) {
	const idx = nNodes++;
	tComX[idx] = node.cx; tComY[idx] = node.cy; tComZ[idx] = node.cz; tMass[idx] = node.totalMass;
	if (node.children === null) {
		tSize[idx] = -1; // leaf
	} else {
		tSize[idx] = node.s; // cubic cell side
		const c = node.children;
		for (let k = 0; k < 8; k++) if (c[k].totalMass > 0) flattenNode(c[k]);
	}
	tSkip[idx] = nNodes; // index just past this node's whole subtree
}
function flattenTree() { nNodes = 0; flattenNode(tree.root); }

// ── render uniforms ──
const sizeU = uniform(1.0);         // particle splat radius, sim (pixel-scale) units
const speedScale = uniform(0.008);  // maps speed → color ramp
const gSignU = uniform(1.0);        // 1 = attractive (blue-orange), 0 = repulsive (cyan-magenta)
const camRightU = uniform(new THREE.Vector3(1, 0, 0)); // camera basis, set per frame
const camUpU = uniform(new THREE.Vector3(0, 1, 0));
const streakU = uniform(0.02);      // velocity-stretch factor (long-exposure streaks)
const densNormU = uniform(1.0);     // adaptive density → brightness normalization
const colorModeU = uniform(0);      // 0 = speed ramp, 1 = radius/temperature, 2 = galaxy ID, 3 = density heatmap
const corePosU = uniform(new THREE.Vector3()); // primary core, set per frame (radius ramp + lens center)
const camPosU = uniform(new THREE.Vector3()); // camera position, set per frame (lens + Doppler)
const lensU = uniform(0);           // point-lens strength (scales Einstein angle²); 0 = off
const rsU = uniform(15);            // Schwarzschild radius, sim units (shadow ≈ 2.6·rs)
const dopplerU = uniform(0);        // Doppler-beaming strength (approaching side brighter)

// ── DOF uniforms ──
// Radial DOF: blur = distance from screen center, so sun (OrbitControls target = origin)
// is always sharp. Scene uses depthWrite:false everywhere, so viewZ from scenePass is
// useless — we drive the DOF node with a synthetic radial "viewZ" instead.
// factor = focus(0) + radialZ → 0 at center, -ve outward → clamp(factor*aperture, ±maxblur)
// Max blur kicks in at UV radius = maxblur / (radialScale * aperture).
const focusU = uniform(0);          // focal plane at screen center (sun)
const radialScaleU = uniform(800);  // larger = tighter focus zone
const apertureU = uniform(0.000035); // blur growth per radial unit
const maxblurU = uniform(0.032);    // blur cap in UV units

// ── GPU-compute uniforms ──
const countU = uniform(0, 'uint');
const sampleCountU = uniform(0, 'uint'); // partners sampled per particle per frame
const strideU = uniform(1, 'uint');      // partner index stride (1 = exact n²)
const offsetU = uniform(0, 'uint');      // fresh random offset per frame (decorrelates sampling)
const gMassU = uniform(0);               // G · massEach · stride (mass compensation)
const massStrideU = uniform(0);          // massEach · stride (density compensation)
const coreVecs = Array.from({ length: NCORES }, () => new THREE.Vector4()); // xyz + G·mass (w=0 inactive)
const coresU = uniformArray(coreVecs);
const coreSoft2U = uniform(64);
const dtU = uniform(0.01);
const burstKU = uniform(0);
const dragU = uniform(0);                // drag·dt, applied to velocity each step
const accrR2U = uniform(0);              // accretion radius²; 0 disables the respawn branch
const accrRimU = uniform(245);           // respawn rim radius (just inside BH_ROUT)
const haloU = uniform(0);                // dark-matter halo v0² (flat circular speed²)

// ── runtime ──
let renderer, scene, camera, controls;
let mesh, geoCPU, meshDustCPU, geoDustCPU;          // CPU-path render objects
let meshGPU, geoGPU, meshDustGPU, geoDustGPU;       // GPU-path render objects (lazy)
let meshLensCPU = null, meshLensGPU = null;         // secondary lensed image (θ₋ branch)
let postProcessing, scenePass;
let afterImageNode = null, bloomNode = null, rttNode = null, dofNode = null, asciiRtt = null, asciiGlowRtt = null;
let asciiTrailRtt = null, asciiTrailNode = null; // glyph-level phosphor persistence (ASCII mode)
let instPos, instVel, instDens; // InstancedBufferAttributes streamed each frame (CPU path)
let instVarCPU = null, instVarGPU = null; // static per-particle variation (z = galaxy ID)
let gpuReady = false;
let gpuSuspend = false;         // halts the kernel while readback snapshots pos+vel
let posBuf, velBuf, densBuf;    // instancedArray storage buffers (GPU path)
let gpuStepKernel, gpuBurstKernel;

// standard normal (Box-Muller)
function gauss() {
	let u = 0, v = 0;
	while (u === 0) u = Math.random();
	while (v === 0) v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// shared disk kinematics: z-profile + circular orbit velocity at (gx, gy);
// zMul < 1 seeds dust particles tighter to the midplane so they read as lanes
function placeDiskParticle(i, gx, gy, zThin, zBulge, sigmaBulge, zMul) {
	const r = Math.sqrt(gx * gx + gy * gy);
	px[i] = gx; py[i] = gy;
	const bulge = Math.exp(-r * r / (2 * sigmaBulge * sigmaBulge));
	pz[i] = gauss() * (zThin + zBulge * bulge) * zMul;
	const rDir = r < 0.001 ? 0.001 : r;            // avoid div-by-zero at the center
	const rVel = Math.max(r, DISK_R * 0.05);        // floor speed near the center
	// circular orbital speed around the core (+ halo term), tangential, jitter·diskHeat
	const haloV2 = darkMatter * Math.max(G, 0) * coreMass / DISK_R;
	const vc = Math.sqrt(Math.max(G * coreMass / (rVel + coreSoft) + haloV2 * rVel / (rVel + 30), 0)) * spin;
	vx[i] = (-gy / rDir) * vc + gauss() * vc * 0.03 * diskHeat;
	vy[i] = (gx / rDir) * vc + gauss() * vc * 0.03 * diskHeat;
	vz[i] = gauss() * vc * 0.02 * diskHeat; // small vertical dispersion
}

function initDisk() {
	const sigmaXY = DISK_R * 0.5;    // in-plane bell spread (≈ DISK_R at 2σ)
	const zThin = DISK_R * 0.025;    // thin disk thickness (≈ radius / 40)
	const zBulge = DISK_R * 0.10;    // extra height in the central bulge
	const sigmaBulge = DISK_R * 0.3; // radial extent of the bulge
	for (let i = 0; i < count; i++) {
		// bell-shaped (Gaussian) blob: dense core, sparse edges
		placeDiskParticle(i, gauss() * sigmaXY, gauss() * sigmaXY, zThin, zBulge, sigmaBulge, i < dustN ? 0.35 : 1.0);
	}
}

function initSpiral() {
	// grand-design two-arm logarithmic spiral: rejection-sample the disk against a
	// density wave cos(m·(θ − ln(r/r0)/tanPitch)), m = 2, pitch ≈ 20°
	const sigmaXY = DISK_R * 0.55;
	const zThin = DISK_R * 0.025;
	const zBulge = DISK_R * 0.10;
	const sigmaBulge = DISK_R * 0.3;
	const tanPitch = Math.tan(pitchDeg * Math.PI / 180);
	const r0 = DISK_R * 0.08;
	for (let i = 0; i < count; i++) {
		let gx = 0, gy = 0, tries = 0;
		for (; tries < 40; tries++) {
			gx = gauss() * sigmaXY; gy = gauss() * sigmaXY;
			const r = Math.sqrt(gx * gx + gy * gy);
			if (r < DISK_R * 0.12) break; // central bulge: no arm structure
			const ang = Math.atan2(gy, gx);
			const w = Math.cos(arms * (ang - Math.log(r / r0) / tanPitch));
			const p = 0.22 + 0.78 * Math.pow(0.5 + 0.5 * w, 2);
			if (Math.random() < p) break;
		}
		placeDiskParticle(i, gx, gy, zThin, zBulge, sigmaBulge, i < dustN ? 0.35 : 1.0);
	}
}

function step() {
	// cubic bounds (with margin) so every particle sits inside the tree root
	let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
	for (let i = 0; i < count; i++) {
		const x = px[i], y = py[i], z = pz[i];
		if (x < mnx) mnx = x; if (x > mxx) mxx = x;
		if (y < mny) mny = y; if (y > mxy) mxy = y;
		if (z < mnz) mnz = z; if (z > mxz) mxz = z;
		parts[i].position.x = x; parts[i].position.y = y; parts[i].position.z = z;
		parts[i].mass = massEach;
	}
	const cx = (mnx + mxx) * 0.5, cy = (mny + mxy) * 0.5, cz = (mnz + mxz) * 0.5;
	const half = Math.max(mxx - mnx, mxy - mny, mxz - mnz) * 0.5 + 10;
	tree.reset(cx - half, cy - half, cz - half, 2 * half);
	for (let i = 0; i < count; i++) tree.insert(parts[i]);
	flattenTree();

	const coreSoft2 = coreSoft * coreSoft;
	const theta2 = theta * theta;
	const haloV2 = darkMatter * Math.max(G, 0) * coreMass / DISK_R;
	const n = nNodes;
	for (let i = 0; i < count; i++) {
		const xi = px[i], yi = py[i], zi = pz[i];
		let ax = 0, ay = 0, az = 0, di = 0, idx = 0;
		// stackless Barnes-Hut walk: accept a node (leaf, or far enough by θ) and skip
		// its subtree; otherwise open it (first child is the next array entry).
		while (idx < n) {
			const dx = tComX[idx] - xi, dy = tComY[idx] - yi, dz = tComZ[idx] - zi;
			const d2 = dx * dx + dy * dy + dz * dz;
			const sz = tSize[idx]; // < 0 marks a leaf
			if (sz < 0 || sz * sz < theta2 * d2) {
				const r2s = d2 + 25; // BH softening² (matches the tree's 5px)
				const m = tMass[idx];
				const f = G * m / (r2s * Math.sqrt(r2s));
				ax += f * dx; ay += f * dy; az += f * dz;
				di += m / r2s; // local-density proxy, free by-product of the walk
				idx = tSkip[idx];
			} else {
				idx++;
			}
		}
		dens[i] = di;
		// movable cores
		for (let c = 0; c < cores.length; c++) {
			const co = cores[c];
			const dcx = co.x - xi, dcy = co.y - yi, dcz = co.z - zi;
			const inv = 1 / Math.sqrt(dcx * dcx + dcy * dcy + dcz * dcz + coreSoft2);
			const cf = G * co.mass * inv * inv * inv;
			ax += cf * dcx; ay += cf * dcy; az += cf * dcz;
		}
		if (haloV2 > 0) {
			// isothermal dark-matter halo about the origin → flat rotation curve
			const rh = Math.sqrt(xi * xi + yi * yi + zi * zi) + 1;
			const ah = haloV2 / ((rh + 30) * rh);
			ax -= ah * xi; ay -= ah * yi; az -= ah * zi;
		}
		// symplectic Euler: kick then drift (+ optional gas drag)
		vx[i] += ax * dt; vy[i] += ay * dt; vz[i] += az * dt;
		if (drag > 0) { const f = 1 - drag * dt; vx[i] *= f; vy[i] *= f; vz[i] *= f; }
		px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
		if (accrR > 0) {
			// accretion: fell inside r_acc → respawn on the rim in a circular orbit
			const c0 = cores[0];
			const adx = px[i] - c0.x, ady = py[i] - c0.y, adz = pz[i] - c0.z;
			if (adx * adx + ady * ady + adz * adz < accrR * accrR) {
				const ang = Math.random() * Math.PI * 2;
				const rr = 245 * (0.92 + Math.random() * 0.15);
				const vcr = Math.sqrt(G * c0.mass / (rr + coreSoft));
				px[i] = c0.x + Math.cos(ang) * rr; py[i] = c0.y + Math.sin(ang) * rr; pz[i] = c0.z + gauss() * 2;
				vx[i] = -Math.sin(ang) * vcr; vy[i] = Math.cos(ang) * vcr; vz[i] = 0;
			}
		}
	}
}

function uploadInstances() {
	const p = instPos.array, vl = instVel.array, dn = instDens.array;
	let dSum = 0;
	for (let i = 0; i < count; i++) {
		p[3 * i] = px[i]; p[3 * i + 1] = py[i]; p[3 * i + 2] = pz[i];
		vl[3 * i] = vx[i]; vl[3 * i + 1] = vy[i]; vl[3 * i + 2] = vz[i];
		dn[i] = dens[i];
		dSum += dens[i];
	}
	instPos.needsUpdate = true;
	instVel.needsUpdate = true;
	instDens.needsUpdate = true;
	geoCPU.instanceCount = count;
	// adaptive brightness normalization: pull the mean density toward mid-ramp
	const mean = dSum / count;
	if (mean > 0) {
		const target = Math.min(1 / (mean * 2.5), 50);
		densNormU.value += (target - densNormU.value) * 0.05;
	}
}

let currentPreset = 'spiral';

function updateGColors(g) {
	gSignU.value = g >= 0 ? 1.0 : 0.0;
}

function initRing() {
	for (let i = 0; i < count; i++) {
		const angle = (i / count) * Math.PI * 2;
		px[i] = Math.cos(angle) * DISK_R;
		py[i] = Math.sin(angle) * DISK_R;
		pz[i] = gauss() * DISK_R * 0.01;
		const Geff = Math.max(G, 1);
		const vc = Math.sqrt(Geff * coreMass / (DISK_R + coreSoft)) * (spin || 1);
		vx[i] = -Math.sin(angle) * vc;
		vy[i] = Math.cos(angle) * vc;
		vz[i] = gauss() * Math.abs(vc) * 0.01;
	}
}

function initCollapse() {
	for (let i = 0; i < count; i++) {
		let rx, ry, rz;
		do {
			rx = Math.random() * 2 - 1;
			ry = Math.random() * 2 - 1;
			rz = Math.random() * 2 - 1;
		} while (rx * rx + ry * ry + rz * rz > 1);
		px[i] = rx * DISK_R;
		py[i] = ry * DISK_R;
		pz[i] = rz * DISK_R * 0.25;
		vx[i] = 0; vy[i] = 0; vz[i] = 0;
	}
}

// one tilted spiral galaxy in the frame of a moving core; indices [iStart, iEnd)
function seedSpiralGalaxy(iStart, iEnd, core, mCore, spinDir, tilt, zMul, galId) {
	const sigmaXY = DISK_R * 0.35 * Math.sqrt(mCore / (coreMass * 0.5 + 1) + 0.05);
	const zThin = DISK_R * 0.02;
	const zBulge = DISK_R * 0.08;
	const sigmaBulge = DISK_R * 0.25;
	const tanPitch = Math.tan(pitchDeg * Math.PI / 180);
	const r0 = DISK_R * 0.08;
	const Geff = Math.max(G, 1);
	const ct = Math.cos(tilt), st = Math.sin(tilt);
	for (let i = iStart; i < iEnd; i++) {
		let gx = 0, gy = 0, tries = 0;
		for (; tries < 40; tries++) {
			gx = gauss() * sigmaXY; gy = gauss() * sigmaXY;
			const r = Math.sqrt(gx * gx + gy * gy);
			if (r < DISK_R * 0.10) break; // central bulge: no arm structure
			const ang = Math.atan2(gy, gx);
			const w = Math.cos(arms * (ang - Math.log(r / r0) / tanPitch));
			const p = 0.22 + 0.78 * Math.pow(0.5 + 0.5 * w, 2);
			if (Math.random() < p) break;
		}
		const r = Math.sqrt(gx * gx + gy * gy);
		const bulge = Math.exp(-r * r / (2 * sigmaBulge * sigmaBulge));
		const lz = gauss() * (zThin + zBulge * bulge) * zMul;
		const rDir = r < 0.001 ? 0.001 : r;
		const rVel = Math.max(r, DISK_R * 0.05);
		const vc = Math.sqrt(Geff * mCore / (rVel + coreSoft)) * spin * spinDir;
		const lvx = (-gy / rDir) * vc + gauss() * Math.abs(vc) * 0.03 * diskHeat;
		const lvy = (gx / rDir) * vc + gauss() * Math.abs(vc) * 0.03 * diskHeat;
		const lvz = gauss() * Math.abs(vc) * 0.02 * diskHeat;
		// tilt about the x-axis, then shift into the galaxy's moving frame
		px[i] = core.x + gx;
		py[i] = core.y + gy * ct - lz * st;
		pz[i] = core.z + gy * st + lz * ct;
		vx[i] = core.vx + lvx;
		vy[i] = core.vy + lvy * ct - lvz * st;
		vz[i] = core.vz + lvy * st + lvz * ct;
		gal[i] = galId;
	}
}

function initGalaxyCollision() {
	// two spiral galaxies on a grazing encounter; particle counts and core masses
	// split by clashRatio (galaxy 2 : galaxy 1); galaxy 2 optionally retrograde
	const q = clashRatio;
	const f1 = 1 / (1 + q), f2 = q / (1 + q);
	const n2 = Math.round(count * f2), n1 = count - n2;
	const d1 = Math.min(Math.round(dustN * f1), n1), d2 = dustN - d1;
	const ox = DISK_R * 1.5, oy = DISK_R * 0.45; // approach offset + impact parameter
	const Geff = Math.max(G, 1);
	const approach = Math.sqrt(Geff * coreMass * 0.5 / (ox * 2 + coreSoft)) * 0.6;
	setCores([
		{ x: -ox, y: -oy * 0.5, z: 0, vx: approach, frac: f1 },
		{ x: ox, y: oy * 0.5, z: 0, vx: -approach, frac: f2 }
	]);
	const spin2 = clashRetro ? -1 : 1;
	const tilt1 = 0.25, tilt2 = -0.45;
	// dust slots first (both galaxies), then bodies — the dust pass draws instances [0, dustN)
	seedSpiralGalaxy(0, d1, cores[0], coreMass * f1, 1, tilt1, 0.35, 0);
	seedSpiralGalaxy(d1, d1 + d2, cores[1], coreMass * f2, spin2, tilt2, 0.35, 1);
	seedSpiralGalaxy(d1 + d2, d1 + d2 + (n1 - d1), cores[0], coreMass * f1, 1, tilt1, 1.0, 0);
	seedSpiralGalaxy(d1 + d2 + (n1 - d1), count, cores[1], coreMass * f2, spin2, tilt2, 1.0, 1);
}

function initBlackhole() {
	// thin Keplerian annulus around the heavy core, log-uniform in r (inner disk denser)
	const logR = Math.log(BH_ROUT / BH_RIN);
	const Geff = Math.max(G, 1);
	for (let i = 0; i < count; i++) {
		const r = BH_RIN * Math.exp(Math.random() * logR);
		const ang = Math.random() * Math.PI * 2;
		const zMul = i < dustN ? 0.35 : 1.0;
		px[i] = Math.cos(ang) * r;
		py[i] = Math.sin(ang) * r;
		pz[i] = gauss() * 2.5 * zMul;
		const vc = Math.sqrt(Geff * coreMass / (r + coreSoft)) * (spin || 1);
		vx[i] = -Math.sin(ang) * vc + gauss() * Math.abs(vc) * 0.01;
		vy[i] = Math.cos(ang) * vc + gauss() * Math.abs(vc) * 0.01;
		vz[i] = gauss() * Math.abs(vc) * 0.005;
	}
}

function initTDE() {
	// compact "star" on a just-bound plunging orbit past the BH → tidal stream
	const c0 = cores[0];
	const R0 = 380, b = 55; // start distance, angular-momentum offset (sets periapsis)
	const Geff = Math.max(G, 1);
	const vp = Math.sqrt(2 * Geff * coreMass / R0) * 0.98;
	const vt = Math.sqrt(2 * Geff * coreMass * b) / R0;
	for (let i = 0; i < count; i++) {
		px[i] = c0.x + R0 + gauss() * 9;
		py[i] = c0.y + gauss() * 9;
		pz[i] = c0.z + 20 + gauss() * 9;
		vx[i] = -vp + gauss() * 0.5;
		vy[i] = vt + gauss() * 0.5;
		vz[i] = gauss() * 0.5;
	}
}

function initGlobular() {
	// self-gravitating cluster, no central core: near-virial gaussian ball
	setCores([]);
	const sig = DISK_R * 0.4;
	const sv = 0.4 * Math.sqrt(Math.max(G, 1) * BASE_DISK_MASS / sig);
	for (let i = 0; i < count; i++) {
		px[i] = gauss() * sig; py[i] = gauss() * sig; pz[i] = gauss() * sig;
		vx[i] = gauss() * sv; vy[i] = gauss() * sv; vz[i] = gauss() * sv;
	}
}

function initWeb() {
	// near-uniform cold box: gravity condenses filaments + halos (best at high counts)
	setCores([]);
	const half = DISK_R * 1.1;
	for (let i = 0; i < count; i++) {
		px[i] = (Math.random() * 2 - 1) * half;
		py[i] = (Math.random() * 2 - 1) * half;
		pz[i] = (Math.random() * 2 - 1) * half;
		vx[i] = gauss() * 0.5; vy[i] = gauss() * 0.5; vz[i] = gauss() * 0.5;
	}
}

function initSatellite() {
	// big spiral + dwarf companion on a tilted orbit → tidal stream wraps around
	const nD = Math.round(count * 0.12);
	const R = DISK_R * 1.4;
	const Geff = Math.max(G, 1);
	const vt = Math.sqrt(Geff * coreMass * 0.92 / R) * 0.9;
	setCores([
		{ x: 0, y: 0, z: 0, frac: 0.92 },
		{ x: R, y: 0, z: DISK_R * 0.45, vy: vt * 0.9, vz: -vt * 0.25, frac: 0.08 }
	]);
	seedSpiralGalaxy(0, dustN, cores[0], coreMass * 0.92, 1, 0, 0.35, 0);
	seedSpiralGalaxy(dustN, count - nD, cores[0], coreMass * 0.92, 1, 0, 1.0, 0);
	const c1 = cores[1], sig = DISK_R * 0.07;
	const sv = 0.35 * Math.sqrt(Geff * coreMass * 0.08 / sig);
	for (let i = count - nD; i < count; i++) {
		px[i] = c1.x + gauss() * sig; py[i] = c1.y + gauss() * sig; pz[i] = c1.z + gauss() * sig;
		vx[i] = c1.vx + gauss() * sv; vy[i] = c1.vy + gauss() * sv; vz[i] = c1.vz + gauss() * sv;
		gal[i] = 1;
	}
}

function initBinary() {
	// equal-mass binary in mutual circular orbit + circumbinary annulus
	const d = 120;
	const Geff = Math.max(G, 1);
	const vOrb = Math.sqrt(Geff * coreMass * 0.5 / (2 * d));
	setCores([
		{ x: -d / 2, y: 0, z: 0, vy: -vOrb, frac: 0.5 },
		{ x: d / 2, y: 0, z: 0, vy: vOrb, frac: 0.5 }
	]);
	const rIn = 140, rOut = 320;
	const logR = Math.log(rOut / rIn);
	for (let i = 0; i < count; i++) {
		const r = rIn * Math.exp(Math.random() * logR);
		const ang = Math.random() * Math.PI * 2;
		px[i] = Math.cos(ang) * r; py[i] = Math.sin(ang) * r;
		pz[i] = gauss() * 3 * (i < dustN ? 0.35 : 1);
		const vc = Math.sqrt(Geff * coreMass / (r + coreSoft));
		vx[i] = -Math.sin(ang) * vc; vy[i] = Math.cos(ang) * vc;
		vz[i] = gauss() * vc * 0.01;
	}
}

// entering/leaving the blackhole preset flips several knobs; snapshot + restore
function setSliderValue(id, v) {
	const sl = document.getElementById(id);
	sl.value = String(v);
	sl.dispatchEvent(new Event('input'));
}

function setColorMode(m) {
	colorMode = m;
	colorModeU.value = m;
	document.getElementById('colorButton').textContent = COLOR_LABELS[m];
}

function enterBH() {
	if (!preBH) preBH = { coreMass, colorMode, lensStrength, drag };
	setSliderValue('coreSlider', 50000);
	setSliderValue('lensSlider', 1.2);
	setSliderValue('dragSlider', 0.004);
	setColorMode(1);
	accrR = 30; dopplerU.value = 0.5;
}

function leaveBH() {
	if (!preBH) return;
	setSliderValue('coreSlider', preBH.coreMass);
	setSliderValue('lensSlider', preBH.lensStrength);
	setSliderValue('dragSlider', preBH.drag);
	setColorMode(preBH.colorMode);
	accrR = 0; dopplerU.value = 0;
	preBH = null;
}

// ── cinematic camera ──
// per-preset framings the camera eases toward on preset switch
const FRAMINGS = {
	disk: [80, 350, 600],
	spiral: [0, 150, 720],
	ring: [120, 420, 620],
	collapse: [350, 260, 650],
	galaxy: [0, 520, 880],
	blackhole: [0, -540, 80],
	tde: [0, -300, 420],
	globular: [260, 200, 620],
	web: [300, 300, 900],
	satellite: [0, 480, 800],
	binary: [0, -500, 240]
};
let camTween = null;          // { from, to, t0, dur }
let lastInteract = -Infinity; // pointer-interaction timestamp gates auto-rotate
let shakeT0 = -1;             // burst camera-shake start
let shockT0 = -1;             // burst shockwave-ring start
let shockMesh = null;

function startCamTween(framing) {
	camTween = {
		from: camera.position.clone(),
		to: new THREE.Vector3(framing[0], framing[1], framing[2]),
		t0: Date.now(),
		dur: 1200
	};
}

function applyPreset(name) {
	currentPreset = name;
	if (name === 'blackhole' || name === 'tde') enterBH(); else leaveBH();
	reset();
	if (FRAMINGS[name]) startCamTween(FRAMINGS[name]);
}

function reset() {
	dustN = Math.round(count * dustFrac);
	setCores([{ x: 0, y: 0, z: 0, frac: 1 }]); // single core at origin; presets may override
	gal.fill(0, 0, count);
	if (currentPreset === 'blackhole') initBlackhole();
	else if (currentPreset === 'tde') initTDE();
	else if (currentPreset === 'globular') initGlobular();
	else if (currentPreset === 'web') initWeb();
	else if (currentPreset === 'satellite') initSatellite();
	else if (currentPreset === 'binary') initBinary();
	else if (currentPreset === 'ring') initRing();
	else if (currentPreset === 'collapse') initCollapse();
	else if (currentPreset === 'galaxy') initGalaxyCollision();
	else if (currentPreset === 'spiral') initSpiral();
	else initDisk();
	syncGalaxyIds();
	dens.fill(0, 0, count);
	if (gpuMode && gpuReady) syncToGPU();
}

function setCount(n) {
	count = n;
	massEach = BASE_DISK_MASS / n;
	updateGpuSampling();
	if (geoGPU) geoGPU.instanceCount = count;
	updateDustCount();
	updateLensVis();
	reset();
	document.getElementById('countValue').textContent = n.toLocaleString();
}

function makeDotTexture() {
	const s = 64;
	const cv = document.createElement('canvas');
	cv.width = cv.height = s;
	const ctx = cv.getContext('2d');
	const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
	g.addColorStop(0.0, 'rgba(255,255,255,1)');
	g.addColorStop(0.45, 'rgba(255,255,255,1)');
	g.addColorStop(1.0, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, s, s);
	return new THREE.CanvasTexture(cv);
}

function makeRingTexture() {
	const s = 128;
	const cv = document.createElement('canvas');
	cv.width = cv.height = s;
	const ctx = cv.getContext('2d');
	const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
	g.addColorStop(0.0, 'rgba(0,0,0,0)');
	g.addColorStop(0.40, 'rgba(255,210,160,0)');
	g.addColorStop(0.50, 'rgba(255,236,214,1)');
	g.addColorStop(0.62, 'rgba(255,150,80,0.25)');
	g.addColorStop(1.0, 'rgba(0,0,0,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, s, s);
	return new THREE.CanvasTexture(cv);
}

// ── starfield: three twinkling shells at different depths (parallax) ──
const twinkleLayers = [];
let starTexture = null;

function makeStarLayer(N, rMin, rSpan, size, colorFn) {
	const pos = new Float32Array(N * 3);
	const base = new Float32Array(N * 3);
	const phase = new Float32Array(N);
	const rate = new Float32Array(N);
	for (let i = 0; i < N; i++) {
		const phi = Math.acos(2 * Math.random() - 1);
		const th = Math.random() * Math.PI * 2;
		const r = rMin + Math.random() * rSpan;
		pos[i * 3] = r * Math.sin(phi) * Math.cos(th);
		pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(th);
		pos[i * 3 + 2] = r * Math.cos(phi);
		colorFn(base, i * 3);
		phase[i] = Math.random() * Math.PI * 2;
		rate[i] = 0.5 + Math.random() * 2.0; // scintillation speed, rad/s
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	const colAttr = new THREE.BufferAttribute(base.slice(), 3);
	colAttr.setUsage(THREE.DynamicDrawUsage);
	geo.setAttribute('color', colAttr);
	const mat = new THREE.PointsMaterial({
		size, sizeAttenuation: false, transparent: true, vertexColors: true,
		map: starTexture, depthWrite: false, blending: THREE.AdditiveBlending
	});
	scene.add(new THREE.Points(geo, mat));
	twinkleLayers.push({ N, base, colAttr, phase, rate });
}

function createStarLayers() {
	starTexture = makeDotTexture();
	// far shell — dense, tinted cool-blue ↔ warm-amber
	makeStarLayer(6000, 8000, 2500, 2.4, (a, k) => {
		const b = 0.5 + Math.random() * 0.5;
		const t = Math.random();
		a[k] = b * (0.85 + 0.15 * t);
		a[k + 1] = b * 0.92;
		a[k + 2] = b * (1.0 - 0.18 * t);
	});
	// mid shell — the original warm field
	makeStarLayer(2000, 2200, 800, 2.0, (a, k) => {
		const b = 0.35 + Math.random() * 0.35;
		a[k] = b * 0.69; a[k + 1] = b * 0.63; a[k + 2] = b * 0.53;
	});
	// near shell — sparse bright giants for strong parallax
	makeStarLayer(300, 1100, 400, 3.2, (a, k) => {
		const b = 0.7 + Math.random() * 0.3;
		const t = Math.random();
		a[k] = b * (0.9 + 0.1 * t);
		a[k + 1] = b * 0.95;
		a[k + 2] = b * (1.05 - 0.15 * t);
	});
}

function updateTwinkle(t) {
	for (const L of twinkleLayers) {
		const a = L.colAttr.array, base = L.base, phase = L.phase, rate = L.rate;
		for (let i = 0; i < L.N; i++) {
			const b = 0.6 + 0.4 * Math.sin(t * rate[i] + phase[i]);
			const k = i * 3;
			a[k] = base[k] * b; a[k + 1] = base[k + 1] * b; a[k + 2] = base[k + 2] * b;
		}
		L.colAttr.needsUpdate = true;
	}
}

// ── procedural nebula backdrop: inward-facing fBM sphere, kept below bloom threshold ──
function createNebula() {
	const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
	mat.colorNode = Fn(() => {
		const dir = positionLocal.normalize();
		const wisps = mx_fractal_noise_float(dir.mul(2.5), 4, 2.0, 0.55, 1.0).mul(0.5).add(0.5);
		const patch = mx_fractal_noise_float(dir.mul(1.2).add(7.3), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
		const tint = mix(color(0x18243f), color(0x3a1f12), wisps); // deep blue ↔ rust
		return tint.mul(wisps.mul(patch.pow(1.5))).mul(0.45);
	})();
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(11000, 48, 32), mat);
	mesh.renderOrder = -2;
	scene.add(mesh);
}

// ── cores: animated accretion glow + black-hole mode at high core mass ──
// one visual group per core slot, positioned from cores[] each frame
let coreGroups = [];
const BH_THRESHOLD = 30000;

function createCore() {
	for (let i = 0; i < NCORES; i++) coreGroups.push(makeCoreVisual(i === 0));
	updateCoreMode();
}

function makeCoreVisual(primary) {
	const group = new THREE.Group();
	// inner sphere: noise-modulated emissive, slowly rotating
	const innerMat = new THREE.MeshBasicNodeMaterial({
		transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
	});
	innerMat.colorNode = Fn(() => {
		const p = positionLocal.mul(0.35);
		const a = time.mul(0.25);
		const ca = a.cos(), sa = a.sin();
		const rp = vec3(p.x.mul(ca).sub(p.y.mul(sa)), p.x.mul(sa).add(p.y.mul(ca)), p.z);
		const n = mx_fractal_noise_float(rp.add(time.mul(0.1)), 3, 2.0, 0.5, 1.0).mul(0.5).add(0.5);
		return color(0xfff4e2).mul(n.mul(0.7).add(0.7));
	})();
	innerMat.opacityNode = float(0.95);
	group.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 32), innerMat));

	// halo sphere: slow opacity pulse
	const haloMat = new THREE.MeshBasicNodeMaterial({
		transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
	});
	haloMat.colorNode = color(0xffae5a);
	haloMat.opacityNode = float(0.10).add(time.mul(0.7).sin().mul(0.04));
	group.add(new THREE.Mesh(new THREE.SphereGeometry(30, 16, 16), haloMat));

	// camera-facing lens-flare sprite (primary core only): the dot gradient at large scale
	if (primary) {
		const flare = new THREE.Sprite(new THREE.SpriteMaterial({
			map: starTexture, color: 0xffe7c0, transparent: true, opacity: 0.05,
			blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
		}));
		flare.scale.set(480, 480, 1);
		group.add(flare);
	}

	// black-hole mode (high core mass): dark disc + hot photon ring
	const bhGroup = new THREE.Group();
	bhGroup.add(new THREE.Mesh(
		new THREE.SphereGeometry(12, 32, 32),
		new THREE.MeshBasicMaterial({ color: 0x000000 }) // opaque: occludes additive particles
	));
	const ring = new THREE.Sprite(new THREE.SpriteMaterial({
		map: makeRingTexture(), transparent: true, opacity: 0.9,
		blending: THREE.AdditiveBlending, depthWrite: false
	}));
	ring.scale.set(78, 78, 1);
	bhGroup.add(ring);
	group.add(bhGroup);
	group.userData.bh = bhGroup;
	scene.add(group);
	return group;
}

function updateCoreMode() {
	for (let i = 0; i < coreGroups.length; i++) {
		const co = cores[i];
		coreGroups[i].visible = !!co;
		coreGroups[i].userData.bh.visible = !!co && co.mass >= BH_THRESHOLD;
	}
}

function createShockwave() {
	shockMesh = new THREE.Mesh(
		new THREE.RingGeometry(0.92, 1.0, 128),
		new THREE.MeshBasicMaterial({
			color: 0xffc98a, transparent: true, opacity: 0,
			blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
		})
	);
	shockMesh.visible = false;
	scene.add(shockMesh);
}

function updateShockwave(now) {
	if (shockT0 < 0) return;
	const u = (now - shockT0) / 900;
	if (u >= 1) { shockT0 = -1; shockMesh.visible = false; return; }
	const s = 20 + (2 * DISK_R - 20) * Math.sqrt(u); // fast launch, decelerating front
	shockMesh.visible = true;
	shockMesh.scale.set(s, s, 1);
	shockMesh.material.opacity = 0.55 * (1 - u);
}

// ── shared splat rendering: one builder for all four particle materials ──
// (CPU/GPU source nodes × star/dust look). Instancing goes through
// InstancedBufferGeometry + plain Mesh, so there is no instanceMatrix at all —
// positionNode is the entire placement path.

function makeQuadGeometry() {
	const plane = new THREE.PlaneGeometry(2, 2); // 2 tris/particle; oriented in-shader
	const geo = new THREE.InstancedBufferGeometry();
	geo.index = plane.index;
	geo.setAttribute('position', plane.getAttribute('position'));
	geo.setAttribute('uv', plane.getAttribute('uv'));
	geo.instanceCount = 0;
	return geo;
}

function makeSplatMaterial(posNode, velNode, densNode, varNode, isDust, imageSign = 1) {
	// velocity projected onto the billboard plane → long-exposure stretch direction
	const velPlane = vec2(velNode.dot(camRightU), velNode.dot(camUpU));
	const speedPlane = velPlane.length();
	const stretchAmt = speedPlane.mul(streakU).min(4.0);

	// Point-lens (BH at corePosU) image of the splat. Small-angle lens equation:
	// β = source angle off the camera→BH axis, θ± = (β ± √(β² + 4·θE²))/2 the two
	// image angles; θE² ∝ rs·d_ls/(d_l·d_s) vanishes for particles in front of the
	// BH plane (d_ls ≤ 0), so the displacement fades in smoothly with depth.
	// imageSign +1 = primary image (pushed outward), −1 = secondary (flipped, inside
	// the Einstein ring). vis collapses splats whose image lands in the shadow.
	const lensCalc = () => {
		const toBH = corePosU.sub(camPosU);
		const dL = toBH.length().max(1.0);
		const Ldir = toBH.div(dL);
		const w = posNode.sub(camPosU);
		const dS = w.dot(Ldir).max(1.0);
		const perp = w.sub(Ldir.mul(dS));
		const beta = perp.length().div(dS).max(1e-5);
		const dLS = dS.sub(dL);
		const thetaE2 = rsU.mul(2.0).mul(dLS.max(0.0)).div(dL.mul(dS)).mul(lensU);
		const disc = beta.mul(beta).add(thetaE2.mul(4.0)).sqrt();
		const theta = imageSign > 0 ? beta.add(disc).mul(0.5) : beta.sub(disc).mul(0.5);
		const ratio = theta.div(beta);
		const apparent = camPosU.add(Ldir.mul(dS)).add(perp.mul(ratio));
		const active = lensU.greaterThan(0.001);
		const vis = active.and(dLS.greaterThan(0.0))
			.and(theta.abs().mul(dL).lessThan(rsU.mul(2.6)))
			.select(float(0.0), float(1.0));
		return { apparent, ratio, dLS, vis };
	};

	const material = new THREE.MeshBasicNodeMaterial();
	material.positionNode = Fn(() => {
		const lens = lensCalc();
		const xy = positionLocal.xy.mul(sizeU.mul(varNode.x).mul(isDust ? 2.6 : 1.0)).mul(lens.vis);
		const dir = velPlane.div(speedPlane.max(0.0001));
		const stretched = xy.add(dir.mul(xy.dot(dir)).mul(stretchAmt));
		return lens.apparent
			.add(camRightU.mul(stretched.x))
			.add(camUpU.mul(stretched.y));
	})();
	if (isDust) {
		// dark extinction blobs: normal blending is the only thing in the scene that
		// can *remove* light, which is what makes the lanes read as dust
		material.colorNode = color(0x0b0705);
		material.opacityNode = Fn(() => {
			const d = uv().mul(2.0).sub(1.0);
			const alpha = d.dot(d).mul(-3.0).exp().sub(0.02).max(0.0);
			return alpha.mul(0.42).div(stretchAmt.mul(0.5).add(1.0));
		})();
		material.blending = THREE.NormalBlending;
	} else {
		material.colorNode = Fn(() => {
			const s = velNode.length().mul(speedScale).add(varNode.y).saturate();
			// 3-stop ramp: royal blue (slow) → teal (mid) → warm gold (fast)
			const t1 = s.mul(2.0).saturate();
			const t2 = s.sub(0.5).mul(2.0).saturate();
			const attract = mix(mix(color(0x2a4cc0), color(0x3fe0d0), t1), color(0xffe7a0), t2);
			const repulse = mix(color(0x6a2cff), color(0xff3ce0), s);
			const rampSpeed = mix(repulse, attract, gSignU);
			// radius mode: blackbody-ish — hot white-blue at the primary core → deep red rim
			const rT = posNode.sub(corePosU).length().div(DISK_R * 0.9).saturate();
			const rampRadius = mix(mix(color(0xe8f1ff), color(0xff9a4a), rT.mul(3.0).saturate()),
				color(0x8a2408), rT.sub(0.35).mul(1.6).saturate()).mul(float(1.6).sub(rT));
			// galaxy mode: second population gets a violet-pink ramp, keyed by instVar.z
			const rampB = mix(mix(color(0x7a2cff), color(0xff5ad0), t1), color(0xffd9f0), t2);
			const rampGalaxy = mix(rampSpeed, rampB, varNode.z);
			// heatmap mode: local density → thermal palette (FluidSimulation's heatRamp)
			const hT = densNode.mul(densNormU).mul(1.5).saturate().pow(0.75);
			let hc = mix(vec3(0.0), vec3(0.0, 0.12, 0.70), smoothstep(0.00, 0.16, hT));
			hc = mix(hc, vec3(0.0, 0.55, 1.0), smoothstep(0.16, 0.32, hT));
			hc = mix(hc, vec3(0.0, 1.0, 1.0), smoothstep(0.32, 0.46, hT));
			hc = mix(hc, vec3(0.85, 0.95, 1.0), smoothstep(0.46, 0.56, hT));
			hc = mix(hc, vec3(1.0, 1.0, 0.0), smoothstep(0.56, 0.71, hT));
			hc = mix(hc, vec3(1.0, 0.45, 0.0), smoothstep(0.71, 0.84, hT));
			const rampHeat = mix(hc, vec3(1.0, 0.0, 0.0), smoothstep(0.84, 1.00, hT));
			const ramp = colorModeU.lessThan(0.5).select(rampSpeed,
				colorModeU.lessThan(1.5).select(rampRadius,
				colorModeU.lessThan(2.5).select(rampGalaxy, rampHeat)));
			// local density → brightness: clumps and the core glow hot, halo stays faint
			const b = densNode.mul(densNormU).saturate().pow(0.5);
			// Doppler beaming: the approaching side of the disk brightens
			const toCam = camPosU.sub(posNode);
			const vHat = velNode.div(velNode.length().max(0.001));
			const dopp = float(1.0).add(vHat.dot(toCam.div(toCam.length().max(0.001))).mul(dopplerU)).max(0.05).pow(3.0);
			// lens magnification ≈ θ/β (primary brightens near the ring, secondary dims)
			const mag = imageSign > 0 ? lensCalc().ratio.clamp(1.0, 3.0) : lensCalc().ratio.abs().clamp(0.2, 1.5);
			return ramp.mul(b.mul(1.3).add(0.45)).mul(dopp).mul(mag);
		})();
		material.opacityNode = Fn(() => {
			// gaussian point-spread falloff over the quad, zeroed at the edge
			const d = uv().mul(2.0).sub(1.0);
			const alpha = d.dot(d).mul(-4.5).exp().sub(0.011).max(0.0);
			// dim long streaks: same light spread over more pixels
			const base = alpha.div(stretchAmt.mul(0.5).add(1.0));
			// secondary image: only exists for sources behind the lens, and dimmer
			if (imageSign < 0) return base.mul(smoothstep(float(0.0), float(30.0), lensCalc().dLS)).mul(0.6);
			return base;
		})();
		material.blending = THREE.AdditiveBlending;
	}
	material.transparent = true;
	material.depthWrite = false;
	return material;
}

function makeVarAttribute(n) {
	// static per-particle variation: x = log-normal size scale, y = hue jitter,
	// z = galaxy ID (rewritten by syncGalaxyIds on every reset)
	const varArr = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		varArr[3 * i] = Math.min(Math.max(Math.exp(gauss() * 0.5), 0.4), 4.0);
		varArr[3 * i + 1] = (Math.random() - 0.5) * 0.1;
	}
	return new THREE.InstancedBufferAttribute(varArr, 3);
}

function syncGalaxyIds() {
	for (const at of [instVarCPU, instVarGPU]) {
		if (!at) continue;
		const a = at.array, n = Math.min(count, a.length / 3);
		for (let i = 0; i < n; i++) a[3 * i + 2] = gal[i];
		at.needsUpdate = true;
	}
}

function updateLensVis() {
	lensU.value = lensStrength;
	const on = lensStrength > 0 && count <= EXTRA_MESH_CAP;
	if (meshLensCPU) meshLensCPU.visible = on && !gpuMode;
	if (meshLensGPU) meshLensGPU.visible = on && gpuMode;
}

function updateDustCount() {
	dustN = Math.round(count * dustFrac);
	const cap = count <= EXTRA_MESH_CAP; // dust pass off at extreme counts (vertex cost)
	if (geoDustCPU) { geoDustCPU.instanceCount = dustN; meshDustCPU.visible = !gpuMode && dustN > 0 && cap; }
	if (geoDustGPU) { geoDustGPU.instanceCount = dustN; meshDustGPU.visible = gpuMode && dustN > 0 && cap; }
}

// ── GPU compute path: storage-buffer state + stochastic strided n² kernel ──

function updateGpuSampling() {
	// exact all-pairs when count² fits the budget; otherwise every particle sums a
	// strided subset (fresh random offset each frame), with mass scaled by the stride
	// so the expected force matches the full sum
	let samples = count, stride = 1;
	if (count * count > pairBudget) {
		samples = Math.max(1024, Math.floor(pairBudget / count));
		stride = Math.ceil(count / samples);
		samples = Math.ceil(count / stride);
	}
	sampleCountU.value = samples;
	strideU.value = stride;
}

function ensureGPU() {
	if (gpuReady) return;
	ensureCapacity(GPU_MAX);
	posBuf = instancedArray(GPU_MAX, 'vec3');
	velBuf = instancedArray(GPU_MAX, 'vec3');
	densBuf = instancedArray(GPU_MAX, 'float');

	gpuStepKernel = Fn(() => {
		If(instanceIndex.lessThan(countU), () => {
			const pi = posBuf.element(instanceIndex).toVar();
			const acc = vec3(0.0).toVar();
			const di = float(0.0).toVar();
			Loop({ start: uint(0), end: sampleCountU, type: 'uint', condition: '<' }, ({ i: j }) => {
				// raw < 2·count by construction, so one conditional subtract wraps it
				const raw = j.mul(strideU).add(offsetU);
				const idx = raw.lessThan(countU).select(raw, raw.sub(countU));
				const d = posBuf.element(idx).sub(pi);
				const r2 = d.dot(d).add(25.0); // BH softening² (matches the CPU walk)
				acc.addAssign(d.mul(r2.mul(r2.sqrt()).reciprocal()));
				di.addAssign(r2.reciprocal());
			});
			acc.mulAssign(gMassU);
			// movable cores: xyz + premultiplied G·mass (w = 0 for inactive slots)
			Loop({ start: uint(0), end: uint(NCORES), type: 'uint', condition: '<' }, ({ i: c }) => {
				const cw = coresU.element(c);
				const dc = cw.xyz.sub(pi);
				const r2c = dc.dot(dc).add(coreSoft2U);
				acc.addAssign(dc.mul(cw.w.mul(r2c.mul(r2c.sqrt()).reciprocal())));
			});
			// isothermal dark-matter halo about the origin → flat rotation curve
			const rh = pi.length().add(1.0);
			acc.subAssign(pi.mul(haloU.div(rh.add(30.0).mul(rh))));
			// symplectic Euler: kick then drift (+ optional gas drag)
			const v = velBuf.element(instanceIndex).toVar();
			v.addAssign(acc.mul(dtU));
			v.mulAssign(float(1.0).sub(dragU));
			const np = pi.add(v.mul(dtU)).toVar();
			// accretion: fell inside r_acc → respawn on the rim in a circular orbit
			const c0 = coresU.element(uint(0));
			const dc0 = np.sub(c0.xyz);
			If(dc0.dot(dc0).lessThan(accrR2U), () => {
				const seed = instanceIndex.add(offsetU).toFloat();
				const ang = hash(seed).mul(6.2831853);
				const rr = accrRimU.mul(hash(seed.add(77777.0)).mul(0.15).add(0.92));
				const ca = ang.cos(), sa = ang.sin();
				np.assign(c0.xyz.add(vec3(ca.mul(rr), sa.mul(rr), 0.0)));
				const vcr = c0.w.div(rr).sqrt(); // c0.w = G·mass → √(G·m/r)
				v.assign(vec3(sa.negate().mul(vcr), ca.mul(vcr), 0.0));
			});
			velBuf.element(instanceIndex).assign(v);
			posBuf.element(instanceIndex).assign(np);
			densBuf.element(instanceIndex).assign(di.mul(massStrideU));
		});
	})().compute(GPU_MAX);

	gpuBurstKernel = Fn(() => {
		If(instanceIndex.lessThan(countU), () => {
			const p = posBuf.element(instanceIndex);
			const inv = p.xy.length().add(0.001).reciprocal();
			const v = velBuf.element(instanceIndex).toVar();
			v.addAssign(vec3(p.x.mul(inv), p.y.mul(inv), 0.0).mul(burstKU));
			velBuf.element(instanceIndex).assign(v);
		});
	})().compute(GPU_MAX);

	// 1M-capacity render meshes reading the storage buffers directly — the render
	// shader consumes the same memory the kernel writes, nothing crosses the bus
	instVarGPU = makeVarAttribute(GPU_MAX);
	const posA = posBuf.toAttribute(), velA = velBuf.toAttribute(), densA = densBuf.toAttribute();
	geoGPU = makeQuadGeometry();
	geoGPU.setAttribute('instVar', instVarGPU);
	meshGPU = new THREE.Mesh(geoGPU, makeSplatMaterial(posA, velA, densA, attribute('instVar', 'vec3'), false));
	meshGPU.frustumCulled = false;
	meshGPU.visible = false;
	scene.add(meshGPU);
	geoDustGPU = makeQuadGeometry();
	geoDustGPU.setAttribute('instVar', instVarGPU);
	meshDustGPU = new THREE.Mesh(geoDustGPU, makeSplatMaterial(posA, velA, densA, attribute('instVar', 'vec3'), true));
	meshDustGPU.frustumCulled = false;
	meshDustGPU.renderOrder = 1;
	meshDustGPU.visible = false;
	scene.add(meshDustGPU);
	meshLensGPU = new THREE.Mesh(geoGPU, makeSplatMaterial(posA, velA, densA, attribute('instVar', 'vec3'), false, -1));
	meshLensGPU.frustumCulled = false;
	meshLensGPU.visible = false;
	scene.add(meshLensGPU);
	gpuReady = true;
}

function syncToGPU() {
	// always write PACKED xyz triplets at [3i]: the WebGPU backend's update path
	// re-strides vec3 storage data 3→4 from exactly this layout on every upload
	// (even after it flips the attribute's itemSize to 4 — see readbackFromGPU)
	const pa = posBuf.value.array, va = velBuf.value.array;
	for (let i = 0; i < count; i++) {
		pa[3 * i] = px[i]; pa[3 * i + 1] = py[i]; pa[3 * i + 2] = pz[i];
		va[3 * i] = vx[i]; va[3 * i + 1] = vy[i]; va[3 * i + 2] = vz[i];
	}
	densBuf.value.array.fill(0, 0, count);
	posBuf.value.needsUpdate = true;
	velBuf.value.needsUpdate = true;
	densBuf.value.needsUpdate = true;
}

async function readbackFromGPU() {
	const pa = new Float32Array(await renderer.getArrayBufferAsync(posBuf.value));
	const va = new Float32Array(await renderer.getArrayBufferAsync(velBuf.value));
	// vec3 storage buffers live on the GPU at 16-byte stride (WGSL alignment): the
	// backend re-strides the attribute 3→4 floats at buffer creation and flips its
	// itemSize to 4, so the readback is padded — index with the *current* itemSize
	const ps = posBuf.value.itemSize, vs = velBuf.value.itemSize;
	const n = Math.min(count, MAX);
	for (let i = 0; i < n; i++) {
		px[i] = pa[ps * i]; py[i] = pa[ps * i + 1]; pz[i] = pa[ps * i + 2];
		vx[i] = va[vs * i]; vy[i] = va[vs * i + 1]; vz[i] = va[vs * i + 2];
	}
}

async function setComputeMode(gpu) {
	if (gpu === gpuMode) return;
	if (gpu && renderer.backend.isWebGPUBackend !== true) return; // WebGL2 fallback can't run the kernel
	const countSl = document.getElementById('countSlider');
	const note = document.getElementById('countNote');
	if (gpu) {
		ensureGPU();
		gpuMode = true;
		syncToGPU(); // carry the running CPU state over seamlessly
		countSl.max = '6';
		note.textContent = 'GPU n² compute — up to 1M; far field sampled above ~50k';
	} else {
		// pull positions/velocities back so the CPU tree continues where the GPU left
		// off. The kernel must not step between the two snapshots — positions and
		// velocities from different times heat the disk into a spheroid.
		gpuSuspend = true;
		try { await readbackFromGPU(); } catch (e) { console.warn('GPU readback failed; resuming from last CPU state', e); }
		gpuSuspend = false;
		gpuMode = false;
		if (count > MAX) {
			count = MAX;
			massEach = BASE_DISK_MASS / count;
			countSl.value = '5';
			document.getElementById('countValue').textContent = count.toLocaleString();
			updateGpuSampling();
		}
		countSl.max = '5';
		note.textContent = 'Barnes-Hut CPU tree — 1 to 100k, log scale';
	}
	mesh.visible = !gpuMode;
	if (meshGPU) { meshGPU.visible = gpuMode; geoGPU.instanceCount = count; }
	updateDustCount();
	updateLensVis();
	buildPost(); // fresh afterimage target: don't smear the switch discontinuity into the trails
	document.getElementById('computeButton').textContent = gpuMode ? 'Compute: GPU n²' : 'Compute: CPU tree';
}

async function init() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x05050a);

	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 20000);
	const f = FRAMINGS[currentPreset];
	camera.position.set(f[0], f[1], f[2]);

	renderer = new THREE.WebGPURenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	// filmic highlight rolloff for the additive core; Neutral keeps saturated blues
	// from skewing magenta the way ACES does
	renderer.toneMapping = THREE.NeutralToneMapping;
	renderer.domElement.id = 'gpuCanvas';
	document.body.appendChild(renderer.domElement);
	await renderer.init();

	// CPU-path mesh: position/velocity/density streamed from the CPU each frame
	instPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
	instVel = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
	instDens = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
	instVarCPU = makeVarAttribute(MAX);
	geoCPU = makeQuadGeometry();
	geoCPU.setAttribute('instPos', instPos);
	geoCPU.setAttribute('instVel', instVel);
	geoCPU.setAttribute('instDens', instDens);
	geoCPU.setAttribute('instVar', instVarCPU);
	mesh = new THREE.Mesh(geoCPU, makeSplatMaterial(
		attribute('instPos', 'vec3'), attribute('instVel', 'vec3'),
		attribute('instDens', 'float'), attribute('instVar', 'vec3'), false));
	mesh.frustumCulled = false;
	scene.add(mesh);

	// dust lanes: the first dustN particles re-drawn dark after the additive pass
	// (same physics arrays — shared attributes — different material)
	geoDustCPU = makeQuadGeometry();
	geoDustCPU.setAttribute('instPos', instPos);
	geoDustCPU.setAttribute('instVel', instVel);
	geoDustCPU.setAttribute('instDens', instDens);
	geoDustCPU.setAttribute('instVar', instVarCPU);
	meshDustCPU = new THREE.Mesh(geoDustCPU, makeSplatMaterial(
		attribute('instPos', 'vec3'), attribute('instVel', 'vec3'),
		attribute('instDens', 'float'), attribute('instVar', 'vec3'), true));
	meshDustCPU.frustumCulled = false;
	meshDustCPU.renderOrder = 1;
	scene.add(meshDustCPU);

	// secondary lensed image (θ₋ branch): same buffers, visible only when lensing is on
	meshLensCPU = new THREE.Mesh(geoCPU, makeSplatMaterial(
		attribute('instPos', 'vec3'), attribute('instVel', 'vec3'),
		attribute('instDens', 'float'), attribute('instVar', 'vec3'), false, -1));
	meshLensCPU.frustumCulled = false;
	meshLensCPU.visible = false;
	scene.add(meshLensCPU);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.autoRotateSpeed = 0.3;
	controls.minDistance = 30;
	controls.maxDistance = 4000;
	controls.addEventListener('start', () => { lastInteract = Date.now(); camTween = null; });

	createNebula();
	createStarLayers();
	createCore();
	createShockwave();
	postProcessing = new THREE.PostProcessing(renderer);
	scenePass = pass(scene, camera);
	buildPost();

	onWindowResize(onResize);
	wireUI();

	// the compute path needs real WebGPU storage buffers; under the WebGL2
	// fallback the renderer still draws, but the kernel can't run
	if (renderer.backend.isWebGPUBackend !== true) {
		const btn = document.getElementById('computeButton');
		btn.disabled = true;
		btn.textContent = 'GPU compute: n/a';
	}

	// query params (used by automated checks too): ?compute=gpu&count=300000&dof=1&dust=0.2
	const q = new URLSearchParams(window.location.search);
	if (q.get('compute') !== 'cpu') await setComputeMode(true); // GPU default; ?compute=cpu forces tree
	if (q.has('count')) {
		const sl = document.getElementById('countSlider');
		sl.value = String(Math.log10(Math.max(1, +q.get('count') || 1)));
		sl.dispatchEvent(new Event('input'));
	}
	if (q.has('preset') && FRAMINGS[q.get('preset')]) applyPreset(q.get('preset'));
	if (q.has('color')) {
		const n = (+q.get('color') || 0) % 4;
		for (let i = 0; i < n; i++) document.getElementById('colorButton').click();
	}
	if (q.has('dust')) {
		const sl = document.getElementById('dustSlider');
		sl.value = q.get('dust');
		sl.dispatchEvent(new Event('input'));
	}
	if (q.get('dof') === '0') document.getElementById('dofButton').click(); // DOF default on; ?dof=0 forces off
	if (q.get('ascii') === '1') document.getElementById('asciiButton').click();
	if (q.get('fast') === '1') document.getElementById('qualityButton').click();
	if (q.has('res')) {
		const sl = document.getElementById('resSlider');
		sl.value = q.get('res');
		sl.dispatchEvent(new Event('input'));
	}

	renderer.setAnimationLoop(animate);
}

// ── post chain: scene → afterimage trails → bloom → DOF → CA → grade/vignette/grain ──
function buildPost() {
	if (afterImageNode) { afterImageNode.dispose?.(); afterImageNode = null; }
	if (bloomNode) { bloomNode.dispose?.(); bloomNode = null; }
	if (dofNode) { dofNode.dispose?.(); dofNode = null; }
	if (rttNode) { rttNode.dispose?.(); rttNode = null; }
	if (asciiRtt) { asciiRtt.dispose?.(); asciiRtt = null; }
	if (asciiGlowRtt) { asciiGlowRtt.dispose?.(); asciiGlowRtt = null; }
	if (asciiTrailRtt) { asciiTrailRtt.dispose?.(); asciiTrailRtt = null; }
	if (asciiTrailNode) { asciiTrailNode.dispose?.(); asciiTrailNode = null; }

	let node = scenePass.getTextureNode('output');
	if (trailFade > 0) {
		afterImageNode = afterImage(node, trailFade);
		node = afterImageNode;
	}
	if (bloomMode > 0) {
		const [st, ra, th] = bloomMode === 1 ? [0.4, 0.35, 0.45] : [0.9, 0.5, 0.4];
		bloomNode = bloom(node, st, ra, th);
		node = node.add(bloomNode);
	}
	if (dofOn && !fastMode) {
		// Radial viewZ proxy: 0 at screen center, negative outward.
		// DOF formula: factor = focus(0) + radialZ → blur grows away from center.
		const radialZ = uv().sub(vec2(0.5, 0.5)).length().mul(radialScaleU).negate();
		dofNode = dof(node, radialZ, focusU, apertureU, maxblurU);
		node = dofNode;
	}
	// chromatic aberration needs to resample the composite → render it to a texture.
	// On sub-pixel splats a full-frame shift dissolves dots into r/g/b triplets, so
	// the shifted version is blended in toward the frame edges only.
	// fast mode: skip the extra render target and the shift entirely
	let comp = node, shifted = null;
	if (!fastMode) {
		comp = rttNode = rtt(node);
		shifted = rgbShift(comp, 0.0012);
	}
	const gradeNode = Fn(() => {
		const d = screenUV.sub(0.5).length();
		const caMask = smoothstep(0.30, 0.75, d).mul(0.8);
		const col = (fastMode ? comp.rgb : mix(comp.rgb, shifted.rgb, caMask)).toVar();
		// teal-orange grade: cool shadows, warm highlights (both subtle)
		const lum = luminance(col).saturate();
		col.assign(mix(col.mul(vec3(0.92, 1.03, 1.10)), col, lum));
		col.assign(mix(col, col.mul(vec3(1.06, 1.00, 0.92)), lum.mul(0.5)));
		// vignette
		col.mulAssign(float(1.0).sub(smoothstep(0.35, 0.85, d).mul(0.35)));
		// fine animated film grain
		const g = hash(screenUV.x.mul(1213.7).add(screenUV.y.mul(7773.1)).add(time.mul(31.7)));
		col.addAssign(g.sub(0.5).mul(0.025));
		return vec4(col, 1.0);
	})();
	if (asciiOn) {
		let a = makeAsciiNode(asciiRtt = rtt(gradeNode));
		// glyph-level phosphor persistence: afterimage over the glyph bitmap (fluid's asciiFade)
		if (asciiPersist > 0) a = asciiTrailNode = afterImage(asciiTrailRtt = rtt(a), asciiPersist);
		postProcessing.outputNode = makeGlowNode(asciiGlowRtt = rtt(a));
	} else {
		postProcessing.outputNode = gradeNode;
	}
	postProcessing.needsUpdate = true;
}

// ── ASCII mode: quantize the finished frame into colored terminal glyphs ──
// Glyph ramp, exact-pixel Web437 atlas and phosphor glow ported from FluidSimulation.
const ASCII_RAMP = ' .:-=+*#%@';
const ASCII_GP = 16;             // Web437_ATI_9x16 native glyph grid (px)
const ASCII_GP_X = 9;            // glyph cell width = ink width
const ASCII_GP_Y = 16;           // glyph cell height
const ASCII_SS = 8;              // supersample factor for the coverage threshold
const glowAmountU = uniform(0.4); // glyph-bloom halo strength (fluid's ASCII_GLOW_AMOUNT, HUD slider)
let asciiPersist = 0.85;          // glyph phosphor persistence, 0 = off (fluid's ASCII_PERSIST)
let asciiAtlasTex = null;

// Built with the monospace fallback until the bitmap web-font loads, then rebuilt once.
const asciiFontFace = new FontFace('Web437_ATI_9x16', "url('../FluidSimulation/Web437_ATI_9x16.woff')");
asciiFontFace.load()
	.then(f => {
		document.fonts.add(f);
		if (asciiAtlasTex) { asciiAtlasTex.dispose(); asciiAtlasTex = null; }
		if (asciiOn && postProcessing) buildPost();
	})
	.catch(() => {});

// Web437 is a bitmap face: render it at an integer multiple of its native grid with the
// pen integer-aligned (top/left, SS-snapped), then coverage-threshold each SS-square block
// down to one texel (ON iff >=50% inked) - exact font pixels, no AA fringe. Same recipe
// as FluidSimulation/main.js buildAtlas.
function makeAsciiAtlas() {
	const n = ASCII_RAMP.length;
	const cellW = ASCII_GP_X * ASCII_SS, cellH = ASCII_GP_Y * ASCII_SS;
	const cv = document.createElement('canvas');
	cv.width = n * cellW; cv.height = cellH;
	const ctx = cv.getContext('2d');
	ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
	ctx.fillStyle = '#fff';
	ctx.font = (ASCII_GP * ASCII_SS) + "px 'Web437_ATI_9x16', monospace";
	ctx.textAlign = 'left'; ctx.textBaseline = 'top';
	const offX = Math.round((cellW - ctx.measureText('M').width) / 2 / ASCII_SS) * ASCII_SS;
	for (let i = 0; i < n; i++) ctx.fillText(ASCII_RAMP[i], i * cellW + offX, 0);
	const src = ctx.getImageData(0, 0, cv.width, cv.height).data;
	const outW = n * ASCII_GP_X, outH = ASCII_GP_Y;
	const out = document.createElement('canvas');
	out.width = outW; out.height = outH;
	const octx = out.getContext('2d');
	const oimg = octx.createImageData(outW, outH);
	const half = (ASCII_SS * ASCII_SS) / 2;
	for (let oy = 0; oy < outH; oy++) for (let ox = 0; ox < outW; ox++) {
		let lit = 0;
		for (let sy = 0; sy < ASCII_SS; sy++) for (let sx = 0; sx < ASCII_SS; sx++)
			if (src[((oy * ASCII_SS + sy) * cv.width + (ox * ASCII_SS + sx)) * 4] > 127) lit++;
		const v = lit >= half ? 255 : 0;
		const o = (oy * outW + ox) * 4;
		oimg.data[o] = oimg.data[o + 1] = oimg.data[o + 2] = v;
		oimg.data[o + 3] = 255;
	}
	octx.putImageData(oimg, 0, 0);
	const t = new THREE.CanvasTexture(out);
	t.generateMipmaps = false;
	t.minFilter = THREE.NearestFilter;
	t.magFilter = THREE.NearestFilter;
	return t;
}

// srcNode must be a texture node (rtt) — sampled once at each cell's center
function makeAsciiNode(srcNode) {
	if (!asciiAtlasTex) asciiAtlasTex = makeAsciiAtlas();
	return Fn(() => {
		const cells = screenSize.div(vec2(ASCII_GP_X, ASCII_GP_Y)).floor().max(vec2(1.0));
		const cellId = screenUV.mul(cells).floor();
		const c = srcNode.sample(cellId.add(0.5).div(cells));
		const lum = luminance(c.rgb).saturate();
		const n = float(ASCII_RAMP.length);
		const gi = lum.pow(0.7).mul(n.sub(1.0)).round();
		const local = screenUV.mul(cells).fract();
		const mask = texture(asciiAtlasTex, vec2(gi.add(local.x).div(n), local.y)).r;
		return vec4(c.rgb.mul(mask).mul(1.5), 1.0);
	})();
}

// Phosphor glow: gaussian-blur the glyph bitmap and add it back, so lit glyphs bleed a
// soft halo into the surrounding cell gaps (FluidSimulation's asciiPresent glyph-bloom:
// 7x7 taps at 1.5px spread, ~half a glyph cell of reach). srcTex must be a texture node (rtt).
function makeGlowNode(srcTex) {
	return Fn(() => {
		const col = srcTex.sample(screenUV).rgb.toVar();
		const acc = vec3(0.0).toVar();
		let wsum = 0;
		for (let bx = -3; bx <= 3; bx++) for (let by = -3; by <= 3; by++) {
			const w = Math.exp(-(bx * bx + by * by) * 2.25 * 0.10);
			wsum += w;
			acc.addAssign(srcTex.sample(screenUV.add(vec2(bx * 1.5, by * 1.5).div(screenSize))).rgb.mul(w));
		}
		return vec4(col.add(acc.div(wsum).mul(glowAmountU)), 1.0);
	})();
}

function applyResolution() {
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * resScale);
	renderer.setSize(window.innerWidth, window.innerHeight);
	buildPost(); // fresh post targets at the new size
}

// ── FPS badge ──
let frames = 0, fpsLast = Date.now();

async function animate() {
	const now = Date.now();
	if (!paused && !(gpuMode && gpuSuspend)) stepCores();
	for (let i = 0; i < cores.length; i++) coreGroups[i].position.set(cores[i].x, cores[i].y, cores[i].z);
	if (gpuMode) {
		if (!paused && !gpuSuspend) {
			countU.value = count;
			dtU.value = dt;
			coreSoft2U.value = coreSoft * coreSoft;
			for (let c = 0; c < NCORES; c++) {
				const co = cores[c];
				if (co) coreVecs[c].set(co.x, co.y, co.z, G * co.mass);
				else coreVecs[c].set(0, 0, 0, 0);
			}
			gMassU.value = G * massEach * strideU.value;
			massStrideU.value = massEach * strideU.value;
			offsetU.value = Math.floor(Math.random() * count);
			dragU.value = drag * dt;
			accrR2U.value = accrR * accrR;
			haloU.value = darkMatter * Math.max(G, 0) * coreMass / DISK_R;
			await renderer.computeAsync(gpuStepKernel);
		}
	} else {
		if (!paused) step();
		uploadInstances();
	}
	updateTwinkle(performance.now() * 0.001);
	updateShockwave(now);

	// cinematic camera: preset fly-in tween, else orbit controls with idle auto-rotate
	if (camTween) {
		const u = Math.min((now - camTween.t0) / camTween.dur, 1);
		const s = u * u * (3 - 2 * u); // smoothstep ease
		camera.position.lerpVectors(camTween.from, camTween.to, s);
		camera.lookAt(0, 0, 0);
		if (u >= 1) camTween = null;
	} else {
		controls.autoRotate = now - lastInteract > 5000;
		controls.update();
	}

	// burst camera shake: decaying random offset, reverted after render
	let sx = 0, sy = 0, sz = 0;
	if (shakeT0 >= 0) {
		const u = (now - shakeT0) / 300;
		if (u >= 1) { shakeT0 = -1; }
		else {
			const amp = 9 * (1 - u) * (1 - u);
			sx = (Math.random() * 2 - 1) * amp;
			sy = (Math.random() * 2 - 1) * amp;
			sz = (Math.random() * 2 - 1) * amp;
			camera.position.x += sx; camera.position.y += sy; camera.position.z += sz;
		}
	}

	camera.updateMatrixWorld();
	camRightU.value.setFromMatrixColumn(camera.matrixWorld, 0);
	camUpU.value.setFromMatrixColumn(camera.matrixWorld, 1);
	if (cores.length) corePosU.value.set(cores[0].x, cores[0].y, cores[0].z);
	else corePosU.value.set(0, 0, 0);
	camPosU.value.copy(camera.position);
	await postProcessing.renderAsync();
	if (sx || sy || sz) {
		camera.position.x -= sx; camera.position.y -= sy; camera.position.z -= sz;
	}

	frames++;
	const t = Date.now();
	if (t - fpsLast >= 500) {
		document.getElementById('fpsValue').textContent = Math.round((frames * 1000) / (t - fpsLast));
		frames = 0;
		fpsLast = t;
	}
}

function onResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

function burst() {
	const k = Math.sqrt(Math.abs(G * coreMass) / DISK_R) * 0.8; // ~comparable to orbital speed
	if (gpuMode) {
		countU.value = count;
		burstKU.value = k;
		renderer.computeAsync(gpuBurstKernel);
	} else {
		for (let i = 0; i < count; i++) {
			const x = px[i], y = py[i];
			const inv = 1 / (Math.sqrt(x * x + y * y) + 0.001);
			vx[i] += x * inv * k; vy[i] += y * inv * k;
		}
	}
	shakeT0 = Date.now();
	shockT0 = Date.now();
}

function wireUI() {
	const bindNum = (id, valId, set, fmt) => {
		const sl = document.getElementById(id);
		const out = document.getElementById(valId);
		const show = () => { out.textContent = fmt ? fmt(+sl.value) : sl.value; };
		sl.addEventListener('input', () => { set(+sl.value); show(); });
		show();
	};
	bindNum('gravSlider', 'gravValue', v => { G = v; updateGColors(v); }, v => v.toFixed(0));
	bindNum('coreSlider', 'coreValue', v => { coreMass = v; for (const c of cores) c.mass = coreMass * c.frac; updateCoreMode(); }, v => v.toLocaleString());
	bindNum('spinSlider', 'spinValue', v => spin = v, v => v.toFixed(2));
	bindNum('softSlider', 'softValue', v => coreSoft = v, v => v.toFixed(0));
	bindNum('dtSlider', 'dtValue', v => dt = v, v => v.toFixed(3));
	bindNum('sizeSlider', 'sizeValue', v => sizeU.value = v, v => v.toFixed(1));
	bindNum('thetaSlider', 'thetaValue', v => theta = v, v => v.toFixed(2));
	bindNum('dofFocusSlider', 'dofFocusValue', v => focusU.value = v, v => v.toFixed(0));
	bindNum('dofScaleSlider', 'dofScaleValue', v => radialScaleU.value = v, v => v.toFixed(0));
	bindNum('dofApertureSlider', 'dofApertureValue', v => apertureU.value = v, v => v.toExponential(1));
	bindNum('dofMaxblurSlider', 'dofMaxblurValue', v => maxblurU.value = v, v => v.toFixed(3));
	bindNum('streakSlider', 'streakValue', v => streakU.value = v, v => v === 0 ? 'Off' : v.toFixed(3));
	bindNum('dustSlider', 'dustValue', v => { dustFrac = v; updateDustCount(); }, v => v === 0 ? 'Off' : Math.round(v * 100) + '%');
	bindNum('trailSlider', 'trailValue', v => {
		const wasOn = trailFade > 0;
		trailFade = v;
		if ((v > 0) !== wasOn) buildPost();
		else if (afterImageNode && afterImageNode.damp) afterImageNode.damp.value = v;
	}, v => v === 0 ? 'Off' : v.toFixed(2));
	bindNum('glowSlider', 'glowValue', v => glowAmountU.value = v, v => v === 0 ? 'Off' : v.toFixed(2));
	bindNum('persistSlider', 'persistValue', v => {
		const wasOn = asciiPersist > 0;
		asciiPersist = v;
		if ((v > 0) !== wasOn) { if (asciiOn) buildPost(); }
		else if (asciiTrailNode && asciiTrailNode.damp) asciiTrailNode.damp.value = v;
	}, v => v === 0 ? 'Off' : v.toFixed(2));

	const countSl = document.getElementById('countSlider');
	const updateCount = () => {
		const n = Math.max(1, Math.round(Math.pow(10, +countSl.value)));
		setCount(n);
	};
	countSl.addEventListener('input', updateCount);
	updateCount();
	document.getElementById('resetButton').addEventListener('click', reset);
	document.getElementById('presetSpiral').addEventListener('click', () => applyPreset('spiral'));
	document.getElementById('presetDisk').addEventListener('click', () => applyPreset('disk'));
	document.getElementById('presetRing').addEventListener('click', () => applyPreset('ring'));
	document.getElementById('presetCollapse').addEventListener('click', () => applyPreset('collapse'));
	document.getElementById('presetGalaxy').addEventListener('click', () => applyPreset('galaxy'));
	bindNum('ratioSlider', 'ratioValue', v => clashRatio = v, v => v.toFixed(2));
	const retroBtn = document.getElementById('retroButton');
	retroBtn.addEventListener('click', () => {
		clashRetro = !clashRetro;
		retroBtn.textContent = clashRetro ? 'Galaxy 2: Retrograde' : 'Galaxy 2: Prograde';
		if (currentPreset === 'galaxy') reset();
	});
	document.getElementById('colorButton').addEventListener('click', () => setColorMode((colorMode + 1) % 4));
	bindNum('lensSlider', 'lensValue', v => { lensStrength = v; updateLensVis(); }, v => v === 0 ? 'Off' : v.toFixed(2));
	bindNum('dragSlider', 'dragValue', v => drag = v, v => v === 0 ? 'Off' : v.toFixed(4));
	bindNum('dmSlider', 'dmValue', v => darkMatter = v, v => v === 0 ? 'Off' : v.toFixed(2));
	bindNum('heatSlider', 'heatValue', v => diskHeat = v, v => v.toFixed(1));
	bindNum('armsSlider', 'armsValue', v => arms = Math.round(v), v => String(Math.round(v)));
	bindNum('pitchSlider', 'pitchValue', v => pitchDeg = v, v => v.toFixed(0));
	bindNum('resSlider', 'resValue', v => { resScale = v; applyResolution(); }, v => Math.round(v * 100) + '%');
	bindNum('budgetSlider', 'budgetValue', v => { pairBudget = Math.pow(10, v); updateGpuSampling(); }, v => (Math.pow(10, v) / 1e9).toFixed(1) + ' G');
	const asciiBtn = document.getElementById('asciiButton');
	asciiBtn.addEventListener('click', () => {
		asciiOn = !asciiOn;
		asciiBtn.textContent = asciiOn ? 'ASCII: On' : 'ASCII: Off';
		buildPost();
	});
	const qualityBtn = document.getElementById('qualityButton');
	qualityBtn.addEventListener('click', () => {
		fastMode = !fastMode;
		qualityBtn.textContent = fastMode ? 'Quality: Fast' : 'Quality: Full';
		buildPost();
	});
	document.getElementById('presetBH').addEventListener('click', () => applyPreset('blackhole'));
	document.getElementById('presetTDE').addEventListener('click', () => applyPreset('tde'));
	document.getElementById('presetGlobular').addEventListener('click', () => applyPreset('globular'));
	document.getElementById('presetWeb').addEventListener('click', () => applyPreset('web'));
	document.getElementById('presetSatellite').addEventListener('click', () => applyPreset('satellite'));
	document.getElementById('presetBinary').addEventListener('click', () => applyPreset('binary'));
	updateGColors(G);
	document.getElementById('burstButton').addEventListener('click', burst);
	const bloomBtn = document.getElementById('bloomButton');
	const bloomLabels = ['Bloom: Off', 'Bloom: Low', 'Bloom: High'];
	bloomBtn.addEventListener('click', () => {
		bloomMode = (bloomMode + 1) % 3;
		bloomBtn.textContent = bloomLabels[bloomMode];
		buildPost();
	});
	const dofBtn = document.getElementById('dofButton');
	dofBtn.addEventListener('click', () => {
		dofOn = !dofOn;
		dofBtn.textContent = dofOn ? 'DOF: On' : 'DOF: Off';
		buildPost();
	});
	document.getElementById('computeButton').addEventListener('click', () => setComputeMode(!gpuMode));
	const pauseBtn = document.getElementById('pauseButton');
	pauseBtn.addEventListener('click', () => {
		paused = !paused;
		pauseBtn.textContent = paused ? 'Resume' : 'Pause';
	});

	window.addEventListener('keydown', e => {
		if (e.code === 'Space') { e.preventDefault(); pauseBtn.click(); }
		else if (e.code === 'KeyR') reset();
		else if (e.code === 'KeyB') burst();
	});
}

if (typeof navigator !== 'undefined' && navigator.gpu) {
	init().catch(err => {
		console.error('GPU gravity init failed:', err);
		document.getElementById('webgpuError').style.display = 'flex';
	});
} else {
	document.getElementById('webgpuError').style.display = 'flex';
}
