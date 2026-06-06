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
import { Fn, attribute, positionLocal, uniform, color, pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
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
const sizeU = uniform(3.0);        // particle sphere radius, sim (pixel-scale) units
const speedScale = uniform(0.0125); // maps speed → color ramp
const gSignU = uniform(1.0);        // 1 = attractive (blue-orange), 0 = repulsive (cyan-magenta)

// ── runtime ──
let renderer, scene, camera, controls, mesh;
let postProcessing, scenePass, bloomNode, bloomOn = true;
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
	const theta2 = theta * theta;
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

let currentPreset = 'disk';

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

function applyPreset(name) {
	currentPreset = name;
	reset();
}

function reset() {
	if (currentPreset === 'ring') initRing();
	else if (currentPreset === 'collapse') initCollapse();
	else if (currentPreset === 'galaxy') initGalaxyCollision();
	else initDisk();
}

function setCount(n) {
	count = n;
	massEach = BASE_DISK_MASS / n;
	initDisk();
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

function createStarField() {
	const N = 2000;
	const pos = new Float32Array(N * 3);
	for (let i = 0; i < N; i++) {
		const phi   = Math.acos(2 * Math.random() - 1);
		const theta = Math.random() * Math.PI * 2;
		const r     = 2200 + Math.random() * 800;
		pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
		pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
		pos[i * 3 + 2] = r * Math.cos(phi);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	const mat = new THREE.PointsMaterial({
		color: 0xb0a088, size: 2.0, sizeAttenuation: false, transparent: true, opacity: 0.6,
		map: makeDotTexture(), alphaTest: 0.5, depthWrite: false
	});
	scene.add(new THREE.Points(geo, mat));
}

function createBackdrop() {
	const N = 6000;
	const pos = new Float32Array(N * 3);
	const col = new Float32Array(N * 3);
	for (let i = 0; i < N; i++) {
		const phi   = Math.acos(2 * Math.random() - 1);
		const theta = Math.random() * Math.PI * 2;
		const r     = 8000 + Math.random() * 3000;  // far shell, inside the 12000 frustum
		pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
		pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
		pos[i * 3 + 2] = r * Math.cos(phi);
		const b = 0.35 + Math.random() * 0.65;       // per-star brightness
		const t = Math.random();                     // tint: cool blue ↔ warm amber
		col[i * 3]     = b * (0.85 + 0.15 * t);
		col[i * 3 + 1] = b * 0.92;
		col[i * 3 + 2] = b * (1.0 - 0.18 * t);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	const mat = new THREE.PointsMaterial({
		size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.9,
		vertexColors: true, map: makeDotTexture(), alphaTest: 0.5, depthWrite: false
	});
	scene.add(new THREE.Points(geo, mat));
}

function createCore() {
	scene.add(new THREE.Mesh(
		new THREE.SphereGeometry(10, 16, 16),
		new THREE.MeshBasicMaterial({
			color: 0xfff4e2, transparent: true, opacity: 0.95,
			blending: THREE.AdditiveBlending, depthWrite: false
		})
	));
	scene.add(new THREE.Mesh(
		new THREE.SphereGeometry(30, 16, 16),
		new THREE.MeshBasicMaterial({
			color: 0xffae5a, transparent: true, opacity: 0.12,
			blending: THREE.AdditiveBlending, depthWrite: false
		})
	));
}

async function init() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0c0908);

	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 12000);
	camera.position.set(80, 350, 600);

	renderer = new THREE.WebGPURenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.domElement.id = 'gpuCanvas';
	document.body.appendChild(renderer.domElement);
	await renderer.init();

	// instanced sphere; per-instance position + speed streamed from the CPU each frame
	const geometry = new THREE.IcosahedronGeometry(1, 1); // round ball; radius scaled in-shader
	instPos   = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
	instSpeed = new THREE.InstancedBufferAttribute(new Float32Array(MAX),     1).setUsage(THREE.DynamicDrawUsage);
	geometry.setAttribute('instPos', instPos);
	geometry.setAttribute('instSpeed', instSpeed);

	const material = new THREE.MeshBasicNodeMaterial();
	material.positionNode = positionLocal.mul(sizeU).add(attribute('instPos', 'vec3'));
	material.colorNode = Fn(() => {
		const s = attribute('instSpeed', 'float').mul(speedScale).saturate();
		// 3-stop ramp: amber (slow) → warm white-hot (mid) → coral (fast) — site gold/coral palette
		const t1 = s.mul(2.0).saturate();
		const t2 = s.sub(0.5).mul(2.0).saturate();
		const attract = color(0x8a4f00).mix(color(0xffe8c6), t1).mix(color(0xff5824), t2);
		const repulse = color(0x00ddff).mix(color(0xee00ff), s);
		return repulse.mix(attract, gSignU);
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

	createBackdrop();
	createStarField();
	createCore();
	postProcessing = new THREE.PostProcessing(renderer);
	scenePass = pass(scene, camera);
	const sceneColor = scenePass.getTextureNode('output');
	bloomNode = sceneColor.add(bloom(sceneColor, 0.15, 0.0, 0.5));
	applyBloom();

	initDisk();
	onWindowResize(onResize);
	wireUI();
	renderer.setAnimationLoop(animate);
}

// ── FPS badge ──
let frames = 0, fpsLast = Date.now();

async function animate() {
	if (!paused) step();
	uploadInstances();
	controls.update();
	await postProcessing.renderAsync();

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

function applyBloom() {
	postProcessing.outputNode = bloomOn ? bloomNode : scenePass;
	postProcessing.needsUpdate = true;
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
	bindNum('coreSlider', 'coreValue', v => coreMass = v, v => v.toLocaleString());
	bindNum('spinSlider', 'spinValue', v => spin = v, v => v.toFixed(2));
	bindNum('softSlider', 'softValue', v => coreSoft = v, v => v.toFixed(0));
	bindNum('dtSlider', 'dtValue', v => dt = v, v => v.toFixed(3));
	bindNum('sizeSlider', 'sizeValue', v => sizeU.value = v, v => v.toFixed(1));
	bindNum('thetaSlider', 'thetaValue', v => theta = v, v => v.toFixed(2));

	const countSl = document.getElementById('countSlider');
	const updateCount = () => {
		const n = Math.max(1, Math.round(Math.pow(10, +countSl.value)));
		setCount(n);
	};
	countSl.addEventListener('input', updateCount);
	updateCount();
	document.getElementById('resetButton').addEventListener('click', reset);
	document.getElementById('presetDisk').addEventListener('click', () => applyPreset('disk'));
	document.getElementById('presetRing').addEventListener('click', () => applyPreset('ring'));
	document.getElementById('presetCollapse').addEventListener('click', () => applyPreset('collapse'));
	document.getElementById('presetGalaxy').addEventListener('click', () => applyPreset('galaxy'));
	updateGColors(G);
	document.getElementById('burstButton').addEventListener('click', burst);
	const bloomBtn = document.getElementById('bloomButton');
	bloomBtn.addEventListener('click', () => {
		bloomOn = !bloomOn;
		bloomBtn.textContent = bloomOn ? 'Bloom: On' : 'Bloom: Off';
		applyBloom();
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
