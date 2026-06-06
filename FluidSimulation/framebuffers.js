// Framebuffer helpers: render-target format detection, single + double (ping-pong) FBOs,
// a fullscreen-quad blit, and a procedural dithering-noise texture.

export function getSupportedFormat(gl, internalFormat, format, type) {
	if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
		switch (internalFormat) {
			case gl.R16F:  return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
			case gl.RG16F: return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
			default:       return null;
		}
	}
	return { internalFormat, format };
}

function supportRenderTextureFormat(gl, internalFormat, format, type) {
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
	const fbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
	gl.deleteFramebuffer(fbo);
	gl.deleteTexture(texture);
	return status === gl.FRAMEBUFFER_COMPLETE;
}

export function createFBO(gl, w, h, internalFormat, format, type, param) {
	gl.activeTexture(gl.TEXTURE0);
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

	const fbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
	gl.viewport(0, 0, w, h);
	gl.clear(gl.COLOR_BUFFER_BIT);

	return {
		texture, fbo, width: w, height: h,
		texelSizeX: 1.0 / w, texelSizeY: 1.0 / h,
		attach(id) {
			gl.activeTexture(gl.TEXTURE0 + id);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			return id;
		},
	};
}

export function createDoubleFBO(gl, w, h, internalFormat, format, type, param) {
	let fbo1 = createFBO(gl, w, h, internalFormat, format, type, param);
	let fbo2 = createFBO(gl, w, h, internalFormat, format, type, param);
	return {
		width: w, height: h, texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
		get read() { return fbo1; },
		set read(v) { fbo1 = v; },
		get write() { return fbo2; },
		set write(v) { fbo2 = v; },
		swap() { const t = fbo1; fbo1 = fbo2; fbo2 = t; },
	};
}

// Resize a double FBO by copying its contents into freshly-sized targets.
export function resizeDoubleFBO(gl, blit, copyProgram, target, w, h, internalFormat, format, type, param) {
	if (target.width === w && target.height === h) return target;
	target.read = resizeFBO(gl, blit, copyProgram, target.read, w, h, internalFormat, format, type, param);
	target.write = createFBO(gl, w, h, internalFormat, format, type, param);
	target.width = w; target.height = h;
	target.texelSizeX = 1.0 / w; target.texelSizeY = 1.0 / h;
	return target;
}

function resizeFBO(gl, blit, copyProgram, target, w, h, internalFormat, format, type, param) {
	const newFBO = createFBO(gl, w, h, internalFormat, format, type, param);
	copyProgram.bind();
	gl.uniform1i(copyProgram.uniforms.uTexture, target.attach(0));
	blit(newFBO);
	return newFBO;
}

// Fullscreen-quad draw. Returns blit(target, clear?); target null = default framebuffer.
export function createBlit(gl) {
	gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
	gl.enableVertexAttribArray(0);

	return (target, clear = false) => {
		if (target == null) {
			gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		} else {
			gl.viewport(0, 0, target.width, target.height);
			gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
		}
		if (clear) {
			gl.clearColor(0.0, 0.0, 0.0, 1.0);
			gl.clear(gl.COLOR_BUFFER_BIT);
		}
		gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
	};
}

// Small repeating RGBA noise texture for bloom dithering (avoids an external asset).
export function createNoiseTexture(gl, size = 256) {
	const data = new Uint8Array(size * size * 4);
	for (let i = 0; i < data.length; i++) data[i] = Math.floor(Math.random() * 256);
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	return {
		texture, width: size, height: size,
		attach(id) {
			gl.activeTexture(gl.TEXTURE0 + id);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			return id;
		},
	};
}
