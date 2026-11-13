(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		lastMathJaxV3Latex: null,
		lastCopyGestureTs: 0,
		lastCopiedTex: null,
	};

	// The page-world bridge is needed to read MathJax v3/v4's source through its API.
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

	// Receive MathJax source from the page-world bridge; keep it in shared content state.
	window.addEventListener('message', (event) => {
		if (event.source !== window) return;
		if (event.data && event.data.type === 'CopyLaTeX_MathJaxV3') {
			ns.state.lastMathJaxV3Latex = event.data.latex;
			// Keep the legacy page-facing value in sync with the shared detector state.
			window.__lastMathJaxV3Latex = event.data.latex;
		}
	});

	function showOverlayForDetection(detection) {
		ns.state.currentTarget = detection.element;
		detection.element.classList.add('hoverlatex-hover');
		ns.output.showOverlay(detection.overlayTarget || detection.element, detection.tex);
	}

	// Hover and direct copy use the same candidate selection and extraction logic.
	document.addEventListener('mouseover', (event) => {
		const detection = ns.detect.detectFromTarget(event.target);
		if (detection) showOverlayForDetection(detection);
	});

	document.addEventListener('mouseout', (event) => {
		const currentTarget = ns.state.currentTarget;
		if (!currentTarget) return;

		const stillInsideTarget =
			(event.relatedTarget instanceof Node && currentTarget.contains(event.relatedTarget)) === true;
		if (stillInsideTarget) return;

		const related = event.relatedTarget;
		// Keep the overlay visible while moving onto it or directly between math roots.
		if (related?.closest?.('.hoverlatex-overlay')) return;
		if (ns.detect.findCandidateElementsFromTarget(related).length > 0) return;

		currentTarget.classList.remove('hoverlatex-hover');
		ns.output.hideOverlay();
		ns.state.currentTarget = null;
	});

	function shouldHandleGesture(event) {
		if (typeof event.button === 'number' && event.button !== 0) return false;
		return true;
	}

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

		// KaTeX can trigger both pointerdown and click for one gesture; suppress that duplicate.
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
