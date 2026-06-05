// Slider wiring helpers shared by the demos. They keep the value labels in sync and forward
// parsed numeric values to a callback, so each main.js stops re-implementing the same
// addEventListener('input', ...) boilerplate per control.

// Wire one <input type=range> to its value label and a change callback. onChange receives the
// parsed numeric value; formatLabel maps a value to the displayed label text. Returns the slider.
export function createSlider(sliderId, labelId, onChange, formatLabel = (value) => value) {
	const slider = document.getElementById(sliderId);
	const label = labelId ? document.getElementById(labelId) : null;
	function handle() {
		const value = parseFloat(slider.value);
		if (label) label.textContent = formatLabel(value);
		if (onChange) onChange(value);
	}
	if (label) label.textContent = formatLabel(parseFloat(slider.value));
	slider.addEventListener('input', handle);
	return slider;
}

// Wire a min/max slider pair so the min thumb can never cross the max thumb (and vice-versa):
// dragging one past the other pushes the other along by `step`. Whenever either moves, both
// labels refresh and onChange(minValue, maxValue) fires with the current ordered values.
//
// config: {
//   minSliderId, maxSliderId, minLabelId?, maxLabelId?,
//   min?, max?, step?,                  // default step = 1
//   onChange?: (min, max) => void,
//   formatLabel?: (value) => string,
// }
export function createLinkedRangeSliders(config) {
	const {
		minSliderId, maxSliderId, minLabelId, maxLabelId,
		min, max, step = 1,
		onChange = () => {}, formatLabel = (value) => value,
	} = config;
	const minSlider = document.getElementById(minSliderId);
	const maxSlider = document.getElementById(maxSliderId);
	const minLabel = minLabelId ? document.getElementById(minLabelId) : null;
	const maxLabel = maxLabelId ? document.getElementById(maxLabelId) : null;

	for (const slider of [minSlider, maxSlider]) {
		if (min !== undefined) slider.min = min;
		if (max !== undefined) slider.max = max;
		slider.step = step;
	}

	function refreshLabels(low, high) {
		if (minLabel) minLabel.textContent = formatLabel(low);
		if (maxLabel) maxLabel.textContent = formatLabel(high);
	}

	minSlider.addEventListener('input', () => {
		const low = parseFloat(minSlider.value);
		let high = parseFloat(maxSlider.value);
		if (low >= high) { high = low + step; maxSlider.value = high; }
		refreshLabels(low, high);
		onChange(low, high);
	});
	maxSlider.addEventListener('input', () => {
		let low = parseFloat(minSlider.value);
		const high = parseFloat(maxSlider.value);
		if (high <= low) { low = high - step; minSlider.value = low; }
		refreshLabels(low, high);
		onChange(low, high);
	});

	refreshLabels(parseFloat(minSlider.value), parseFloat(maxSlider.value));
	return { minSlider, maxSlider };
}
