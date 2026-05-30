// Barnes-Hut N-body galaxy — CPU tree, GPU render, full 3D.
//
// Each frame the CPU builds a Barnes-Hut octree (./Octree.js), flattens it to typed
// arrays, and walks it with a stackless skip-pointer traversal to get 3D forces —
// O(n log n) instead of brute-force O(n²). The GPU only draws: particle positions are
// streamed into an InstancedMesh via a dynamic instanced attribute (one-way upload,
// no GPU→CPU readback). Self-gravity acts on all three axes, so an initially puffy
// cloud collapses toward a midplane and flattens into a disk on its own.
//
// Softening/min-cell constants are tuned for ~800px space, so we simulate in that
// pixel-scale and frame the camera to it.

import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, uniform, color } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Octree } from './Octree.js';

// ── config ──
const MAX = 65536;            // array capacity = largest selectable count
const DISK_R = 300;           // disk radius in sim (pixel-scale) units
const BASE_DISK_MASS = 5000;  // total disk mass; per-particle = BASE_DISK_MASS / count
const THETA = 1.5;            // Barnes-Hut opening angle (higher = faster, looser)

// ── tunables (driven by the HUD) ──
let count = 16384;
let G = 50;
let coreMass = 10000;
let spin = 1.0;
let coreSoft = 8.0;
let dt = 0.01;
let paused = false;
let massEach = BASE_DISK_MASS / count;

// ── CPU particle state (structure-of-arrays) ──
const px = new Float32Array(MAX), py = new Float32Array(MAX), pz = new Float32Array(MAX);
const vx = new Float32Array(MAX), vy = new Float32Array(MAX), vz = new Float32Array(MAX);

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
const sizeU = uniform(4.0);        // sphere radius, render (= sim) units
const speedScale = uniform(0.0125); // maps speed → color ramp

// ── runtime ──
let renderer, scene, camera, controls, mesh;
let instPos, instSpeed; // InstancedBufferAttributes streamed each frame

