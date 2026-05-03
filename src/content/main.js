(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		lastMathJaxV3Latex: null,
		lastCopyGestureTs: 0,
		lastCopiedTex: null,
	};

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

  // Listen for messages from the injected page script to receive LaTeX code (in case of MathJax v3 and v4)
	window.addEventListener('message', (event) => {
		if (event.source !== window) return;
		if (event.data && event.data.type === 'CopyLaTeX_MathJaxV3') {
			ns.state.lastMathJaxV3Latex = event.data.latex;
			// Keep compatibility with content/selection-to-markdown.js
			window.__lastMathJaxV3Latex = event.data.latex;
		}
	});

	function showOverlayForTarget(target, tex) {
		ns.state.currentTarget = target;
		target.classList.add('hoverlatex-hover');
		ns.output.showOverlay(target, tex);
	}

	document.addEventListener('mouseover', (e) => {
		if (ns.detect.isWikipedia()) {
			const wikipediaTex = ns.detect.findWikipediaTex(e.target);
			if (wikipediaTex) {
				showOverlayForTarget(e.target, wikipediaTex);
				return;
			}
		}

		const katex = ns.detect.findKaTeXElementFromEventTarget(e.target);
		if (katex) {
			const tex = ns.detect.findAnnotationTex(katex);
			if (tex) {
				showOverlayForTarget(katex, tex);
				return;
			}
		}

		const dataMathEl = e.target.closest?.('[data-math]');
		if (dataMathEl) {
			const tex = dataMathEl.getAttribute('data-math');
			if (tex && tex.trim()) {
				showOverlayForTarget(dataMathEl, tex.trim());
				return;
			}
		}

		const mjxContainer = e.target.closest?.('mjx-container');
		if (mjxContainer) {
			const tex = ns.detect.findMathJaxV3Tex(mjxContainer);
			if (tex) {
				showOverlayForTarget(mjxContainer, tex);
				return;
			}
		}

		const mathJaxDisplay = e.target.closest?.('.MathJax_Display, .MJXc-display');
		const mathJaxInline = e.target.closest?.('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML');
		if (mathJaxDisplay || mathJaxInline) {
			const mathElement = mathJaxDisplay || mathJaxInline;
			const tex = ns.detect.findMathJaxTex(mathElement);
			if (tex) {
				showOverlayForTarget(mathElement, tex);
			}
		}
	});

	document.addEventListener('mouseout', (e) => {
		const currentTarget = ns.state.currentTarget;
		if (!currentTarget) return;

		const stillInsideTarget =
			(e.relatedTarget instanceof Node && currentTarget.contains(e.relatedTarget)) === true;
		if (stillInsideTarget) return;

		const related = e.relatedTarget;
		const movingIntoOverlay = related?.closest?.('.hoverlatex-overlay');
		if (movingIntoOverlay) return;

		const movingIntoKaTeX = ns.detect.findKaTeXElementFromEventTarget(related);
		if (movingIntoKaTeX) return;

		if (
			related?.closest?.('[data-math]') ||
			related?.closest?.('mjx-container') ||
			related?.closest?.('.MathJax_Display, .MJXc-display') ||
			related?.closest?.('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML')
		) {
			return;
		}

		if (
			ns.detect.isWikipedia() &&
			related?.tagName === 'IMG' &&
			(related?.classList.contains('mwe-math') ||
				related?.classList.contains('mwe-math-fallback-image-inline') ||
				related?.classList.contains('mwe-math-fallback-image-display'))
		) {
			return;
		}

		currentTarget.classList.remove('hoverlatex-hover');
		ns.output.hideOverlay();
		ns.state.currentTarget = null;
	});

	function shouldHandleGesture(e) {
		if (typeof e.button === 'number' && e.button !== 0) return false;
		return true;
	}

	function handleCopyGesture(e) {
		if (!shouldHandleGesture(e)) return;

		const overlay = ns.state.overlay;
		if (overlay && overlay.classList.contains('visible') && e.target?.closest?.('.hoverlatex-overlay')) {
			const tex = overlay.dataset.tex;
			if (tex && tex.trim()) ns.output.copyLatex(tex.trim());
			return;
		}

		if (ns.detect.isWikipedia()) {
			const wikipediaTex = ns.detect.findWikipediaTex(e.target);
			if (wikipediaTex) {
				ns.output.copyLatex(wikipediaTex);
				return;
			}
		}

		const katex = ns.detect.findKaTeXElementFromEventTarget(e.target);
		if (katex) {
			const tex = ns.detect.findAnnotationTex(katex);
			if (tex) {
				const now = Date.now();
				if (ns.state.lastCopiedTex === tex && now - ns.state.lastCopyGestureTs < 700) return;
				ns.state.lastCopyGestureTs = now;
				ns.state.lastCopiedTex = tex;
				ns.output.copyLatex(tex);
				return;
			}
		}

		const dataMathEl = e.target.closest?.('[data-math]');
		if (dataMathEl) {
			const tex = dataMathEl.getAttribute('data-math');
			if (tex) {
				ns.output.copyLatex(tex);
				return;
			}
		}

		const mjxContainer = e.target.closest?.('mjx-container');
		if (mjxContainer) {
			const tex = ns.detect.findMathJaxV3Tex(mjxContainer);
			if (tex) {
				ns.output.copyLatex(tex);
				return;
			}
		}

		const mathJaxDisplay = e.target.closest?.('.MathJax_Display, .MJXc-display');
		const mathJaxInline = e.target.closest?.('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML');
		if (mathJaxDisplay || mathJaxInline) {
			const mathElement = mathJaxDisplay || mathJaxInline;
			const tex = ns.detect.findMathJaxTex(mathElement);
			if (tex) ns.output.copyLatex(tex);
		}
	}

	document.addEventListener('pointerdown', (e) => handleCopyGesture(e), { capture: true });
	document.addEventListener('click', (e) => handleCopyGesture(e), { capture: true });
})();

