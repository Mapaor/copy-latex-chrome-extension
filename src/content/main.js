(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		mathJaxV3LatexById: new Map(),
	};

	const MATHJAX_INDEX_MESSAGE = 'CopyLaTeX_MathJaxIndex';
	const MATHJAX_ID_PATTERN = /^copy-latex-mjx-[a-z0-9]+-[a-z0-9]+-\d+$/;
	const MAX_MATHJAX_INDEX_BATCH = 100;

	window.addEventListener('message', (event) => {
		if (event.source !== window) return;
		const message = event.data;
		if (message?.type !== MATHJAX_INDEX_MESSAGE || message.version !== 1) return;

		const removedIds = Array.isArray(message.removedIds) ? message.removedIds : [];
		const updates = Array.isArray(message.updates) ? message.updates : [];
		if (removedIds.length > MAX_MATHJAX_INDEX_BATCH || updates.length > MAX_MATHJAX_INDEX_BATCH) return;

		const texById = ns.state.mathJaxV3LatexById || (ns.state.mathJaxV3LatexById = new Map());
		for (const id of removedIds) {
			if (typeof id === 'string' && MATHJAX_ID_PATTERN.test(id)) texById.delete(id);
		}
		for (const update of updates) {
			if (
				!update ||
				typeof update.id !== 'string' ||
				!MATHJAX_ID_PATTERN.test(update.id) ||
				typeof update.latex !== 'string' ||
				!update.latex.trim()
			) {
				continue;
			}
			texById.set(update.id, update.latex.trim());
		}
	});

	// Inject after installing the listener so the initial index message cannot be missed.
	async function injectMathJaxPageScript() {
		try {
			const scriptUrl = browser.runtime.getURL('content/injected/mathjax-bridge.js');
			const script = document.createElement('script');
			script.src = scriptUrl;
			document.documentElement.appendChild(script);
		} catch (error) {
			console.error('[Copy LaTeX] Failed to inject MathJax script:', error);
		}
	}
	injectMathJaxPageScript();

	// Show overlay for that math root (detection contains the latex code, the math root and the target element to be used for positioning)
  function showOverlayForDetection(detection) {
		ns.state.currentTarget = detection.element;
		detection.element.classList.add('hoverlatex-hover');
		ns.output.showOverlay(detection.overlayTarget || detection.element, detection.tex);
	}

	// Hovering
	document.addEventListener('mouseover', (event) => {
		const detection = ns.detect.detectFromTarget(event.target);
		if (detection) showOverlayForDetection(detection);
	});

	// Not hovering anymore
	document.addEventListener('mouseout', (event) => {
		const currentTarget = ns.state.currentTarget;
		if (!currentTarget) return;

		const stillInsideTarget =
			(event.relatedTarget instanceof Node && currentTarget.contains(event.relatedTarget)) === true;
		if (stillInsideTarget) return;

		const related = event.relatedTarget;
		// Keep the overlay visible while moving onto the overlay or to other equations
		if (related?.closest?.('.hoverlatex-overlay')) return;
		if (ns.detect.findCandidatesFromTarget(related).length > 0) return;

		currentTarget.classList.remove('hoverlatex-hover');
		ns.output.hideOverlay();
		ns.state.currentTarget = null;
	});

	// Ignore right clicks, middle clicks and keyboard-generated clicks. Only pointerdown and clicik are observed.
	function shouldHandleGesture(event) {
		if (typeof event.button === 'number' && event.button !== 0) return false;
		return true;
	}

	// Handle click or mousedown events
	function handleCopyGesture(event) {
		if (!shouldHandleGesture(event)) return;

		const overlay = ns.state.overlay;
		if (overlay && overlay.classList.contains('visible') && event.target?.closest?.('.hoverlatex-overlay')) {
			const tex = overlay.dataset.tex;
			if (tex && tex.trim()) ns.output.copyLatex(tex.trim());
			return;
		}

		const detection = ns.detect.detectFromTarget(event.target);
		if (!detection) return;

		const policy = detection.duplicatePolicy;
		if (policy) {
			const key = detection[policy.key];
			if (key !== undefined && key !== null) {
				const lastCopies = ns.state.lastCopiesByPolicy || (ns.state.lastCopiesByPolicy = Object.create(null));
				const now = Date.now();
				const previous = lastCopies[policy.id];
				if (previous?.key === key && now - previous.timestamp < policy.windowMs) return;
				lastCopies[policy.id] = { key, timestamp: now };
			}
		}

		ns.output.copyLatex(detection.tex);
	}

	document.addEventListener('pointerdown', handleCopyGesture, { capture: true });
	document.addEventListener('click', handleCopyGesture, { capture: true });
})();
