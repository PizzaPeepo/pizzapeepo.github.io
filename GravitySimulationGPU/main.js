// GPU N-body gravity — Three.js WebGPU + TSL compute.
// Each particle is one GPU thread; the update shader loops over ALL particles
// (all-pairs O(n²)) plus a central core mass, integrates with symplectic Euler.
// Positions/velocities live in storage buffers and never round-trip to the CPU —
// the points material reads them straight from the buffer (material.positionNode).

import * as THREE from 'three/webgpu';
import {
	Fn, Loop, instancedArray, instanceIndex, positionLocal, uniform, vec3, color, hash
} from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── config ──
const MAX = 65536;              // buffers sized to the largest selectable count
const baseMass = 2000;          // total disk mass; per-particle mass = baseMass / count

// ── storage buffers (read-write on GPU) ──
const positions = instancedArray(MAX, 'vec3');
const velocities = instancedArray(MAX, 'vec3');

// ── uniforms (live-tunable from the HUD) ──
const dtU = uniform(0.005);
const G = uniform(1.0);
const coreMass = uniform(4000.0);
const spin = uniform(1.0);
const soft = uniform(0.6);
const massEach = uniform(baseMass / 16384);
const pointSize = uniform(0.18); // sphere radius in world units
const diskRadius = uniform(18.0);
const speedScale = uniform(0.045);
const burstStrength = uniform(12.0);

// ── mutable runtime state ──
let renderer, scene, camera, controls, points;
let computeInit, computeUpdate, computeBurst;
let count = 16384;
let paused = false;

// Build the three compute kernels for a given particle count. Rebuilt whenever the
// count changes because the all-pairs Loop bound and the dispatch size are baked in.
function buildCompute(n) {
	// disk: area-uniform radius (sqrt), random angle, thin z, circular orbital velocity
	computeInit = Fn(() => {
		const pos = positions.element(instanceIndex);
		const vel = velocities.element(instanceIndex);

		const rMin = diskRadius.mul(0.04);
		const r = hash(instanceIndex).sqrt().mul(diskRadius.sub(rMin)).add(rMin);
		const ang = hash(instanceIndex.add(1)).mul(Math.PI * 2);
		const cs = ang.cos();
		const sn = ang.sin();
		const z = hash(instanceIndex.add(2)).sub(0.5).mul(diskRadius.mul(0.06));
		pos.assign(vec3(cs.mul(r), sn.mul(r), z));

		// v_circular ≈ sqrt(G·coreMass / r), tangential (-sin, cos, 0), + small jitter
		const vc = G.mul(coreMass).div(r.add(soft)).sqrt().mul(spin);
		const jitter = vec3(
			hash(instanceIndex.add(3)).sub(0.5),
			hash(instanceIndex.add(4)).sub(0.5),
			hash(instanceIndex.add(5)).sub(0.5)
		).mul(vc.mul(0.05));
		vel.assign(vec3(sn.negate(), cs, 0).mul(vc).add(jitter));
	})().compute(n);

	computeUpdate = Fn(() => {
		const pos = positions.element(instanceIndex);
		const vel = velocities.element(instanceIndex);
		const soft2 = soft.mul(soft);
		const acc = vec3(0).toVar();

		// central core at the origin
		const cd2 = pos.dot(pos).add(soft2);
		const ci = cd2.inverseSqrt();
		acc.addAssign(pos.negate().mul(G.mul(coreMass).mul(ci.mul(ci).mul(ci))));

		// mutual gravity, all pairs. Self term (i == instanceIndex) has d = 0 → adds 0.
		const gm = G.mul(massEach); // loop-invariant — hoisted out of the inner loop
		Loop(n, ({ i }) => {
			const d = positions.element(i).sub(pos);
			const dist2 = d.dot(d).add(soft2);
			const inv = dist2.inverseSqrt();
			acc.addAssign(d.mul(gm.mul(inv.mul(inv).mul(inv))));
		});

		// symplectic Euler: kick then drift
		vel.addAssign(acc.mul(dtU));
		pos.addAssign(vel.mul(dtU));
	})().compute(n, [256]);

	// one-shot outward velocity kick
	computeBurst = Fn(() => {
		const pos = positions.element(instanceIndex);
		const vel = velocities.element(instanceIndex);
		const dir = pos.div(pos.length().add(0.001)); // safe normalize near origin
		vel.addAssign(dir.mul(burstStrength));
	})().compute(n);
}

function reset() {
	renderer.compute(computeInit);
}

