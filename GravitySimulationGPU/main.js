// Barnes-Hut N-body — CPU tree, GPU render.
//
// Force evaluation uses the project's existing, tested Barnes-Hut quadtree
// (../GravitySimulation/BarnesHutTree.js): O(n log n) instead of the brute-force
// O(n²) all-pairs the first GPU version used. The tree is built and walked on the
// CPU each frame; the GPU's job is to draw the result — particle positions are
// streamed into an InstancedMesh via a dynamic instanced attribute (one-way upload,
// no GPU→CPU readback). Physics is 2D (the tree is a quadtree); z is a fixed thin
// scatter so the disk reads as 3D when you orbit it.
//
// The tree's softening/min-cell constants are tuned for ~800px space, so we simulate
// in that pixel-scale and frame the camera to it — that lets us reuse the tree as-is.

import * as THREE from 'three/webgpu';
import { Fn, attribute, positionLocal, uniform, color } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BarnesHutTree } from '../GravitySimulation/BarnesHutTree.js';

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
const vx = new Float32Array(MAX), vy = new Float32Array(MAX);

// persistent particle views the tree consumes ({ position:{x,y}, mass }); reused, no per-frame alloc
const parts = new Array(MAX);
for (let i = 0; i < MAX; i++) parts[i] = { position: { x: 0, y: 0 }, mass: 0 };

// pool sized for ~2 nodes/particle at max count, so the tree never grows mid-run
const tree = new BarnesHutTree(THETA, MAX * 2);

// ── render uniforms ──
const sizeU = uniform(4.0);        // sphere radius, render (= sim) units
const speedScale = uniform(0.0125); // maps speed → color ramp

// ── runtime ──
let renderer, scene, camera, controls, mesh;
let instPos, instSpeed; // InstancedBufferAttributes streamed each frame

function initDisk() {
	const rMin = DISK_R * 0.04;
	for (let i = 0; i < count; i++) {
		const r = Math.sqrt(Math.random()) * (DISK_R - rMin) + rMin;
		const a = Math.random() * Math.PI * 2;
		const cs = Math.cos(a), sn = Math.sin(a);
		px[i] = cs * r; py[i] = sn * r;
		pz[i] = (Math.random() - 0.5) * DISK_R * 0.06;
		// circular orbital speed around the core, tangential, + small jitter
		const vc = Math.sqrt(G * coreMass / (r + coreSoft)) * spin;
		vx[i] = -sn * vc + (Math.random() - 0.5) * vc * 0.05;
		vy[i] = cs * vc + (Math.random() - 0.5) * vc * 0.05;
		parts[i].mass = massEach;
	}
}

function step() {
	// bounds (square, with margin) so every particle sits inside the tree root
	let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
	for (let i = 0; i < count; i++) {
		const x = px[i], y = py[i];
		if (x < mnx) mnx = x; if (x > mxx) mxx = x;
		if (y < mny) mny = y; if (y > mxy) mxy = y;
		parts[i].position.x = x; parts[i].position.y = y;
	}
	const cx = (mnx + mxx) * 0.5, cy = (mny + mxy) * 0.5;
	const s = Math.max(mxx - mnx, mxy - mny) * 0.5 + 10;
	tree.reset(cx - s, cy - s, 2 * s, 2 * s);
	for (let i = 0; i < count; i++) tree.insert(parts[i]);

	const soft2 = coreSoft * coreSoft;
	for (let i = 0; i < count; i++) {
		tree.computeAccelAt(px[i], py[i], parts[i], G);
		let ax = tree._ax, ay = tree._ay;
		// central core at the origin
		const x = px[i], y = py[i];
		const inv = 1 / Math.sqrt(x * x + y * y + soft2);
		const f = G * coreMass * inv * inv * inv;
		ax -= f * x; ay -= f * y;
		// symplectic Euler: kick then drift
		vx[i] += ax * dt; vy[i] += ay * dt;
		px[i] += vx[i] * dt; py[i] += vy[i] * dt;
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
