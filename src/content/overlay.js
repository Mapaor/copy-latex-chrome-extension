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

	// Read it once and cache it (to avoid having to read storage everytime a hover happens)
	async function loadThemeModeOnce() {
		if (ns.state.themeModeLoaded) return;
		try {
			const result = await browser.storage.local.get('themeMode'); // The theme is saved in local storage as a themeMode key
			ns.state.themeMode = result.themeMode || 'system';
		} catch (e) {
			// Handle a bug that can happen if a refresh happens while an async storage call is happening
			const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
			if (!message.includes('Extension context invalidated')) {
				console.warn('[Copy LaTeX] loadThemeModeOnce: error reading browser.storage.local', e);
			}
			// To handle it we simply continue (with the default system theme)
		} finally {
			ns.state.themeModeLoaded = true;
			// If the overlay already existed make a call to update it
			applyOverlayThemeClass();
		}
	}

	function applyOverlayThemeClass() {
		const overlay = getOverlay();
		if (!overlay) return;

		const theme = ns.state.themeMode || 'system'; // Default
		const wantsLight = theme === 'light';
		const wantsDark = theme === 'dark';

		const hasLight = overlay.classList.contains('theme-light');
    const hasDark = overlay.classList.contains('theme-dark');
		// If we're already on the right theme no need to do anything
		if (wantsLight === hasLight && wantsDark === hasDark) return;

		overlay.classList.toggle('theme-light', wantsLight);
		overlay.classList.toggle('theme-dark', wantsDark);
	}

	// Keep ns.state in sync when local storage preferences change
	try {
		browser.storage.onChanged.addListener((changes, areaName) => {
			if (areaName !== 'local') return;
			if (!changes.themeMode) return; // We listen only for theme changes
			ns.state.themeMode = changes.themeMode.newValue || 'system'; // Update ns.state
			ns.state.themeModeLoaded = true;
			applyOverlayThemeClass(); // Update overlay
		});
	} catch (e) {
		// Do not throw an error if the content script can't listen to local storage changes (can happen in old browsers)
	}

	loadThemeModeOnce();

	function getOverlay() {
		return ns.state.overlay;
	}

	function setOverlay(el) {
		ns.state.overlay = el;
	}

	function setOverlayThemeClass() {
		if (!ns.state.themeModeLoaded) loadThemeModeOnce();
		applyOverlayThemeClass();
	}

	// We build the overlay once, append it to the document, and later position it wherever it needs to be
	function createOverlay() {
		const overlay = document.createElement('div');
		overlay.className = 'hoverlatex-overlay';

		setOverlay(overlay);

		setOverlayThemeClass();

    // The overlay's content is an SVG icon + text
		overlay.appendChild(ns.svg.createSvgFromString(ns.svg.copy_svg));
		const span = document.createElement('span');
		span.textContent = 'Click to copy';
		overlay.appendChild(span);

		document.body.appendChild(overlay);
		return overlay;
	}

	// Position the overlay above the detected math root using viewport geometry (because the overlay has position: absolute)
	function showOverlay(target, tex) {
		let overlay = getOverlay();
		if (!overlay) {
      // console.log('[Copy LaTeX] showOverlay: overlay does not exist, creating...');
      overlay = createOverlay()
    }  else {
      // console.log('[Copy LaTeX] showOverlay: overlay exists, reusing. Classes:', overlay.className);
    }

		setOverlayThemeClass(); // Applied synchronously to avoid flicker while hovering
		overlay.dataset.tex = tex;

		const rect = target.getBoundingClientRect(); // Rectangle bounding the math root
		const overlayWidth = overlay.offsetWidth;
		const top = rect.top + window.scrollY - overlay.offsetHeight - 8;
		const left = rect.left + window.scrollX + rect.width / 2 - overlayWidth / 2;
		overlay.style.top = `${top}px`;
		overlay.style.left = `${left}px`;
    overlay.classList.add('visible');
   	// TODO: Avoid overlay reflow in very large pages
    // One possible solution would be to make the overlay independent from viewport, position it with CSS transforms
    // But the core fix should go on main.js on the mouseover handler first avoid detection for non-math targets,
    // and to skip showing/repositioning when the same formula and LaTeX are already active (nested KaTeX mouse events)
	}

	// Hide overlay instead of removing it (so later hovers can reuse it)
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