function setCount(n) {
	count = n;
	massEach.value = baseMass / n;
	buildCompute(n);
	if (points) points.count = n;
	renderer.compute(computeInit);
	document.getElementById('countValue').textContent = n.toLocaleString();
}

async function init() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0x06060d);

	camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
	camera.position.set(0, 32, 62);

	renderer = new THREE.WebGPURenderer({ antialias: true });
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.domElement.id = 'gpuCanvas';
	document.body.appendChild(renderer.domElement);
	await renderer.init();

	// WebGPU point primitives are locked to 1px, so size must come from real geometry:
	// an instanced low-poly sphere, placed at the buffer position and scaled by a uniform.
	const geometry = new THREE.IcosahedronGeometry(1, 0); // 20 tris; radius scaled in-shader

	const material = new THREE.MeshBasicNodeMaterial();
	// local sphere vertex * radius, translated to this particle's simulated position
	material.positionNode = positionLocal.mul(pointSize).add(positions.element(instanceIndex));
	material.colorNode = Fn(() => {
		const sp = velocities.element(instanceIndex).length().mul(speedScale).saturate();
		const base = color(0x1b4fff).mix(color(0xff7a1a), sp); // blue → orange by speed
		return base.mix(color(0xffffff), sp.mul(sp).mul(0.7));  // white-hot at the top end
	})();
	material.transparent = true;
	material.depthWrite = false;
	material.blending = THREE.AdditiveBlending;

	points = new THREE.InstancedMesh(geometry, material, MAX);
	points.count = count;           // draw only the active particles
	points.frustumCulled = false;
	// default instanceMatrix is zero-filled (collapses to origin); set identity —
	// actual placement is done in positionNode above.
	const idMat = new THREE.Matrix4();
	for (let i = 0; i < MAX; i++) points.setMatrixAt(i, idMat);
	points.instanceMatrix.needsUpdate = true;
	scene.add(points);

	controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.target.set(0, 0, 0);

	buildCompute(count);
	renderer.compute(computeInit);

	window.addEventListener('resize', onResize);
	wireUI();
	renderer.setAnimationLoop(animate);
}

// ── FPS badge (Date.now deltas, same idea as the CPU demos) ──
let frames = 0, fpsLast = Date.now();
const fpsEl = () => document.getElementById('fpsValue');

function animate() {
	if (!paused) renderer.compute(computeUpdate);
	controls.update();
	renderer.render(scene, camera);

	frames++;
	const now = Date.now();
	if (now - fpsLast >= 500) {
		fpsEl().textContent = Math.round((frames * 1000) / (now - fpsLast));
		frames = 0;
		fpsLast = now;
	}
}

function onResize() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
}

function wireUI() {
	const bind = (id, valId, u, fmt) => {
		const s = document.getElementById(id);
		const out = document.getElementById(valId);
		const show = () => { out.textContent = fmt ? fmt(+s.value) : s.value; };
		s.addEventListener('input', () => { u.value = +s.value; show(); });
		show();
	};
	bind('gravSlider', 'gravValue', G, v => v.toFixed(2));
	bind('coreSlider', 'coreValue', coreMass, v => v.toLocaleString());
	bind('spinSlider', 'spinValue', spin, v => v.toFixed(2));
	bind('softSlider', 'softValue', soft, v => v.toFixed(2));
	bind('dtSlider', 'dtValue', dtU, v => v.toFixed(4));
	bind('sizeSlider', 'sizeValue', pointSize, v => v.toFixed(2));

	document.getElementById('countSelect').addEventListener('change', e => setCount(+e.target.value));
	document.getElementById('countValue').textContent = count.toLocaleString();

	document.getElementById('resetButton').addEventListener('click', reset);
	document.getElementById('burstButton').addEventListener('click', () => renderer.compute(computeBurst));
	const pauseBtn = document.getElementById('pauseButton');
	pauseBtn.addEventListener('click', () => {
		paused = !paused;
		pauseBtn.textContent = paused ? 'Resume' : 'Pause';
	});

	window.addEventListener('keydown', e => {
		if (e.code === 'Space') { e.preventDefault(); pauseBtn.click(); }
		else if (e.code === 'KeyR') reset();
		else if (e.code === 'KeyB') renderer.compute(computeBurst);
	});
}

// WebGPU gate: bail to the overlay (which links to the CPU demo) if unsupported.
if (typeof navigator !== 'undefined' && navigator.gpu) {
	init().catch(err => {
		console.error('GPU gravity init failed:', err);
		document.getElementById('webgpuError').style.display = 'flex';
	});
} else {
	document.getElementById('webgpuError').style.display = 'flex';
}
