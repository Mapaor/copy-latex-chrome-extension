(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

	function candidateRule(group, selectors, relations = {}) {
		return {
			group,
			selectors,
			target: relations.target ?? ['self', 'ancestors'],
			subtree: relations.subtree ?? ['root', 'descendants'],
			range: relations.range ?? ['root', 'descendants', 'search-root-ancestors'],
		};
	}

	const KATEX_COPY_DUPLICATE_POLICY = {
		id: 'katex-copy-gesture',
		key: 'tex',
		windowMs: 700,
	};

	// ==== CHECKS (boolean helper functions) ====

	function isWikipedia() {
		const hostname = window.location.hostname;
		return (
			hostname.endsWith('.wikipedia.org') ||
			hostname === 'www.wikiwand.com' ||
			hostname === 'wikimedia.org' ||
			hostname.endsWith('.wikiversity.org') ||
			hostname.endsWith('.wikibooks.org')
		); // True if Wikipedia, Wikimedia, Wikiversity, Wikibooks or Wikiwand
	}

	function isGoogleSearch() {
		const hostname = window.location.hostname;
		return hostname === 'www.google.com' || hostname.endsWith('.google.com') || hostname.startsWith('www.google.');
	}

	// In the old function we used tagName, but the HTML tagName can vary across namespaces
	// In this new version (after detection unification) we check both the HTML namespace and the localName
	function isHtmlElementNamed(el, localName) {
		return el?.namespaceURI === HTML_NAMESPACE && el.localName === localName;
	}

	function hasAnyClass(el, classNames) {
		return classNames.some((className) => el.classList.contains(className));
	}

	// ==== DETECTORS ====

	function extractWikipediaMathJaxDataMwTex(el) {
		if (!isHtmlElementNamed(el, 'mjx-container')) return null;

		const mathElement = el.querySelector('.mwe-math-element[data-mw]');
		try {
			const source = JSON.parse(mathElement?.getAttribute('data-mw') || '').body?.extsrc;
			if (typeof source === 'string' && source.trim()) return source.trim();
		} catch {
			// Ignore absent or malformed metadata and let the detector chain continue.
		}
		return null;
	}

	function extractWikipediaImageAltTex(el) {
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
		const match = alt.trim().match(/^\{\\displaystyle\s*([\s\S]*?)\}$/);
		return match ? match[1].trim() : alt.trim();
	}

	function extractMathJaxV3Tex(el) {
		// MathJax v3/v4 renders into an HTML custom element `mjx-container`, not a MathML <math> node.
		const mjxContainer = isHtmlElementNamed(el, 'mjx-container') ? el : null;
		if (!mjxContainer) return null;

		const containerId = mjxContainer.getAttribute('data-copy-latex-mathjax-id');
		const indexedTex = containerId && ns.state.mathJaxV3LatexById?.get(containerId);
		if (typeof indexedTex === 'string' && indexedTex.trim()) return indexedTex.trim();

		// In case no LaTeX code is found, fallback to nearby TeX script nodes (used in some MathJax integrations)
		let current = mjxContainer;
		for (let i = 0; i < 5; i++) { // TODO: Understand why 5
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

	// ChatGPT has a custom KaTeX rendering, the LaTeX code is on an ancestor's data-math-source attribute.
	function extractChatGPTTex(el) {
		const mathSource = el.closest('[data-math-source]')?.getAttribute('data-math-source');
		return mathSource?.trim() || null;
	}

	// Most KaTeX renderers commonly keep TeX inside MathML annotation (or data) attributes
	function extractAnnotationTex(el) {
		const annotation = el.querySelector(
			'annotation[encoding="application/x-tex"], ' +
			'annotation[encoding="application/x-latex"], ' +
			'annotation[encoding="application/tex"]'
		);
		return annotation?.textContent.trim() || null;
	}

	function extractKatexAttributeTex(el) {
		const dataLatex =
			el.getAttribute('data-tex') ||
			el.getAttribute('data-latex') ||
			el.getAttribute('aria-label');
		return dataLatex?.trim() || null;
	}

	function getKatexDisplayMode(el) {
		return el.closest('.katex-display') ? 'display' : 'inline';
	}

	function extractMathJaxTex(el) {
		// MathJax v2 display equations have their latex code in a script math/tex sibling
		const mathJaxDisplay = el?.matches?.('.MathJax_Display, .MJXc-display') // MathJax v2 display equations can be Identified by these classes
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

		// MathJax v2 inline equations work the same way (via the sibling script)
		const mathJaxInline = el?.matches?.('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML') // MathJax v2 inline equations can be Identified by these classes
			? el
			: null;
		if (!mathJaxInline) return null;

		// If it has a MathJax-Element-[something] id, it won't contain mode=display
		if (mathJaxInline.id?.includes('MathJax-Element-')) {
			let sibling = mathJaxInline.nextElementSibling;
			while (sibling) {
				if (isHtmlElementNamed(sibling, 'script') && sibling.type === 'math/tex') {
					return sibling.textContent.trim() || null;
				}
				sibling = sibling.nextElementSibling;
			}
		}

		// If it does not have a MathJax-Element-[something] id, it will contain mode=display deespite being an inline equation
		// TODO: Maybe these 3 MathJax v2 detectors (that have prectially the same code) can be refactored together via an auxiliar function
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

	const KATEX_ENTRIES = [
		{
			id: 'katex-data-math-source',
			candidates: [candidateRule('katex', ['.katex'])],
			matches: (el) => el.classList.contains('katex'),
			extractTex: extractChatGPTTex,
			getDisplayMode: getKatexDisplayMode,
			duplicatePolicy: KATEX_COPY_DUPLICATE_POLICY,
		},
		{
			id: 'katex-annotation',
			candidates: [candidateRule('katex', ['.katex'])],
			matches: (el) => el.classList.contains('katex'),
			extractTex: extractAnnotationTex,
			getDisplayMode: getKatexDisplayMode,
			duplicatePolicy: KATEX_COPY_DUPLICATE_POLICY,
		},
		{
			id: 'katex-attributes',
			candidates: [candidateRule('katex', ['.katex'])],
			matches: (el) => el.classList.contains('katex'),
			extractTex: extractKatexAttributeTex,
			getDisplayMode: getKatexDisplayMode,
			duplicatePolicy: KATEX_COPY_DUPLICATE_POLICY,
		},
	];

	const DETECTION_REGISTRY = [
		{
			id: 'wikipedia-mathjax-data-mw',
			site: 'wikipedia',
			appliesTo: isWikipedia,
			candidates: [candidateRule('mathjax-container', ['mjx-container'])],
			matches: (el, context) => context.site === 'wikipedia' && isHtmlElementNamed(el, 'mjx-container'),
			extractTex: extractWikipediaMathJaxDataMwTex,
			getDisplayMode: (el) => el.getAttribute('display') === 'true' ? 'display' : 'inline',
			getOverlayTarget: (el) =>
				el.getAttribute('display') === 'true' ? el.querySelector('svg') || el : el,
		},
		{
			id: 'wikipedia-image-alt',
			site: 'wikipedia',
			appliesTo: isWikipedia,
			candidates: [
				candidateRule('wikipedia-images', [
					'img.mwe-math',
					'img.mwe-math-fallback-image-inline',
					'img.mwe-math-fallback-image-display',
				]),
			],
			matches: (el, context) =>
				context.site === 'wikipedia' &&
				isHtmlElementNamed(el, 'img') &&
				hasAnyClass(el, ['mwe-math', 'mwe-math-fallback-image-inline', 'mwe-math-fallback-image-display']),
			extractTex: extractWikipediaImageAltTex,
			getDisplayMode: (el) => el.classList.contains('mwe-math-fallback-image-display') ? 'display' : 'inline',
		},
		{
			id: 'google-ai-data-xpm',
			site: 'google-search',
			appliesTo: isGoogleSearch,
			candidates: [
				candidateRule('google-xpm-copy-root', ['[data-xpm-copy-root][data-xpm-latex]']),
				candidateRule('google-xpm-latex', ['[data-xpm-latex]']),
			],
			matches: (el, context) => context.site === 'google-search' && el.hasAttribute('data-xpm-latex'),
			extractTex: (el) => el.getAttribute('data-xpm-latex'),
		},
		...KATEX_ENTRIES,
		{
			id: 'data-math',
			candidates: [candidateRule('data-math', ['[data-math]'])],
			matches: (el) => el.hasAttribute('data-math'),
			extractTex: (el) => el.getAttribute('data-math'),
			getDisplayMode: (el) => isHtmlElementNamed(el, 'div') ? 'display' : 'inline',
		},
		{
			id: 'mathjax-v3-v4-api',
			candidates: [candidateRule('mathjax-container', ['mjx-container'])],
			matches: (el) => isHtmlElementNamed(el, 'mjx-container'),
			extractTex: extractMathJaxV3Tex,
			getDisplayMode: (el) => el.hasAttribute('display') ? 'display' : 'inline',
		},
		{
			id: 'mathjax-v2',
			candidates: [
				candidateRule('mathjax-v2-display', ['.MathJax_Display', '.MJXc-display']),
				candidateRule('mathjax-v2-inline', [
					'.MathJax',
					'.mjx-chtml',
					'.MathJax_CHTML',
					'.MathJax_MathML',
				]),
			],
			matches: (el) =>
				el.matches('.MathJax_Display, .MJXc-display, .MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML'),
			extractTex: extractMathJaxTex,
			getDisplayMode: (el) => el.matches('.MathJax_Display, .MJXc-display') ? 'display' : 'inline',
		},
	];

	ns.detectionRegistry = DETECTION_REGISTRY;
})();
