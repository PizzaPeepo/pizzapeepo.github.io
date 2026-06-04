(function () {
	var MOBILE_BREAKPOINT = 700;
	var HUD_WIDTH = 280;

	window.getCanvasWidth = function () {
		if (window.innerWidth <= MOBILE_BREAKPOINT) return window.innerWidth;
		var panel = document.getElementById('hudPanel');
		var panelClosed = panel && panel.classList.contains('is-closed');
		return panelClosed ? window.innerWidth : window.innerWidth - HUD_WIDTH;
	};

	var toggle   = document.getElementById('hudToggle');
	var panel    = document.getElementById('hudPanel');
	var backdrop = document.getElementById('hudBackdrop');

	if (!toggle || !panel) return;

	function dispatchResizeIfDesktop() {
		if (window.innerWidth > MOBILE_BREAKPOINT) {
			window._hudToggling = true;
			window.dispatchEvent(new Event('resize'));
			window._hudToggling = false;
		}
	}

	function openPanel() {
		panel.classList.remove('is-closed');
		panel.classList.remove('is-open');
		if (backdrop) backdrop.classList.remove('is-open');
		toggle.setAttribute('aria-expanded', 'true');
		dispatchResizeIfDesktop();
	}

	function closePanel() {
		if (window.innerWidth > MOBILE_BREAKPOINT) {
			panel.classList.add('is-closed');
		} else {
			panel.classList.remove('is-open');
			if (backdrop) backdrop.classList.remove('is-open');
		}
		toggle.setAttribute('aria-expanded', 'false');
		dispatchResizeIfDesktop();
	}

	function openMobile() {
		panel.classList.add('is-open');
		if (backdrop) backdrop.classList.add('is-open');
		toggle.setAttribute('aria-expanded', 'true');
	}

	toggle.addEventListener('click', function () {
		if (window.innerWidth > MOBILE_BREAKPOINT) {
			panel.classList.contains('is-closed') ? openPanel() : closePanel();
		} else {
			panel.classList.contains('is-open') ? closePanel() : openMobile();
		}
	});

	if (backdrop) {
		backdrop.addEventListener('click', function () {
			panel.classList.remove('is-open');
			backdrop.classList.remove('is-open');
			toggle.setAttribute('aria-expanded', 'false');
		});
	}

	var wasMobile = window.innerWidth <= MOBILE_BREAKPOINT;
	window.addEventListener('resize', function () {
		var isMobile = window.innerWidth <= MOBILE_BREAKPOINT;
		if (wasMobile && !isMobile) {
			// crossed to desktop: ensure panel is visible (remove both mobile and desktop-close states)
			panel.classList.remove('is-open');
			panel.classList.remove('is-closed');
			if (backdrop) backdrop.classList.remove('is-open');
			toggle.setAttribute('aria-expanded', 'true');
		} else if (!wasMobile && isMobile) {
			// crossed to mobile: close any desktop state, start in hidden mobile state
			panel.classList.remove('is-closed');
			panel.classList.remove('is-open');
			if (backdrop) backdrop.classList.remove('is-open');
			toggle.setAttribute('aria-expanded', 'false');
		}
		wasMobile = isMobile;
	});
})();
