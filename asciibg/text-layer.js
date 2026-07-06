// In-lattice text (ASCII_REDESIGN_PLAN.md Phase 7): cols×rows cell buffers →
// two NEAREST textures consumed by the ASCII pass (à la vibe-coded's glyph
// grid). A text cell forces its character's glyph instead of the dye ramp;
// dye color washes through in the shader. Characters can span scale×scale
// cells — each cell then shows one sub-tile of the (9×16, NEAREST-magnified)
// Web437 glyph, so scaled hero text reads as chunky DOS-font pixels.
//
// Texture A: rgb = text color, a = charset index (0 = none).
// Texture B: rg = sub-tile origin (u,v in glyph), b = sub-tile size (1/scale),
//            a = cell enabled (0 → fluid cell, text ignored).
// Grid coords are y-up (row 0 = bottom) to match the pass's cell space.

// Printable ASCII; charset index = charCode - 32. Index 0 is space = "off".
export const TEXT_CHARSET = (() => {
	let s = '';
	for (let c = 32; c <= 126; c++) s += String.fromCharCode(c);
	return s;
})();

export function createTextLayer(gl, cols, rows) {
	const a = new Uint8Array(cols * rows * 4);
	const b = new Uint8Array(cols * rows * 4);
	let dirty = true;

	function mkTex() {
		const t = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, t);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return t;
	}
	const texA = mkTex(), texB = mkTex();

	function clear() {
		a.fill(0); b.fill(0);
		dirty = true;
	}

	// str starting at cell (col, rowBottom) — rowBottom is the BOTTOM cell row of
	// the line (y-up grid). color {r,g,b} 0..1. Each char occupies scale×scale
	// cells. Out-of-grid cells are clipped silently.
	function writeText(col, rowBottom, str, color, scale = 1) {
		const R = (color.r * 255) | 0, G = (color.g * 255) | 0, B = (color.b * 255) | 0;
		const sub = Math.round(255 / scale);
		for (let k = 0; k < str.length; k++) {
			const idx = str.charCodeAt(k) - 32;
			if (idx < 0 || idx > 94) continue;   // non-printable → leave fluid; space (idx 0) → blank black bg cell
			const cx0 = col + k * scale;
			for (let j = 0; j < scale; j++) {
				const cy = rowBottom + j;
				if (cy < 0 || cy >= rows) continue;
				for (let i = 0; i < scale; i++) {
					const cx = cx0 + i;
					if (cx < 0 || cx >= cols) continue;
					const o = (cy * cols + cx) * 4;
					a[o] = R; a[o + 1] = G; a[o + 2] = B; a[o + 3] = idx;
					b[o] = Math.round(i / scale * 255);
					b[o + 1] = Math.round(j / scale * 255);
					b[o + 2] = sub;
					b[o + 3] = 255;
				}
			}
		}
		dirty = true;
	}

	// Enable a rectangle of blank (glyph 0 → black) cells: pads the text's black
	// background without drawing ink. (col, rowBottom) = bottom-left, y-up grid.
	function fillBg(col, rowBottom, wCells, hCells) {
		for (let j = 0; j < hCells; j++) {
			const cy = rowBottom + j;
			if (cy < 0 || cy >= rows) continue;
			for (let i = 0; i < wCells; i++) {
				const cx = col + i;
				if (cx < 0 || cx >= cols) continue;
				const o = (cy * cols + cx) * 4;
				a[o] = a[o + 1] = a[o + 2] = 0; a[o + 3] = 0;   // charset 0 = blank glyph
				b[o] = b[o + 1] = 0; b[o + 2] = 255; b[o + 3] = 255;
			}
		}
		dirty = true;
	}

	function upload() {
		if (!dirty) return;
		dirty = false;
		gl.bindTexture(gl.TEXTURE_2D, texA);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, a);
		gl.bindTexture(gl.TEXTURE_2D, texB);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, b);
	}

	function attachA(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texA); return id; }
	function attachB(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texB); return id; }

	function dispose() { gl.deleteTexture(texA); gl.deleteTexture(texB); }

	return { cols, rows, clear, writeText, fillBg, upload, attachA, attachB, dispose };
}
