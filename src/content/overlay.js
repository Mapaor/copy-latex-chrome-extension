(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		lastMathJaxV3Latex: null,
		lastCopyGestureTs: 0,
		lastCopiedTex: null,
		themeMode: 'system',
		themeModeLoaded: false,
	};

	async function loadThemeModeOnce() {
		if (ns.state.themeModeLoaded) return;
		try {
			const result = await browser.storage.local.get('themeMode');
			ns.state.themeMode = result.themeMode || 'system';
		} catch (e) {
			// This can happen during navigation/refresh or extension reload: the content-script
			// context is torn down while an async storage call is in-flight.
			const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
			if (!message.includes('Extension context invalidated')) {
				console.warn('[Copy LaTeX] loadThemeModeOnce: error reading browser.storage.local', e);
			}
			// Keep default themeMode='system'
		} finally {
			ns.state.themeModeLoaded = true;
			// If the overlay already exists, apply the loaded theme immediately.
			applyOverlayThemeClass();
		}
	}

	function applyOverlayThemeClass() {
		const overlay = getOverlay();
		if (!overlay) return;

		const theme = ns.state.themeMode || 'system';
		const wantsLight = theme === 'light';
		const wantsDark = theme === 'dark';

		// Avoid class churn: only touch DOM if we need to.
		const hasLight = overlay.classList.contains('theme-light');
		const hasDark = overlay.classList.contains('theme-dark');
		if (wantsLight === hasLight && wantsDark === hasDark) return;

		overlay.classList.toggle('theme-light', wantsLight);
		overlay.classList.toggle('theme-dark', wantsDark);
	}

	// Keep ns.state.themeMode in sync without doing async work on hover.
	try {
		browser.storage.onChanged.addListener((changes, areaName) => {
			if (areaName !== 'local') return;
			if (!changes.themeMode) return;
			ns.state.themeMode = changes.themeMode.newValue || 'system';
			ns.state.themeModeLoaded = true;
			applyOverlayThemeClass();
		});
	} catch (e) {
		// Defensive: some environments may not expose storage listeners in this context.
	}

	// Kick off a single async load early.
	loadThemeModeOnce();

	function getOverlay() {
		return ns.state.overlay;
	}

	function setOverlay(el) {
		ns.state.overlay = el;
	}

	async function setOverlayThemeClass() {
		// Backwards-compatible async signature.
		// We *never* do async theme reads on hover; we apply the cached state.
		if (!ns.state.themeModeLoaded) loadThemeModeOnce();
		applyOverlayThemeClass();
	}

	function createOverlay() {
		const overlay = document.createElement('div');
		overlay.className = 'hoverlatex-overlay';

		setOverlay(overlay);

		// Apply cached theme immediately (no async waits).
		setOverlayThemeClass();

    // HTML overlay content with inline SVG icon and 'Click to copy' text
		overlay.appendChild(ns.svg.createSvgFromString(ns.svg.copy_svg));
		const span = document.createElement('span');
		span.textContent = 'Click to copy';
		overlay.appendChild(span);

		document.body.appendChild(overlay);
		return overlay;
	}

	function showOverlay(target, tex) {
		let overlay = getOverlay();
		if (!overlay) {
      // console.log('[Copy LaTeX] showOverlay: overlay does not exist, creating...');
      overlay = createOverlay()
    }  else {
      // console.log('[Copy LaTeX] showOverlay: overlay exists, reusing. Classes:', overlay.className);
    }

		// Ensure theme is applied synchronously to avoid flicker.
		setOverlayThemeClass();
		overlay.dataset.tex = tex;

		const rect = target.getBoundingClientRect();
		const overlayWidth = overlay.offsetWidth;
		const top = rect.top + window.scrollY - overlay.offsetHeight - 8;
		const left = rect.left + window.scrollX + rect.width / 2 - overlayWidth / 2;
		overlay.style.top = `${top}px`;
		overlay.style.left = `${left}px`;
		overlay.classList.add('visible');
	}

	function hideOverlay() {
		const overlay = getOverlay();
		if (overlay) overlay.classList.remove('visible');
	}

	ns.output = ns.output || {};
	Object.assign(ns.output, {
		createOverlay,
		setOverlayThemeClass,
		showOverlay,
		hideOverlay,
	});
})();
