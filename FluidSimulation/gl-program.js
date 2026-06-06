// Shader compile + program/material helpers.
// Material compiles per-keyword-set variants on demand (used by the display shader).

export function compileShader(gl, type, source, keywords) {
	source = addKeywords(source, keywords);
	const shader = gl.createShader(type);
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
		console.error(gl.getShaderInfoLog(shader), source);
	return shader;
}

function addKeywords(source, keywords) {
	if (!keywords) return source;
	let prefix = '';
	for (const k of keywords) prefix += '#define ' + k + '\n';
	return prefix + source;
}

export function createProgram(gl, vertexShader, fragmentShader) {
	const program = gl.createProgram();
	gl.attachShader(program, vertexShader);
	gl.attachShader(program, fragmentShader);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS))
		console.error(gl.getProgramInfoLog(program));
	return program;
}

export function getUniforms(gl, program) {
	const uniforms = {};
	const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
	for (let i = 0; i < count; i++) {
		const name = gl.getActiveUniform(program, i).name;
		uniforms[name] = gl.getUniformLocation(program, name);
	}
	return uniforms;
}

export class Program {
	constructor(gl, vertexShader, fragmentShader) {
		this.gl = gl;
		this.program = createProgram(gl, vertexShader, fragmentShader);
		this.uniforms = getUniforms(gl, this.program);
	}
	bind() { this.gl.useProgram(this.program); }
}

// Recompiles fragment variants keyed by their #define keyword set.
export class Material {
	constructor(gl, vertexShader, fragmentShaderSource) {
		this.gl = gl;
		this.vertexShader = vertexShader;
		this.fragmentShaderSource = fragmentShaderSource;
		this.programs = {};
		this.activeProgram = null;
		this.uniforms = {};
	}
	setKeywords(keywords) {
		let hash = 0;
		for (const k of keywords) hash += hashCode(k);
		let program = this.programs[hash];
		if (program == null) {
			const fs = compileShader(this.gl, this.gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
			program = createProgram(this.gl, this.vertexShader, fs);
			this.programs[hash] = program;
		}
		if (program === this.activeProgram) return;
		this.uniforms = getUniforms(this.gl, program);
		this.activeProgram = program;
	}
	bind() { this.gl.useProgram(this.activeProgram); }
}

function hashCode(s) {
	let hash = 0;
	for (let i = 0; i < s.length; i++) {
		hash = (hash << 5) - hash + s.charCodeAt(i);
		hash |= 0;
	}
	return hash;
}
