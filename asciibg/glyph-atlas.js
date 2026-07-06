// Web437 glyph-atlas builder for the index ASCII background.
// Extracted from FluidSimulation/main.js (buildAtlas + font load) — exact-pixel
// rules preserved: render at an integer multiple of the font's native 16-grid,
// pen integer-aligned (baseline top/left, SS-snapped), then coverage-threshold
// each SS×SS block down to one texel. Sampled NEAREST end-to-end.

export const ASCII_GP = 16;     // native font grid (px) — 1 font-pixel → 1 texel
export const ASCII_GP_X = 9;    // glyph cell width (Web437 ink is ~9 wide)
export const ASCII_GP_Y = 16;   // glyph cell height
const ASCII_SS = 8;             // supersample factor for the coverage threshold

// Densest two steps ('9@') removed — hottest cells top out at '$8' so the
// lattice never reaches full-block brightness (USER-GPU calm pass).
export const DEFAULT_RAMP = ' ,:;-~=+*ix-/x\\A2-rs/\\-h235A/-\\SGBMH-/\\-#B%$89@';

export function buildAtlas(gl, RAMP, fontFamily) {
	const n = RAMP.length;
	const cellW = ASCII_GP_X * ASCII_SS, cellH = ASCII_GP_Y * ASCII_SS;
	const c = document.createElement('canvas');
	c.width = n * cellW; c.height = cellH;
	const ctx = c.getContext('2d');
	ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
	ctx.fillStyle = '#fff';
	const fpx = ASCII_GP * ASCII_SS;
	ctx.font = fpx + "px " + (fontFamily || "'Web437_ATI_9x16', monospace");
	ctx.textAlign = 'left'; ctx.textBaseline = 'top';
	const offX = Math.round((cellW - ctx.measureText('M').width) / 2 / ASCII_SS) * ASCII_SS;
	const offY = Math.round((ASCII_GP_Y - ASCII_GP) / 2) * ASCII_SS;
	for (let i = 0; i < n; i++) ctx.fillText(RAMP[i], i * cellW + offX, offY);

	// Coverage-threshold the supersampled render down to one GP grid per glyph.
	const src = ctx.getImageData(0, 0, c.width, c.height).data;
	const outW = n * ASCII_GP_X, outH = ASCII_GP_Y;
	const out = document.createElement('canvas');
	out.width = outW; out.height = outH;
	const oimg = out.getContext('2d').createImageData(outW, outH);
	const half = (ASCII_SS * ASCII_SS) / 2;
	for (let oy = 0; oy < outH; oy++) {
		for (let ox = 0; ox < outW; ox++) {
			let litCount = 0;
			for (let sy = 0; sy < ASCII_SS; sy++) {
				for (let sx = 0; sx < ASCII_SS; sx++) {
					if (src[((oy * ASCII_SS + sy) * c.width + (ox * ASCII_SS + sx)) * 4] > 127) litCount++;
				}
			}
			const v = litCount >= half ? 255 : 0;
			const o = (oy * outW + ox) * 4;
			oimg.data[o] = oimg.data[o + 1] = oimg.data[o + 2] = v;
			oimg.data[o + 3] = 255;
		}
	}
	out.getContext('2d').putImageData(oimg, 0, 0);

	const tex = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, out);
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return {
		texture: tex, count: n,
		attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; },
	};
}

// Load the bitmap web-font (module-relative path — works from any page), then
// call onReady so the caller can rebuild atlases with the real face.
export function loadWeb437(onReady) {
	const url = new URL('../FluidSimulation/Web437_ATI_9x16.woff', import.meta.url);
	const face = new FontFace('Web437_ATI_9x16', "url('" + url.href + "')");
	face.load()
		.then(f => { document.fonts.add(f); onReady(); })
		.catch(() => {});
}
