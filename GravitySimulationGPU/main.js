// Barnes-Hut N-body galaxy — CPU tree, GPU render, full 3D.
//
// Each frame the CPU builds a Barnes-Hut octree (./Octree.js), flattens it to typed
// arrays, and walks it with a stackless skip-pointer traversal to get 3D forces —
// O(n log n) instead of brute-force O(n²). The GPU only draws: particle positions are
// streamed into an InstancedMesh via a dynamic instanced attribute (one-way upload,
// no GPU→CPU readback). Self-gravity acts on all three axes, so an initially puffy
// cloud collapses toward a midplane and flattens into a disk on its own.
//
// Rendering: particles are camera-facing gaussian-splat billboards (2 tris each),
// velocity-stretched like a long exposure. Speed drives hue, local density (a free
// by-product of the force walk) drives brightness, and a static per-particle
// attribute scatters size/hue so the field reads as stars, not dots. Post chain:
// afterimage trails → bloom → chromatic aberration → grade/vignette/grain, ACES
// tone-mapped at output.
//
// Softening/min-cell constants are tuned for ~800px space, so we simulate in that
// pixel-scale and frame the camera to it.

import * as THREE from 'three/webgpu';
import {
	Fn, attribute, positionLocal, uniform, color, pass,
	float, vec2, vec3, vec4, uv, time, screenUV, luminance, mix, smoothstep, hash, rtt,
	mx_fractal_noise_float
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { afterImage } from 'three/addons/tsl/display/AfterImageNode.js';
import { rgbShift } from 'three/addons/tsl/display/RGBShiftNode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Octree } from './Octree.js';
import { onWindowResize } from "../Utils/ResizeManager.js";

// ── config ──
const MAX = 100000;           // array capacity = largest selectable count
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
let bloomMode = 2;            // 0 = off, 1 = low, 2 = high

// ── CPU particle state (structure-of-arrays) ──
const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);
const dens = new Float32Array(MAX); // Σ m/r² accumulated during the force walk

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

// ── runtime ──
let renderer, scene, camera, controls, mesh;
let postProcessing, scenePass, afterImageNode = null, bloomNode = null, rttNode = null;
let instPos, instVel, instDens; // InstancedBufferAttributes streamed each frame

