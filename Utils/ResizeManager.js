// Registers a window `resize` handler.
//   debounceMs > 0   -> handler fires once, debounceMs after the last resize event.
//   debounceMs === 0 -> (default) handler fires synchronously on every resize event.
export function onWindowResize(handler, debounceMs = 0) {
	if (debounceMs > 0) {
		let timer = null;
		window.addEventListener('resize', () => {
			clearTimeout(timer);
			timer = setTimeout(handler, debounceMs);
		});
	} else {
		window.addEventListener('resize', handler);
	}
}
