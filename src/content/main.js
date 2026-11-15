(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		lastMathJaxV3Latex: null,
		lastCopyGestureTs: 0,
		lastCopiedTex: null,
	};

	// Inject the MathJax bridge script to be able to use the MathJax API (as explained in mathjax-bridge.js)
	async function injectMathJaxPageScript() {
		try {
			const scriptUrl = browser.runtime.getURL('content/injected/mathjax-bridge.js');
			const script = document.createElement('script'); // It's just a <script></script> inserted at the end of the body
			script.src = scriptUrl;
			document.documentElement.appendChild(script);
		} catch (error) {
			console.error('[Copy LaTeX] Failed to inject MathJax script:', error);
		}
	}
	injectMathJaxPageScript();

	// Listen for messages from the bridge script and update the ns.state if mathjax is detected
	window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data && event.data.type === 'CopyLaTeX_MathJaxV3') {
			ns.state.lastMathJaxV3Latex = event.data.latex;
		}
	});

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
		if (ns.detect.findCandidateAncestors(related).length > 0) return;

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

		// KaTeX sometimes has duplicates and it can trigger both pointerdown and clicks for one gesture
		// In that case (<700ms between events) we skip the second copy
		// TODO: Analize if it can happen for other kinds
		if (detection.kind === 'katex') {
			const now = Date.now();
			if (ns.state.lastCopiedTex === detection.tex && now - ns.state.lastCopyGestureTs < 700) return;
			ns.state.lastCopyGestureTs = now;
			ns.state.lastCopiedTex = detection.tex;
		}

		ns.output.copyLatex(detection.tex);
	}

	document.addEventListener('pointerdown', handleCopyGesture, { capture: true });
	document.addEventListener('click', handleCopyGesture, { capture: true });
})();