// standard normal (Box-Muller)
function gauss() {
	let u = 0, v = 0;
	while (u === 0) u = Math.random();
	while (v === 0) v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// shared disk kinematics: z-profile + circular orbit velocity at (gx, gy)
function placeDiskParticle(i, gx, gy, zThin, zBulge, sigmaBulge) {
	const r = Math.sqrt(gx * gx + gy * gy);
	px[i] = gx; py[i] = gy;
	const bulge = Math.exp(-r * r / (2 * sigmaBulge * sigmaBulge));
	pz[i] = gauss() * (zThin + zBulge * bulge);
	const rDir = r < 0.001 ? 0.001 : r;            // avoid div-by-zero at the center
	const rVel = Math.max(r, DISK_R * 0.05);        // floor speed near the center
	// circular orbital speed around the core, tangential (-y, x)/r, + small jitter
	const vc = Math.sqrt(G * coreMass / (rVel + coreSoft)) * spin;
	vx[i] = (-gy / rDir) * vc + gauss() * vc * 0.03;
	vy[i] = (gx / rDir) * vc + gauss() * vc * 0.03;
	vz[i] = gauss() * vc * 0.02; // small vertical dispersion
	parts[i].mass = massEach;
}

function initDisk() {
	const sigmaXY = DISK_R * 0.5;    // in-plane bell spread (≈ DISK_R at 2σ)
	const zThin = DISK_R * 0.025;    // thin disk thickness (≈ radius / 40)
	const zBulge = DISK_R * 0.10;    // extra height in the central bulge
	const sigmaBulge = DISK_R * 0.3; // radial extent of the bulge
	for (let i = 0; i < count; i++) {
		// bell-shaped (Gaussian) blob: dense core, sparse edges
		placeDiskParticle(i, gauss() * sigmaXY, gauss() * sigmaXY, zThin, zBulge, sigmaBulge);
	}
}

function initSpiral() {
	// grand-design two-arm logarithmic spiral: rejection-sample the disk against a
	// density wave cos(m·(θ − ln(r/r0)/tanPitch)), m = 2, pitch ≈ 20°
	const sigmaXY = DISK_R * 0.55;
	const zThin = DISK_R * 0.025;
	const zBulge = DISK_R * 0.10;
	const sigmaBulge = DISK_R * 0.3;
	const tanPitch = Math.tan(20 * Math.PI / 180);
	const r0 = DISK_R * 0.08;
	for (let i = 0; i < count; i++) {
		let gx = 0, gy = 0, tries = 0;
		for (; tries < 40; tries++) {
			gx = gauss() * sigmaXY; gy = gauss() * sigmaXY;
			const r = Math.sqrt(gx * gx + gy * gy);
			if (r < DISK_R * 0.12) break; // central bulge: no arm structure
			const ang = Math.atan2(gy, gx);
			const w = Math.cos(2 * (ang - Math.log(r / r0) / tanPitch));
			const p = 0.22 + 0.78 * Math.pow(0.5 + 0.5 * w, 2);
			if (Math.random() < p) break;
		}
		placeDiskParticle(i, gx, gy, zThin, zBulge, sigmaBulge);
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
	}
	const cx = (mnx + mxx) * 0.5, cy = (mny + mxy) * 0.5, cz = (mnz + mxz) * 0.5;
	const half = Math.max(mxx - mnx, mxy - mny, mxz - mnz) * 0.5 + 10;
	tree.reset(cx - half, cy - half, cz - half, 2 * half);
	for (let i = 0; i < count; i++) tree.insert(parts[i]);
	flattenTree();

	const coreSoft2 = coreSoft * coreSoft;
	const theta2 = theta * theta;
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
		// central core at the origin
		const inv = 1 / Math.sqrt(xi * xi + yi * yi + zi * zi + coreSoft2);
		const cf = G * coreMass * inv * inv * inv;
		ax -= cf * xi; ay -= cf * yi; az -= cf * zi;
		// symplectic Euler: kick then drift
		vx[i] += ax * dt; vy[i] += ay * dt; vz[i] += az * dt;
		px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
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
	mesh.count = count;
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
		parts[i].mass = massEach;
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
		parts[i].mass = massEach;
	}
}

function initGalaxyCollision() {
	const half = Math.floor(count / 2);
	const sigmaXY = DISK_R * 0.35;
	const zThin = DISK_R * 0.02;
	const zBulge = DISK_R * 0.08;
	const sigmaBulge = DISK_R * 0.25;
	const offsetX = DISK_R * 1.5;
	const Geff = Math.max(G, 1);
	const approachSpeed = Math.sqrt(Geff * coreMass / (offsetX * 2 + coreSoft)) * 0.6;
	for (let pass = 0; pass < 2; pass++) {
		const start = pass === 0 ? 0 : half;
		const end = pass === 0 ? half : count;
		const ox = pass === 0 ? -offsetX : offsetX;
		const spinDir = pass === 0 ? 1.0 : -1.0;
		const bulkVx = pass === 0 ? approachSpeed : -approachSpeed;
		for (let i = start; i < end; i++) {
			const gx = gauss() * sigmaXY, gy = gauss() * sigmaXY;
			const r = Math.sqrt(gx * gx + gy * gy);
			px[i] = ox + gx; py[i] = gy;
			const bulge = Math.exp(-r * r / (2 * sigmaBulge * sigmaBulge));
			pz[i] = gauss() * (zThin + zBulge * bulge);
			const rDir = r < 0.001 ? 0.001 : r;
			const rVel = Math.max(r, DISK_R * 0.05);
			const vc = Math.sqrt(Geff * coreMass / (rVel + coreSoft)) * spin * spinDir;
			vx[i] = bulkVx + (-gy / rDir) * vc;
			vy[i] = (gx / rDir) * vc;
			vz[i] = gauss() * Math.abs(vc) * 0.02;
			parts[i].mass = massEach;
		}
	}
}

// ── cinematic camera ──
// per-preset framings the camera eases toward on preset switch
const FRAMINGS = {
	disk: [80, 350, 600],
	spiral: [0, 150, 720],
	ring: [120, 420, 620],
	collapse: [350, 260, 650],
	galaxy: [0, 520, 880]
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
	reset();
	if (FRAMINGS[name]) startCamTween(FRAMINGS[name]);
}

