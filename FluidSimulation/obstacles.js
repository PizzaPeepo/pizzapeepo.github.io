// Obstacle presets + stamp helper. Shapes are SDF primitives rasterised into the
// obstacle mask (a double FBO, 1 = solid) by the obstacleStamp shader in glsl.js.
//
// Coordinates are normalised [0,1]; the shader scales x by aspectRatio, so radii /
// half-extents are in height-normalised units. shape: 0 circle, 1 box, 2 capsule.
// size: circle [r,0] · box [halfX,halfY] · capsule [halfLen,r].

export const PRESETS = {
	cylinder: [
		{ shape: 0, point: [0.30, 0.5], size: [0.085, 0.0], angle: 0 },
	],
	airfoil: [
		{ shape: 2, point: [0.40, 0.5], size: [0.14, 0.03], angle: -0.20 },
	],
	slit: [
		{ shape: 1, point: [0.5, 0.88], size: [0.012, 0.14], angle: 0 },
		{ shape: 1, point: [0.5, 0.50], size: [0.012, 0.11], angle: 0 },
		{ shape: 1, point: [0.5, 0.12], size: [0.012, 0.14], angle: 0 },
	],
	funnel: [
		{ shape: 2, point: [0.55, 0.28], size: [0.24, 0.016], angle: 0.55 },
		{ shape: 2, point: [0.55, 0.72], size: [0.24, 0.016], angle: -0.55 },
	],
};

// Stamp one shape into the mask. `program` is the compiled obstacleStamp Program.
export function stampShape(gl, program, blit, mask, aspect, s, erase) {
	program.bind();
	gl.uniform1i(program.uniforms.uTarget, mask.read.attach(0));
	gl.uniform1f(program.uniforms.aspectRatio, aspect);
	gl.uniform2f(program.uniforms.uPoint, s.point[0], s.point[1]);
	gl.uniform2f(program.uniforms.uSize, s.size[0], s.size[1]);
	gl.uniform1f(program.uniforms.uAngle, s.angle || 0);
	gl.uniform1i(program.uniforms.uShape, s.shape);
	gl.uniform1f(program.uniforms.uErase, erase ? 1 : 0);
	blit(mask.write);
	mask.swap();
}

// Paint a circular brush at a normalised point (used by pointer paint/erase).
export function paintBrush(gl, program, blit, mask, aspect, x, y, radius, erase) {
	stampShape(gl, program, blit, mask, aspect,
		{ shape: 0, point: [x, y], size: [radius, 0], angle: 0 }, erase);
}

// Replace the mask with a named preset. `clearMask` zeroes the mask first.
export function applyPreset(gl, program, blit, mask, aspect, name, clearMask) {
	clearMask();
	const shapes = PRESETS[name];
	if (!shapes) return;
	for (const s of shapes) stampShape(gl, program, blit, mask, aspect, s, false);
}
