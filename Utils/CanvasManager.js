// Canvas sizing helper for the demos. Sizes each canvas's backing store AND its CSS box to
// width x height, then returns the 2D contexts in the same order as `entries`.
//
// entries: Array<{
//   id?: string,                       // element id to look up (or pass `canvas` directly)
//   canvas?: HTMLCanvasElement,
//   configure?: (ctx, canvas) => void, // optional: set default styles (strokeStyle, lineWidth, ...)
// }>
export function setupCanvases(entries, width, height) {
	return entries.map((entry) => {
		const canvas = entry.canvas || document.getElementById(entry.id);
		canvas.width = width;
		canvas.height = height;
		canvas.style.width = width + 'px';
		canvas.style.height = height + 'px';
		const ctx = canvas.getContext('2d');
		if (entry.configure) entry.configure(ctx, canvas);
		return ctx;
	});
}
