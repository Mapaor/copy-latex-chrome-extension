(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		lastMathJaxV3Latex: null,
		lastCopyGestureTs: 0,
		lastCopiedTex: null,
	};

	const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
	// These selectors find likely renderer roots. Namespace-sensitive element names
	// are validated separately by the renderer-specific detectors below.
	const CANDIDATE_SELECTOR = [
		'.katex',
		'[data-math]',
		'[data-xpm-copy-root][data-xpm-latex]',
		'[data-xpm-latex]',
		'mjx-container',
		'.MathJax_Display',
		'.MJXc-display',
		'.MathJax',
		'.mjx-chtml',
		'.MathJax_CHTML',
		'.MathJax_MathML',
		'img.mwe-math',
		'img.mwe-math-fallback-image-inline',
		'img.mwe-math-fallback-image-display',
	].join(', ');

	function isWikipedia() {
		const hostname = window.location.hostname;
		return (
			hostname.endsWith('.wikipedia.org') ||
			hostname === 'www.wikiwand.com' ||
			hostname === 'wikimedia.org' ||
			hostname.endsWith('.wikiversity.org') ||
			hostname.endsWith('.wikibooks.org')
		);
	}

	function isGoogleSearch() {
		const hostname = window.location.hostname;
		return hostname === 'www.google.com' || hostname.endsWith('.google.com') || hostname.startsWith('www.google.');
	}

	// tagName casing varies across namespaces; check both the HTML namespace and localName.
	function isHtmlElementNamed(el, localName) {
		return el?.namespaceURI === HTML_NAMESPACE && el.localName === localName;
	}

	function hasAnyClass(el, classNames) {
		return classNames.some((className) => el.classList.contains(className));
	}

	function findWikipediaTex(el) {
		if (!isWikipedia()) return null;

		// New Wikipedia math output includes the original source in MediaWiki's data-mw.
		if (isHtmlElementNamed(el, 'mjx-container')) {
			const mathElement = el.querySelector('.mwe-math-element[data-mw]');
			try {
				const source = JSON.parse(mathElement?.getAttribute('data-mw') || '').body?.extsrc;
				if (typeof source === 'string' && source.trim()) return source.trim();
			} catch {
				// Ignore absent or malformed metadata and let other MathJax detection run.
			}
			return null;
		}

		// Older Wikipedia pages expose the TeX source as an image's alt text.
		if (!isHtmlElementNamed(el, 'img')) return null;
		if (
			!hasAnyClass(el, [
				'mwe-math',
				'mwe-math-fallback-image-inline',
				'mwe-math-fallback-image-display',
			])
		) {
			return null;
		}

		const alt = el.getAttribute('alt');
		if (!alt?.trim()) return null;
		// Unwrap the display-style wrapper when present; otherwise preserve the alt text.
		const match = alt.trim().match(/^\{\\displaystyle\s*([\s\S]*?)\}$/);
		return match ? match[1].trim() : alt.trim();
	}

	function findMathJaxV3Tex(el) {
		// MathJax v3/v4 renders into an HTML custom element, not a MathML <math> node.
		const mjxContainer = isHtmlElementNamed(el, 'mjx-container') ? el : null;
		if (!mjxContainer) return null;

		// MathJax v3/v4 exposes the source through the page-world bridge when available.
		// The bridge currently stores the most recently observed source in shared state.
		if (ns.state.lastMathJaxV3Latex) return ns.state.lastMathJaxV3Latex;

		// Fall back to nearby TeX script nodes used by some MathJax integrations.
		let current = mjxContainer;
		for (let i = 0; i < 5; i++) {
			current = current.nextElementSibling;
			if (!current) break;
			if (
				isHtmlElementNamed(current, 'script') &&
				(current.type === 'math/tex' || current.type === 'math/tex; mode=display')
			) {
				return current.textContent.trim() || null;
			}
		}

		return null;
	}

	// ChatGPT exposes the original KaTeX source on an ancestor data attribute.
	function findChatGPTTex(el) {
		if (!el?.classList?.contains('katex')) return null;
		const mathSource = el.closest('[data-math-source]')?.getAttribute('data-math-source');
		return mathSource?.trim() || null;
	}

	// Other KaTeX renderers commonly keep TeX in MathML annotation or accessibility attributes.
	function findAnnotationTex(el) {
		if (!el?.classList?.contains('katex')) return null;

		const annotation = el.querySelector(
			'annotation[encoding="application/x-tex"], ' +
			'annotation[encoding="application/x-latex"], ' +
			'annotation[encoding="application/tex"]'
		);
		if (annotation?.textContent.trim()) return annotation.textContent.trim();

		const dataLatex =
			el.getAttribute('data-tex') ||
			el.getAttribute('data-latex') ||
			el.getAttribute('aria-label');
		return dataLatex?.trim() || null;
	}

	function findMathJaxTex(el) {
		// MathJax v2 display output keeps its TeX in a following script sibling.
		const mathJaxDisplay = el?.matches?.('.MathJax_Display, .MJXc-display')
			? el
			: null;
		if (mathJaxDisplay) {
			let sibling = mathJaxDisplay.nextElementSibling;
			while (sibling) {
				if (isHtmlElementNamed(sibling, 'script') && sibling.type === 'math/tex; mode=display') {
					return sibling.textContent.trim() || null;
				}
				sibling = sibling.nextElementSibling;
			}
		}

		// Inline and newer MathJax v2 output use the same neighboring-script fallback.
		const mathJaxInline = el?.matches?.('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML')
			? el
			: null;
		if (!mathJaxInline) return null;

		if (mathJaxInline.id?.includes('MathJax-Element-')) {
			let sibling = mathJaxInline.nextElementSibling;
			while (sibling) {
				if (isHtmlElementNamed(sibling, 'script') && sibling.type === 'math/tex') {
					return sibling.textContent.trim() || null;
				}
				sibling = sibling.nextElementSibling;
			}
		}

		let sibling = mathJaxInline.nextElementSibling;
		while (sibling) {
			if (
				isHtmlElementNamed(sibling, 'script') &&
				(sibling.type === 'math/tex' || sibling.type === 'math/tex; mode=display')
			) {
				return sibling.textContent.trim() || null;
			}
			sibling = sibling.nextElementSibling;
		}
		return null;
	}

	// Google Search's math renderer exposes its source in data-xpm-latex.
	function findGoogleAIMathTex(el) {
		if (!isGoogleSearch() || !el?.hasAttribute?.('data-xpm-latex')) return null;
		const latex = el.getAttribute('data-xpm-latex');
		return latex?.trim() || null;
	}

	function candidateMatches(el) {
		return el instanceof Element && el.matches(CANDIDATE_SELECTOR);
	}

	// Pointer targeting is intentionally limited to ancestors of the actual hit target;
	// scanning descendants would make the hit area too broad (for example, whole text lines).
	function getCandidateElementsFromTarget(target) {
		if (!(target instanceof Element)) return [];
		const candidates = [];
		const add = (el) => {
			if (el && !candidates.includes(el)) candidates.push(el);
		};

		if (isWikipedia()) add(target.closest('img.mwe-math, img.mwe-math-fallback-image-inline, img.mwe-math-fallback-image-display'));
		if (isGoogleSearch()) {
			add(target.closest('[data-xpm-copy-root][data-xpm-latex]'));
			add(target.closest('[data-xpm-latex]'));
		}
		add(target.closest('.katex'));
		add(target.closest('[data-math]'));
		add(target.closest('mjx-container'));
		add(target.closest('.MathJax_Display, .MJXc-display'));
		add(target.closest('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML'));
		return candidates;
	}

	// Use renderer markup/attributes; a block-level parent alone doesn't imply display math.
	function getDisplayMode(el, kind) {
		if (
			kind === 'wikipedia' &&
			(el.classList.contains('mwe-math-fallback-image-display') ||
				(isHtmlElementNamed(el, 'mjx-container') && el.getAttribute('display') === 'true'))
		) {
			return 'display';
		}
		if (kind === 'mathjax-v2' && el.matches('.MathJax_Display, .MJXc-display')) {
			return 'display';
		}
		if (kind === 'mathjax-v3' && el.hasAttribute('display')) return 'display';

		if (kind === 'katex' && el.closest('.katex-display')) return 'display';
		if (kind === 'data-math') {
			// This renderer uses DIV for block equations and inline elements otherwise.
			return isHtmlElementNamed(el, 'div') ? 'display' : 'inline';
		}
		return 'inline';
	}

	// Shared detection/extraction entry point. Callers decide how candidate roots are found.
	function detectMathElement(el) {
		if (!(el instanceof Element)) return null;
		let tex = null;
		let kind = null;

		tex = findWikipediaTex(el);
		if (tex) kind = 'wikipedia';

		if (!tex && isGoogleSearch() && el.hasAttribute('data-xpm-latex')) {
			tex = findGoogleAIMathTex(el);
			if (tex) kind = 'google-ai';
		}

		if (!tex && el.classList.contains('katex')) {
			tex = findChatGPTTex(el) || findAnnotationTex(el);
			if (tex) kind = 'katex';
		}

		if (!tex && el.hasAttribute('data-math')) {
			tex = el.getAttribute('data-math')?.trim() || null;
			if (tex) kind = 'data-math';
		}

		if (!tex && isHtmlElementNamed(el, 'mjx-container')) {
			tex = findMathJaxV3Tex(el);
			if (tex) kind = 'mathjax-v3';
		}

		if (!tex && el.matches('.MathJax_Display, .MJXc-display, .MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML')) {
			tex = findMathJaxTex(el);
			if (tex) kind = 'mathjax-v2';
		}

		if (!tex) return null;
		return { element: el, tex, displayMode: getDisplayMode(el, kind), kind };
	}

	function detectFromTarget(target) {
		for (const candidate of getCandidateElementsFromTarget(target)) {
			const result = detectMathElement(candidate);
			if (result) return result;
		}
		return null;
	}

	function findCandidateElements(root) {
		if (!(root instanceof Element || root instanceof DocumentFragment)) return [];
		const candidates = [];
		if (root instanceof Element && candidateMatches(root)) candidates.push(root);
		candidates.push(...root.querySelectorAll(CANDIDATE_SELECTOR));
		return candidates;
	}

	// Return detected roots only once, suppressing nested candidates when an ancestor
	// already represents the same rendered equation.
	function findMathElements(root) {
		const detections = [];
		for (const candidate of findCandidateElements(root)) {
			const detection = detectMathElement(candidate);
			if (!detection) continue;
			if (detections.some(({ element }) => element.contains(candidate))) continue;
			for (let i = detections.length - 1; i >= 0; i--) {
				if (candidate.contains(detections[i].element)) detections.splice(i, 1);
			}
			detections.push(detection);
		}
		return detections;
	}

	function findMathElementsInRange(range) {
		// Search the common-ancestor subtree and its ancestors so roots containing
		// either selection endpoint are included, even when the cloned range omits them.
		const commonAncestor = range.commonAncestorContainer;
		const searchRoot = commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement;
		const candidates = new Set(findCandidateElements(searchRoot));

		let ancestor = searchRoot;
		while (ancestor) {
			if (candidateMatches(ancestor)) candidates.add(ancestor);
			ancestor = ancestor.parentElement;
		}

		const detections = [];
		for (const candidate of candidates) {
			if (!range.intersectsNode(candidate)) continue;
			const detection = detectMathElement(candidate);
			if (!detection) continue;
			// Keep only the outermost detected root when renderer selectors overlap.
			if (detections.some(({ element }) => element.contains(candidate))) continue;
			for (let i = detections.length - 1; i >= 0; i--) {
				if (candidate.contains(detections[i].element)) detections.splice(i, 1);
			}
			detections.push(detection);
		}

		detections.sort((a, b) => {
			if (a.element === b.element) return 0;
			return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
		});
		return detections;
	}

	ns.detect = {
		isWikipedia,
		isGoogleSearch,
		findWikipediaTex,
		findMathJaxV3Tex,
		findAnnotationTex,
		findMathJaxTex,
		findGoogleAIMathTex,
		findChatGPTTex,
		findCandidateElementsFromTarget: getCandidateElementsFromTarget,
		detectFromTarget,
		detectMathElement,
		findMathElements,
		findMathElementsInRange,
	};
})();
