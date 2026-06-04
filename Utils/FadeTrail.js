// Ring-buffer fade trail. Eliminates the integer-rounding ghost that the fillRect
// fade overlay leaves behind. Each frame's data is stored and replayed with an
// explicitly computed opacity, so pixels cleanly reach 0 instead of asymptoting
// toward the background colour.
//
// Usage:
//   const trail = new FadeTrail(500);          // max 500 frames in buffer
//   trail.push(frameData);                      // call once per frame
//   trail.render(fadeSpeed, (data, opacity) => { draw with globalAlpha = opacity });
//   trail.reset();                              // on cycle reset / parameter change

export default class FadeTrail {
	constructor(maxHistory = 500) {
		this._history = [];
		this._maxHistory = maxHistory;
	}

	get length() {
		return this._history.length;
	}

	push(frameData) {
		this._history.push(frameData);
		if (this._history.length > this._maxHistory) this._history.shift();
	}

	reset() {
		this._history = [];
	}

	// Calls drawFn(frameData, opacity) for each stored frame, oldest first.
	// Automatically trims entries whose opacity has dropped below 1/255.
	render(fadeSpeed, drawFn) {
		const fm = 1 - Number(fadeSpeed);
		while (this._history.length > 1 && Math.pow(fm, this._history.length - 1) < 1 / 255) {
			this._history.shift();
		}
		const n = this._history.length;
		for (let j = 0; j < n; j++) {
			drawFn(this._history[j], Math.pow(fm, n - 1 - j));
		}
	}
}
