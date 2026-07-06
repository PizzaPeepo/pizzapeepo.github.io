// Hero title inside the lattice (ASCII_REDESIGN_PLAN.md Phase 7). The DOM
// #kineticTitle keeps its layout + a11y/SEO text but goes visibility:hidden;
// its lines are re-rendered as scaled Web437 glyph blocks cell-snapped to the
// DOM rect. The index page's em-word cycler keeps mutating the DOM — a
// MutationObserver mirrors every swap into the lattice, and scroll/resize/
// font-load re-snap the placement.

export function createHeroText(ascii) {
	const title = document.getElementById('kineticTitle');
	if (!title) return { refresh() {}, setPalette() {} };
	title.style.visibility = 'hidden';

	let palette = null;

	// innerText of a visibility:hidden element collapses <br> — walk manually.
	function readLines() {
		const out = [''];
		(function walk(n) {
			n.childNodes.forEach(c => {
				if (c.nodeType === 3) out[out.length - 1] += c.textContent;
				else if (c.tagName === 'BR') out.push('');
				else walk(c);
			});
		})(title);
		return out.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
	}

	function refresh() {
		const text = ascii.text;
		if (!text || !palette) return;
		text.clear();
		const cols = ascii.cols, rows = ascii.rows;
		const cw = window.innerWidth / cols, ch = window.innerHeight / rows;
		const r = title.getBoundingClientRect();
		const ls = readLines();
		if (!ls.length || r.width === 0) return;
		const lineH = r.height / ls.length;
		// char block = S×S cells (cell aspect already 9:16): fit line height,
		// clamp to grid width for the longest line.
		let S = Math.round(lineH / ch * 0.85);
		const maxLen = Math.max.apply(null, ls.map(s => s.length));
		S = Math.min(S, Math.floor((cols - 4) / Math.max(1, maxLen)));
		S = Math.max(2, Math.min(8, S));
		const col0 = Math.max(0, Math.round(r.left / cw));
		for (let i = 0; i < ls.length; i++) {
			const bottomPx = r.top + (i + 1) * lineH;
			const rowBottom = Math.round((window.innerHeight - bottomPx) / ch);
			// last line = the cycling verb → accent ink; leading lines → text color
			const color = i === ls.length - 1 ? palette.inks[0] : (palette.tx || { r: 0.9, g: 0.9, b: 0.9 });
			text.writeText(col0, rowBottom, ls[i], color, S);
		}
	}

	function setPalette(p) { palette = p; refresh(); }

	let raf = 0;
	const queue = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; refresh(); }); };
	new MutationObserver(queue).observe(title, { childList: true, subtree: true, characterData: true });
	window.addEventListener('scroll', queue, { passive: true });
	window.addEventListener('resize', queue);
	ascii.onFontReady(queue);

	return { refresh, setPalette };
}
