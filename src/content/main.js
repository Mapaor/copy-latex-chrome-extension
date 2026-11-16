(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		mathJaxV3LatexById: new Map(),
	};

	ns.state.showOverlay = ns.state.showOverlay !== false;
	ns.state.contextMenuEquation = ns.state.contextMenuEquation || null;
	ns.state.activeDetection = ns.state.activeDetection || null;

	function clearActiveDetection() {
		const activeElement = ns.state.activeDetection?.element;
		const currentTarget = ns.state.currentTarget;
		activeElement?.classList.remove('hoverlatex-hover');
		if (currentTarget && currentTarget !== activeElement) {
			currentTarget.classList.remove('hoverlatex-hover');
		}
		ns.state.activeDetection = null;
		ns.state.currentTarget = null;
	}

	let showOverlayPreferenceRevision = 0;
	function setShowOverlayPreference(value) {
		ns.state.showOverlay = value !== false;
		if (ns.state.showOverlay) return;

		clearActiveDetection();
		ns.output.hideOverlay();
	}

	try {
		browser.storage.onChanged.addListener((changes, areaName) => {
			if (areaName !== 'local' || !changes.showOverlay) return;
			showOverlayPreferenceRevision += 1;
			setShowOverlayPreference(changes.showOverlay.newValue);
		});

		const initialRevision = showOverlayPreferenceRevision;
		browser.storage.local.get('showOverlay').then(({ showOverlay }) => {
			if (showOverlayPreferenceRevision === initialRevision) setShowOverlayPreference(showOverlay);
		}).catch((error) => {
			console.warn('[Copy LaTeX] Failed to read showOverlay preference:', error);
		});
	} catch (error) {
		console.warn('[Copy LaTeX] Failed to watch showOverlay preference:', error);
	}

	const MATHJAX_INDEX_MESSAGE = 'CopyLaTeX_MathJaxIndex';
	const MATHJAX_ID_PATTERN = /^copy-latex-mjx-[a-z0-9]+-[a-z0-9]+-\d+$/;
	const MAX_MATHJAX_INDEX_BATCH = 100;
	const MAX_MATHJAX_INDEX_ENTRIES = 2000;
	const MAX_MATHJAX_LATEX_LENGTH = 100_000;

	window.addEventListener('message', (event) => {
		if (event.source !== window || event.origin !== window.location.origin) return;
		const message = event.data;
		if (
			!message ||
			typeof message !== 'object' ||
			Array.isArray(message) ||
			message.type !== MATHJAX_INDEX_MESSAGE ||
			message.version !== 1 ||
			!Array.isArray(message.removedIds) ||
			!Array.isArray(message.updates)
		) {
			return;
		}

		const { removedIds, updates } = message;
		if (removedIds.length > MAX_MATHJAX_INDEX_BATCH || updates.length > MAX_MATHJAX_INDEX_BATCH) return;

		const messageIds = new Set();
		for (const id of removedIds) {
			if (typeof id !== 'string' || !MATHJAX_ID_PATTERN.test(id) || messageIds.has(id)) return;
			messageIds.add(id);
		}
		for (const update of updates) {
			if (
				!update ||
				typeof update !== 'object' ||
				Array.isArray(update) ||
				typeof update.id !== 'string' ||
				!MATHJAX_ID_PATTERN.test(update.id) ||
				typeof update.latex !== 'string' ||
				!update.latex.trim() ||
				update.latex.length > MAX_MATHJAX_LATEX_LENGTH ||
				messageIds.has(update.id)
			) {
				return;
			}
			messageIds.add(update.id);
		}

		const texById = ns.state.mathJaxV3LatexById || (ns.state.mathJaxV3LatexById = new Map());
		const liveIds = new Set();
		for (const container of document.querySelectorAll('mjx-container[data-copy-latex-mathjax-id]')) {
			const id = container.getAttribute('data-copy-latex-mathjax-id');
			if (container.isConnected && id && MATHJAX_ID_PATTERN.test(id)) liveIds.add(id);
		}

		for (const id of texById.keys()) {
			if (!liveIds.has(id)) texById.delete(id);
		}
		for (const id of removedIds) texById.delete(id);
		for (const update of updates) {
			if (!liveIds.has(update.id)) continue;
			if (!texById.has(update.id) && texById.size >= MAX_MATHJAX_INDEX_ENTRIES) continue;
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
		if (!ns.state.showOverlay) return;

		const overlayTarget = detection.overlayTarget || detection.element;
		const activeDetection = ns.state.activeDetection;
		if (
			activeDetection?.element === detection.element &&
			activeDetection.overlayTarget === overlayTarget &&
			activeDetection.tex === detection.tex
		) {
			return;
		}

		if (activeDetection?.element !== detection.element) {
			activeDetection?.element?.classList.remove('hoverlatex-hover');
			if (ns.state.currentTarget && ns.state.currentTarget !== activeDetection?.element) {
				ns.state.currentTarget.classList.remove('hoverlatex-hover');
			}
		}

		ns.state.activeDetection = { ...detection, overlayTarget };
		ns.state.currentTarget = detection.element;
		detection.element.classList.add('hoverlatex-hover');
		ns.output.showOverlay(overlayTarget, detection.tex);
	}

	// Hovering
	document.addEventListener('mouseover', (event) => {
		if (!ns.state.showOverlay) return;

		const currentTarget = ns.state.currentTarget;
		if (currentTarget && !currentTarget.isConnected) {
			clearActiveDetection();
			ns.output.hideOverlay();
		} else if (currentTarget && event.target instanceof Node && currentTarget.contains(event.target)) {
			return;
		}

		const detection = ns.detect.detectFromTarget(event.target);
		if (detection) showOverlayForDetection(detection);
	});

	// Cache the equation under the native context menu
	document.addEventListener('contextmenu', (event) => {
		const detection = ns.detect.detectFromTarget(event.target);
		const tex = typeof detection?.tex === 'string' ? detection.tex.trim() : '';
		ns.state.contextMenuEquation = tex ? { tex, timestamp: Date.now() } : null;
	}, { capture: true });

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

		clearActiveDetection();
		ns.output.hideOverlay();
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
