(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		lastMathJaxV3Latex: null,
		lastCopyGestureTs: 0,
		lastCopiedTex: null,
	};

	function getOverlay() {
		return ns.state.overlay;
	}

	function setOverlay(el) {
		ns.state.overlay = el;
	}

	async function setOverlayThemeClass() {
		const overlay = getOverlay();
		if (!overlay) return;
    // Remove any previous theme class
		overlay.classList.remove('theme-light', 'theme-dark');
		let theme = 'system';

		try {
			const result = await browser.storage.local.get('themeMode');
      // console.log('[Copy LaTeX] setOverlayThemeClass: browser.storage.local themeMode =', result.themeMode);
      theme = result.themeMode || 'system';
		} catch (e) {
			// This can happen during navigation/refresh or extension reload: the content-script
			// context is torn down while an async storage call is in-flight.
			const message = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
			if (!message.includes('Extension context invalidated')) {
				console.warn('[Copy LaTeX] setOverlayThemeClass: error reading browser.storage.local', e);
			}
		}

    // console.log('[Copy LaTeX] setOverlayThemeClass: using theme =', theme);
		if (theme === 'light') overlay.classList.add('theme-light');
		else if (theme === 'dark') overlay.classList.add('theme-dark');
    // If system, do not add any theme class (prefers-color-scheme CSS media query will apply)
  }

	function createOverlay() {
		const overlay = document.createElement('div');
		overlay.className = 'hoverlatex-overlay';
    // console.log('[Copy LaTeX] Overlay created. Initial class:', overlay.className);

		setOverlay(overlay);

    // Set theme class based on user preference
		setOverlayThemeClass().then(() => {
			console.log('[Copy LaTeX] Overlay after theme set. Classes:', overlay.className);
			const bg = window.getComputedStyle(overlay).backgroundColor;
			console.log('[Copy LaTeX] Overlay computed background after theme set:', bg);
		});

		// MutationObserver to log class/style changes (I'll remove it later)
		const observer = new MutationObserver((mutationsList) => {
			for (const mutation of mutationsList) {
				if (
					mutation.type === 'attributes' &&
					(mutation.attributeName === 'class' || mutation.attributeName === 'style')
				) {
					console.log('[Copy LaTeX][MutationObserver] Overlay attribute changed:', mutation.attributeName, {
						class: overlay.className,
						style: overlay.getAttribute('style'),
						computedBg: window.getComputedStyle(overlay).backgroundColor,
					});
				}
			}
		});
		observer.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] });

		// Random interval observer: logs computed background color at random intervals (10-100ms)
		let lastBg = '';
		function randomBgLogger() {
			const currentOverlay = getOverlay();
			if (currentOverlay) {
				const bg = window.getComputedStyle(currentOverlay).backgroundColor;
				if (bg !== lastBg) {
					console.log('[Copy LaTeX][RandomBgObserver] Overlay computed background:', bg);
					lastBg = bg;
				}
			}

      // Schedule next check at a random interval between 10ms and 100ms
			const nextDelay = Math.floor(Math.random() * 91) + 10;
			setTimeout(randomBgLogger, nextDelay);
		}
		randomBgLogger();

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

    // Only make overlay visible after theme is set
		setOverlayThemeClass().then(() => {
      // Remove .visible if present before theme is set
			overlay.classList.remove('visible');
      // console.log('[Copy LaTeX] showOverlay: after theme set. Classes:', overlay.className);
      const bg = window.getComputedStyle(overlay).backgroundColor;
      // console.log('[Copy LaTeX] showOverlay: computed background:', bg);
      overlay.dataset.tex = tex;

			const rect = target.getBoundingClientRect();
			const overlayWidth = overlay.offsetWidth;
			const top = rect.top + window.scrollY - overlay.offsetHeight - 8;
			const left = rect.left + window.scrollX + rect.width / 2 - overlayWidth / 2;
			overlay.style.top = `${top}px`;
			overlay.style.left = `${left}px`;
			overlay.classList.add('visible');
		});
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
