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

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE / CORRECTNESS NOTES (measured HeadlessChrome 149, 2026-06)
//
// Cost of render(): O(n_eff x items_drawn_per_frame), where the trail self-trims to
//   n_eff ≈ ln(255) / -ln(1 - fadeSpeed)  ≈ 5.5 / fadeSpeed   (capped at maxHistory).
// So replay is cheap only when fadeSpeed is high (short trail) OR items is small. It
// blows up when BOTH a tiny fade AND many items are drawn each frame. That combination
// is what made the Lissajous table demo degrade (fade 0.01 -> ~500 frames x ~135 figures
// ≈ 67k strokes/tick). Replay also costs MORE the longer it runs, until it hits n_eff.
//
// For that high-cost case prefer a DOUBLE-BUFFER fade instead of replay: ping-pong two
// offscreen canvases; each frame clear the back buffer, draw the front onto it with
//   ctx.globalAlpha = 1 - fadeSpeed   (decays the whole trail in one blit),
// draw the new frame on top at full alpha, swap, blit to the visible canvas. That is
// O(items) per tick, constant over time, independent of trail length.
//
// Why double-buffer is also CLEAN (no ghost): Chrome's two fade paths round differently.
//   • drawImage + globalAlpha onto a CLEARED buffer  -> TRUNCATES -> reaches true 0.
//   • destination-out fillRect(alpha=s) in place     -> ROUNDS HALF-UP -> sticks at a
//     ghost floor ≈ 0.5 / fadeSpeed (e.g. alpha 42/255 ≈ 16% at fade 0.01).
//   • source-over fillRect(rgba(bg, s)) in place      -> blends toward bg COLOR, never
//     transparent (the classic CSS-trail ghost).
// So the in-place single-canvas fades are cheaper by one op but ghost at low fade; the
// ping-pong drawImage path is the cheapest CLEAN canvas-2D fade. (A WebGL/WebGPU float
// framebuffer is the only categorically better option — exact decay, no 8-bit rounding,
// cost independent of item count — but it is a full rewrite, justified only at GPU scale.)
//
// KEEP using this FadeTrail (replay) when the trail is intentionally short OR the demo
// composites with `lighter` (additive glow), e.g. PhaseshiftDemo1 — an additively-blended
// faded bitmap is NOT equivalent to additively re-rendering each historical frame, so the
// double-buffer trick changes the look there. Converted to double-buffer (do not regress):
// Lissajous, CircularMotion, RotatingSquares, LissajousRotating.
// ─────────────────────────────────────────────────────────────────────────────
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