// standard normal (Box-Muller)
function gauss() {
	let u = 0, v = 0;
	while (u === 0) u = Math.random();
	while (v === 0) v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function initDisk() {
	const sigmaXY = DISK_R * 0.5;    // in-plane bell spread (≈ DISK_R at 2σ)
	const zThin = DISK_R * 0.025;    // thin disk thickness (≈ radius / 40)
	const zBulge = DISK_R * 0.10;    // extra height in the central bulge
	const sigmaBulge = DISK_R * 0.3; // radial extent of the bulge
	for (let i = 0; i < count; i++) {
		// bell-shaped (Gaussian) blob: dense core, sparse edges
		const gx = gauss() * sigmaXY, gy = gauss() * sigmaXY;
		const r = Math.sqrt(gx * gx + gy * gy);
		px[i] = gx; py[i] = gy;
		// thin disk + rounder central bulge → galaxy profile
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
	const theta2 = THETA * THETA;
	const n = nNodes;
	for (let i = 0; i < count; i++) {
		const xi = px[i], yi = py[i], zi = pz[i];
		let ax = 0, ay = 0, az = 0, idx = 0;
		// stackless Barnes-Hut walk: accept a node (leaf, or far enough by θ) and skip
		// its subtree; otherwise open it (first child is the next array entry).
		while (idx < n) {
			const dx = tComX[idx] - xi, dy = tComY[idx] - yi, dz = tComZ[idx] - zi;
			const d2 = dx * dx + dy * dy + dz * dz;
			const sz = tSize[idx]; // < 0 marks a leaf
			if (sz < 0 || sz * sz < theta2 * d2) {
				const r2s = d2 + 25; // BH softening² (matches the tree's 5px)
				const f = G * tMass[idx] / (r2s * Math.sqrt(r2s));
				ax += f * dx; ay += f * dy; az += f * dz;
				idx = tSkip[idx];
			} else {
				idx++;
			}
		}
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
	const p = instPos.array, sp = instSpeed.array;
	for (let i = 0; i < count; i++) {
		p[3 * i] = px[i]; p[3 * i + 1] = py[i]; p[3 * i + 2] = pz[i];
		sp[i] = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
	}
	instPos.needsUpdate = true;
	instSpeed.needsUpdate = true;
	mesh.count = count;
}

function reset() { initDisk(); }

function setCount(n) {
	count = n;
	massEach = BASE_DISK_MASS / n;
	initDisk();
	document.getElementById('countValue').textContent = n.toLocaleString();
}

async function init() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x06060d);

	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 6000);
	camera.position.set(0, 380, 640);

	renderer = new THREE.WebGPURenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.domElement.id = 'gpuCanvas';
	document.body.appendChild(renderer.domElement);
	await renderer.init();

	// instanced sphere; per-instance position + speed streamed from the CPU each frame
	const geometry = new THREE.IcosahedronGeometry(1, 0); // 20 tris; radius scaled in-shader
	instPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
	instSpeed = new THREE.InstancedBufferAttribute(new Float32Array(MAX), 1).setUsage(THREE.DynamicDrawUsage);
	geometry.setAttribute('instPos', instPos);
	geometry.setAttribute('instSpeed', instSpeed);

	const material = new THREE.MeshBasicNodeMaterial();
	material.positionNode = positionLocal.mul(sizeU).add(attribute('instPos', 'vec3'));
	material.colorNode = Fn(() => {
		const s = attribute('instSpeed', 'float').mul(speedScale).saturate();
		const base = color(0x1b4fff).mix(color(0xff7a1a), s); // blue → orange by speed
		return base.mix(color(0xffffff), s.mul(s).mul(0.7));    // white-hot at the top end
	})();
	material.transparent = true;
	material.depthWrite = false;
	material.blending = THREE.AdditiveBlending;

	mesh = new THREE.InstancedMesh(geometry, material, MAX);
	mesh.frustumCulled = false;
	// default instanceMatrix is zero-filled (collapses to origin); set identity —
	// placement is done in positionNode via the instPos attribute.
	const idMat = new THREE.Matrix4();
	for (let i = 0; i < MAX; i++) mesh.setMatrixAt(i, idMat);
	mesh.instanceMatrix.needsUpdate = true;
	scene.add(mesh);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;

	initDisk();
	window.addEventListener('resize', onResize);
	wireUI();
	renderer.setAnimationLoop(animate);
}

// ── FPS badge ──
let frames = 0, fpsLast = Date.now();

function animate() {
	if (!paused) step();
	uploadInstances();
	controls.update();
	renderer.render(scene, camera);

	frames++;
	const now = Date.now();
	if (now - fpsLast >= 500) {
		document.getElementById('fpsValue').textContent = Math.round((frames * 1000) / (now - fpsLast));
		frames = 0;
		fpsLast = now;
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
}

function wireUI() {
	const bindNum = (id, valId, set, fmt) => {
		const sl = document.getElementById(id);
		const out = document.getElementById(valId);
		const show = () => { out.textContent = fmt ? fmt(+sl.value) : sl.value; };
		sl.addEventListener('input', () => { set(+sl.value); show(); });
		show();
	};
	bindNum('gravSlider', 'gravValue', v => G = v, v => v.toFixed(0));
	bindNum('coreSlider', 'coreValue', v => coreMass = v, v => v.toLocaleString());
	bindNum('spinSlider', 'spinValue', v => spin = v, v => v.toFixed(2));
	bindNum('softSlider', 'softValue', v => coreSoft = v, v => v.toFixed(0));
	bindNum('dtSlider', 'dtValue', v => dt = v, v => v.toFixed(3));
	bindNum('sizeSlider', 'sizeValue', v => sizeU.value = v, v => v.toFixed(1));

	document.getElementById('countSelect').addEventListener('change', e => setCount(+e.target.value));
	document.getElementById('countValue').textContent = count.toLocaleString();
	document.getElementById('resetButton').addEventListener('click', reset);
	document.getElementById('burstButton').addEventListener('click', burst);
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