function reset() {
	if (currentPreset === 'ring') initRing();
	else if (currentPreset === 'collapse') initCollapse();
	else if (currentPreset === 'galaxy') initGalaxyCollision();
	else if (currentPreset === 'spiral') initSpiral();
	else initDisk();
	dens.fill(0, 0, count);
}

function setCount(n) {
	count = n;
	massEach = BASE_DISK_MASS / n;
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

// ── core: animated accretion glow + black-hole mode at high core mass ──
let bhGroup = null;
const BH_THRESHOLD = 30000;

function createCore() {
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
	scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 32), innerMat));

	// halo sphere: slow opacity pulse
	const haloMat = new THREE.MeshBasicNodeMaterial({
		transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
	});
	haloMat.colorNode = color(0xffae5a);
	haloMat.opacityNode = float(0.10).add(time.mul(0.7).sin().mul(0.04));
	scene.add(new THREE.Mesh(new THREE.SphereGeometry(30, 16, 16), haloMat));

	// camera-facing lens-flare sprite: the dot gradient reused at large scale
	const flare = new THREE.Sprite(new THREE.SpriteMaterial({
		map: starTexture, color: 0xffe7c0, transparent: true, opacity: 0.05,
		blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
	}));
	flare.scale.set(480, 480, 1);
	scene.add(flare);

	// black-hole mode (high core mass): dark disc + hot photon ring
	bhGroup = new THREE.Group();
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
	scene.add(bhGroup);
	updateCoreMode();
}

function updateCoreMode() {
	if (bhGroup) bhGroup.visible = coreMass >= BH_THRESHOLD;
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

	// camera-facing gaussian splat billboards; position/velocity/density streamed
	// from the CPU each frame, size/hue variation static per particle
	const geometry = new THREE.PlaneGeometry(2, 2); // 2 tris/particle; oriented in-shader
	instPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
	instVel = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
	instDens = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
	// static per-particle variation: x = log-normal size scale, y = hue jitter
	const varArr = new Float32Array(MAX * 2);
	for (let i = 0; i < MAX; i++) {
		varArr[2 * i] = Math.min(Math.max(Math.exp(gauss() * 0.5), 0.4), 4.0);
		varArr[2 * i + 1] = (Math.random() - 0.5) * 0.1;
	}
	const instVar = new THREE.InstancedBufferAttribute(varArr, 2);
	geometry.setAttribute('instPos', instPos);
	geometry.setAttribute('instVel', instVel);
	geometry.setAttribute('instDens', instDens);
	geometry.setAttribute('instVar', instVar);

	const ivel = attribute('instVel', 'vec3');
	const ivar = attribute('instVar', 'vec2');
	// velocity projected onto the billboard plane → long-exposure stretch direction
	const velPlane = vec2(ivel.dot(camRightU), ivel.dot(camUpU));
	const speedPlane = velPlane.length();
	const stretchAmt = speedPlane.mul(streakU).min(4.0);

	const material = new THREE.MeshBasicNodeMaterial();
	material.positionNode = Fn(() => {
		const xy = positionLocal.xy.mul(sizeU.mul(ivar.x));
		const dir = velPlane.div(speedPlane.max(0.0001));
		const stretched = xy.add(dir.mul(xy.dot(dir)).mul(stretchAmt));
		return attribute('instPos', 'vec3')
			.add(camRightU.mul(stretched.x))
			.add(camUpU.mul(stretched.y));
	})();
	material.colorNode = Fn(() => {
		const s = ivel.length().mul(speedScale).add(ivar.y).saturate();
		// 3-stop ramp: royal blue (slow) → teal (mid) → warm gold (fast)
		const t1 = s.mul(2.0).saturate();
		const t2 = s.sub(0.5).mul(2.0).saturate();
		const attract = mix(mix(color(0x2a4cc0), color(0x3fe0d0), t1), color(0xffe7a0), t2);
		const repulse = mix(color(0x6a2cff), color(0xff3ce0), s);
		const ramp = mix(repulse, attract, gSignU);
		// local density → brightness: clumps and the core glow hot, halo stays faint
		const b = attribute('instDens', 'float').mul(densNormU).saturate().pow(0.5);
		return ramp.mul(b.mul(1.3).add(0.45));
	})();
	material.opacityNode = Fn(() => {
		// gaussian point-spread falloff over the quad, zeroed at the edge
		const d = uv().mul(2.0).sub(1.0);
		const alpha = d.dot(d).mul(-4.5).exp().sub(0.011).max(0.0);
		// dim long streaks: same light spread over more pixels
		return alpha.div(stretchAmt.mul(0.5).add(1.0));
	})();
	material.transparent = true;
	material.depthWrite = false;
	material.blending = THREE.AdditiveBlending;

	mesh = new THREE.InstancedMesh(geometry, material, MAX);
	mesh.frustumCulled = false;
	// instanceMatrix is zero-filled by default (collapses to origin); set identity —
	// real placement happens in positionNode via the instPos attribute.
	const idMat = new THREE.Matrix4();
	for (let i = 0; i < MAX; i++) mesh.setMatrixAt(i, idMat);
	mesh.instanceMatrix.needsUpdate = true;
	scene.add(mesh);

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
	renderer.setAnimationLoop(animate);
}

