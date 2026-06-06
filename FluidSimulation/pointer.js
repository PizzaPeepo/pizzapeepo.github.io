// Pointer state for multi-touch input. One Pointer per active touch / the mouse.

export class Pointer {
	constructor() {
		this.id = -1;
		this.down = false;
		this.moved = false;
		this.texcoordX = 0;
		this.texcoordY = 0;
		this.prevTexcoordX = 0;
		this.prevTexcoordY = 0;
		this.deltaX = 0;
		this.deltaY = 0;
		this.color = [0.15, 0.15, 0.15];
	}
}

// texcoords are in [0,1]; y is flipped so 0 = bottom (matches GL textures).
export function setPointerDown(p, id, x, y, w, h, color) {
	p.id = id;
	p.down = true;
	p.moved = false;
	p.texcoordX = x / w;
	p.texcoordY = 1.0 - y / h;
	p.prevTexcoordX = p.texcoordX;
	p.prevTexcoordY = p.texcoordY;
	p.deltaX = 0;
	p.deltaY = 0;
	p.color = color;
}

export function setPointerMove(p, x, y, w, h) {
	p.prevTexcoordX = p.texcoordX;
	p.prevTexcoordY = p.texcoordY;
	p.texcoordX = x / w;
	p.texcoordY = 1.0 - y / h;
	p.deltaX = correctDelta(p.texcoordX - p.prevTexcoordX, w, h, true);
	p.deltaY = correctDelta(p.texcoordY - p.prevTexcoordY, w, h, false);
	p.moved = Math.abs(p.deltaX) > 0 || Math.abs(p.deltaY) > 0;
}

// Scale the smaller axis so splats stay round regardless of aspect ratio.
function correctDelta(delta, w, h, isX) {
	const aspect = w / h;
	if (isX && aspect < 1) delta *= aspect;
	if (!isX && aspect > 1) delta /= aspect;
	return delta;
}
