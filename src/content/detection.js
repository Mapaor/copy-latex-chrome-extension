(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		lastMathJaxV3Latex: null,
		lastCopyGestureTs: 0,
		lastCopiedTex: null,
  };

	// BIG TODO: Refactor the whole detectors (that serve different purposes) like detectMathOnElement or getDisplayMode or getCandidateElementsFromTarget
	// into a single registry so that a new 'kind' of math rendering can be easily added on a single place.
	// In the new the approach each registry entry will have its specific match condition, candidate selectors,
	// TeX extraction, display mode and overlay target. Also add metadata like a supressDuplicateCopy flag (for main.js)

  const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

	const CANDIDATE_SELECTOR = [ // CSS Selectors for good descendant candidates
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


	// ==== CHECKS (boolean helper functions) ====

	function candidateMatches(el) {
		return el instanceof Element && el.matches(CANDIDATE_SELECTOR);
	}

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

	function extractWikipediaTex(el) {
		if (!isWikipedia()) return null;

		// New Wikipedia math output includes the original source in MediaWiki's data-mw.
		if (isHtmlElementNamed(el, 'mjx-container')) {
			const mathElement = el.querySelector('.mwe-math-element[data-mw]');
			try {
				const source = JSON.parse(mathElement?.getAttribute('data-mw') || '').body?.extsrc;
				if (typeof source === 'string' && source.trim()) return source.trim();
			} catch {
				// Ignore absent or malformed metadata and let the old detection run.
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
		// Remove the '{}' wrapper and the \displaystyle that appears at the beggining
		const match = alt.trim().match(/^\{\\displaystyle\s*([\s\S]*?)\}$/);
		return match ? match[1].trim() : alt.trim();
	}

	function extractMathJaxV3Tex(el) {
		// MathJax v3/v4 renders into an HTML custom element `mjx-container`, not a MathML <math> node.
		const mjxContainer = isHtmlElementNamed(el, 'mjx-container') ? el : null;
		if (!mjxContainer) return null;

		// We fetch the LaTeX code using the MathJax API via the mathjax-bridge.js injected script (which posts it as a message in ns.state)
		if (ns.state.lastMathJaxV3Latex) return ns.state.lastMathJaxV3Latex;

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
		if (!el?.classList?.contains('katex')) return null;
		const mathSource = el.closest('[data-math-source]')?.getAttribute('data-math-source');
		return mathSource?.trim() || null;
	}

	// Most KaTeX renderers commonly keep TeX inside MathML annotation (or data) attributes
	function extractAnnotationTex(el) {
		if (!el?.classList?.contains('katex')) return null;

		const annotation = el.querySelector(
			'annotation[encoding="application/x-tex"], ' +
			'annotation[encoding="application/x-latex"], ' +
			'annotation[encoding="application/tex"]'
		);
		if (annotation?.textContent.trim()) return annotation.textContent.trim();

		// It's also common to find the source code in a data or aria-label attribute inside the katex MathML node
		const dataLatex =
			el.getAttribute('data-tex') ||
			el.getAttribute('data-latex') ||
			el.getAttribute('aria-label');
		return dataLatex?.trim() || null;
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

		// If it has a MathJax-Element-[something] class, it won't contain mode=display
		if (mathJaxInline.id?.includes('MathJax-Element-')) {
			let sibling = mathJaxInline.nextElementSibling;
			while (sibling) {
				if (isHtmlElementNamed(sibling, 'script') && sibling.type === 'math/tex') {
					return sibling.textContent.trim() || null;
				}
				sibling = sibling.nextElementSibling;
			}
		}

		// If it does not have a MathJax-Element-[something] class, it will contain mode=display deespite being an inline equation
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

	// Google search in AI mode renderers math in a custom way, it exposes the latex code in a data-xpm-latex attirbute
	function extractGoogleAIMathTex(el) {
		if (!isGoogleSearch() || !el?.hasAttribute?.('data-xpm-latex')) return null;
		const latex = el.getAttribute('data-xpm-latex');
		return latex?.trim() || null;
	}

	// Get which elements to inspect based on the targeted element (hovered, clicked or selected element)
  function getCandidateElementsFromTarget(target) {
    // Important note: We only target ancestors of the target element, which is where the LaTeX code is in most of the cases
    // If we also considered descendants it would make the hit area too broad (for example, whole text lines)
    // There might be some very specific cases in which the hitted target is an ancestor of the element containing the LaTeX source code, but we don't handle these niche cases

    if (!(target instanceof Element)) return []; // If hitted target is not an element exit

		const candidates = []; // List of all candidates elements that might contain the LaTeX source code
		const add = (el) => { // Function that takes an element and adds it to the candidates list (if it's not there already)
			if (el && !candidates.includes(el)) candidates.push(el);
		};

		// Check site-specific candidates only if we are on that site
		if (isWikipedia()) add(target.closest('img.mwe-math, img.mwe-math-fallback-image-inline, img.mwe-math-fallback-image-display'));
		if (isGoogleSearch()) {
			add(target.closest('[data-xpm-copy-root][data-xpm-latex]'));
			add(target.closest('[data-xpm-latex]'));
    }

		// Check KaTeX and MathJax typicall candidates
		add(target.closest('.katex'));
		add(target.closest('[data-math]'));
		add(target.closest('mjx-container'));
		add(target.closest('.MathJax_Display, .MJXc-display'));
    add(target.closest('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML'));

		return candidates;
	}

	// Check if an equation is an 'inline' equation or a 'display' (block) equation
	// We pass the 'kind' parameter where we previously have detected which type of equation is
	// from our list of supported kinds (equations we know how to detect)
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
			// These equations that contain the latex in a data-math attribute use divs for block equations and span for inline equations
			return isHtmlElementNamed(el, 'div') ? 'display' : 'inline';
		}
		return 'inline';
  }

	// If an element could be detected, this function sets its 'kind'
	function detectMathOnElement(el) {
		if (!(el instanceof Element)) return null;
		let tex = null;
		let kind = null;

		// TODO: Replace these ifs with a switch statement

    if (isWikipedia()) {
      tex = extractWikipediaTex(el);
      if (tex) kind = 'wikipedia';
    }

		if (!tex && isGoogleSearch() && el.hasAttribute('data-xpm-latex')) {
			tex = extractGoogleAIMathTex(el);
			if (tex) kind = 'google-ai';
		}

		if (!tex && el.classList.contains('katex')) {
			tex = extractChatGPTTex(el) || extractAnnotationTex(el);
			if (tex) kind = 'katex';
		}

		if (!tex && el.hasAttribute('data-math')) {
			tex = el.getAttribute('data-math')?.trim() || null;
			if (tex) kind = 'data-math';
		}

		if (!tex && isHtmlElementNamed(el, 'mjx-container')) {
			tex = extractMathJaxV3Tex(el);
			if (tex) kind = 'mathjax-v3';
		}

		if (!tex && el.matches('.MathJax_Display, .MJXc-display, .MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML')) {
			tex = extractMathJaxTex(el);
			if (tex) kind = 'mathjax-v2';
		}

    if (!tex) return null;

    const displayMode = getDisplayMode(el, kind);

		// Choose to which element the Overlay should attach to
		// For all equations is just the container itself, but for Wikipedia new math its
		// better if its the SVG instead of the MathJax container, because in Wikipedia display equations are
		// not centered (the SVG appears at the left) whereas the container occupies full width, if we targeted it the
		// overlay would not appear above the equation, it would appear at its right.
		const overlayTarget =
			kind === 'wikipedia' && displayMode === 'display' && isHtmlElementNamed(el, 'mjx-container')
				? el.querySelector('svg') || el
        : el;

		return { element: el, overlayTarget, tex, displayMode, kind };
	}

	// Given a target element, get it's candidates, iterate them and try to get math elements from them
	function detectFromTarget(target) {
		for (const candidate of getCandidateElementsFromTarget(target)) {
			const result = detectMathOnElement(candidate);
			if (result) return result;
		}
		return null;
	}

	// Given a DOM node (a root) we inspect its descendants
	function findCandidatesWithin(root) {
		if (!(root instanceof Element || root instanceof DocumentFragment)) return [];

    const candidates = [];
    if (root instanceof Element && candidateMatches(root)) {
      candidates.push(root); // Add the root itself if it's a candidate
    }

    // Add descendant elements if they are good candidates
		candidates.push(...root.querySelectorAll(CANDIDATE_SELECTOR));
		return candidates;
	}

	// Given a root node, we get it's candidate elements, inspect them for math and if math gets detected
	// then filter which detections are good and actually get the math from the detections list
	function detectMathElementsWithin(root) {
		const detections = [];
		for (const candidate of findCandidatesWithin(root)) {
			const detection = detectMathOnElement(candidate);
			if (!detection) continue;
			if (detections.some(({ element }) => element.contains(candidate))) continue;
			for (let i = detections.length - 1; i >= 0; i--) {
				if (candidate.contains(detections[i].element)) detections.splice(i, 1);
			}
			detections.push(detection);
		}
		return detections;
	}

	// A selection range can start and end inside an equation root
	// so in case of partially selected equations we still clone the whole equation
	function detectMathElementsInRange(range) {
		const commonAncestor = range.commonAncestorContainer;
		const searchRoot = commonAncestor instanceof Element ? commonAncestor : commonAncestor.parentElement;
		const candidates = new Set(findCandidatesWithin(searchRoot));

		let ancestor = searchRoot;
		while (ancestor) {
			if (candidateMatches(ancestor)) candidates.add(ancestor);
			ancestor = ancestor.parentElement;
		}

		const detections = [];
		for (const candidate of candidates) {
			if (!range.intersectsNode(candidate)) continue;
			const detection = detectMathOnElement(candidate);
			if (!detection) continue;
			// Keep only the outermost detected element if selectors overlap
			if (detections.some(({ element }) => element.contains(candidate))) continue;
			for (let i = detections.length - 1; i >= 0; i--) {
				if (candidate.contains(detections[i].element)) detections.splice(i, 1);
			}
			detections.push(detection);
		}

		detections.sort((a, b) => {
      if (a.element === b.element) return 0;
			// Set the document position (kinda like a z-index) of the detection
			return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
		});
		return detections;
	}

	// Publish the detectors (for main.js and selection-to-markdown.js)
	ns.detect = {
		isWikipedia,
		isGoogleSearch,
		extractWikipediaTex,
		extractMathJaxV3Tex,
		extractAnnotationTex,
		extractMathJaxTex,
		extractGoogleAIMathTex,
		extractChatGPTTex,
		findCandidateAncestors: getCandidateElementsFromTarget,
		detectFromTarget,
		detectMathOnElement,
		detectMathElementsWithin,
		detectMathElementsInRange,
	};
})();