// ── post chain: scene → afterimage trails → bloom → CA → grade/vignette/grain ──
function buildPost() {
	if (afterImageNode) { afterImageNode.dispose?.(); afterImageNode = null; }
	if (bloomNode) { bloomNode.dispose?.(); bloomNode = null; }
	if (rttNode) { rttNode.dispose?.(); rttNode = null; }

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
	// chromatic aberration needs to resample the composite → render it to a texture.
	// On sub-pixel splats a full-frame shift dissolves dots into r/g/b triplets, so
	// the shifted version is blended in toward the frame edges only.
	const comp = rttNode = rtt(node);
	const shifted = rgbShift(comp, 0.0012);
	postProcessing.outputNode = Fn(() => {
		const d = screenUV.sub(0.5).length();
		const caMask = smoothstep(0.30, 0.75, d).mul(0.8);
		const col = mix(comp.rgb, shifted.rgb, caMask).toVar();
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
	postProcessing.needsUpdate = true;
}

// ── FPS badge ──
let frames = 0, fpsLast = Date.now();

async function animate() {
	const now = Date.now();
	if (!paused) step();
	uploadInstances();
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
	const k = Math.sqrt(G * coreMass / DISK_R) * 0.8; // ~comparable to orbital speed
	for (let i = 0; i < count; i++) {
		const x = px[i], y = py[i];
		const inv = 1 / (Math.sqrt(x * x + y * y) + 0.001);
		vx[i] += x * inv * k; vy[i] += y * inv * k;
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
	bindNum('coreSlider', 'coreValue', v => { coreMass = v; updateCoreMode(); }, v => v.toLocaleString());
	bindNum('spinSlider', 'spinValue', v => spin = v, v => v.toFixed(2));
	bindNum('softSlider', 'softValue', v => coreSoft = v, v => v.toFixed(0));
	bindNum('dtSlider', 'dtValue', v => dt = v, v => v.toFixed(3));
	bindNum('sizeSlider', 'sizeValue', v => sizeU.value = v, v => v.toFixed(1));
	bindNum('thetaSlider', 'thetaValue', v => theta = v, v => v.toFixed(2));
	bindNum('streakSlider', 'streakValue', v => streakU.value = v, v => v === 0 ? 'Off' : v.toFixed(3));
	bindNum('trailSlider', 'trailValue', v => {
		const wasOn = trailFade > 0;
		trailFade = v;
		if ((v > 0) !== wasOn) buildPost();
		else if (afterImageNode && afterImageNode.damp) afterImageNode.damp.value = v;
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
	updateGColors(G);
	document.getElementById('burstButton').addEventListener('click', burst);
	const bloomBtn = document.getElementById('bloomButton');
	const bloomLabels = ['Bloom: Off', 'Bloom: Low', 'Bloom: High'];
	bloomBtn.addEventListener('click', () => {
		bloomMode = (bloomMode + 1) % 3;
		bloomBtn.textContent = bloomLabels[bloomMode];
		buildPost();
	});
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
