(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		mathJaxV3LatexById: new Map(),
  };


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

	// Candidate rules and detector behavior are kept together in this registry.
	const KATEX_COPY_DUPLICATE_POLICY = {
		id: 'katex-copy-gesture',
		key: 'tex',
		windowMs: 700,
	};
	const SHARED_DETECTOR_CHAIN = [
		'katex-data-math-source',
		'katex-annotation',
		'katex-attributes',
		'data-math',
		'mathjax-v3-v4-api',
		'mathjax-v2',
	];

	const DETECTION_REGISTRY = [
		{
			id: 'wikipedia-mathjax-data-mw',
			candidates: [candidateRule('mathjax-container', ['mjx-container'])],
			matches: (el, context) => context.site === 'wikipedia' && isHtmlElementNamed(el, 'mjx-container'),
			extractTex: extractWikipediaMathJaxDataMwTex,
			getDisplayMode: (el) => el.getAttribute('display') === 'true' ? 'display' : 'inline',
			getOverlayTarget: (el) =>
				el.getAttribute('display') === 'true' ? el.querySelector('svg') || el : el,
		},
		{
			id: 'wikipedia-image-alt',
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
			candidates: [
				candidateRule('google-xpm-copy-root', ['[data-xpm-copy-root][data-xpm-latex]']),
				candidateRule('google-xpm-latex', ['[data-xpm-latex]']),
			],
			matches: (el, context) => context.site === 'google-search' && el.hasAttribute('data-xpm-latex'),
			extractTex: (el) => el.getAttribute('data-xpm-latex'),
		},
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
	const DETECTORS_BY_ID = new Map(DETECTION_REGISTRY.map((detector) => [detector.id, detector]));

	function sameStringList(left, right) {
		return left.length === right.length && left.every((value, index) => value === right[index]);
	}

	function buildCandidateGroupRegistry() {
		const groups = new Map();
		for (const entry of DETECTION_REGISTRY) {
			for (const rule of entry.candidates) {
				const existing = groups.get(rule.group);
				if (existing) {
					const relationsMatch = ['target', 'subtree', 'range'].every((operation) =>
						sameStringList(existing[operation], rule[operation])
					);
					if (!sameStringList(existing.selectors, rule.selectors) || !relationsMatch) {
						throw new Error(`[Copy LaTeX] Conflicting candidate group: ${rule.group}`);
					}
					existing.detectorIds.push(entry.id);
					continue;
				}

				groups.set(rule.group, {
					...rule,
					selector: rule.selectors.join(', '),
					detectorIds: [entry.id],
				});
			}
		}
		return groups;
	}

	const CANDIDATE_GROUPS = buildCandidateGroupRegistry();
	const COMMON_CANDIDATE_GROUPS = [
		'katex',
		'data-math',
		'mathjax-container',
		'mathjax-v2-display',
		'mathjax-v2-inline',
	];
	const SITE_CANDIDATE_PROFILES = {
		wikipedia: {
			id: 'wikipedia',
			targetCandidateGroups: ['wikipedia-images', ...COMMON_CANDIDATE_GROUPS],
			subtreeCandidateGroups: ['wikipedia-images', ...COMMON_CANDIDATE_GROUPS],
			rangeCandidateGroups: ['wikipedia-images', ...COMMON_CANDIDATE_GROUPS],
			detectorChain: ['wikipedia-mathjax-data-mw', 'wikipedia-image-alt', ...SHARED_DETECTOR_CHAIN],
		},
		googleSearch: {
			id: 'google-search',
			targetCandidateGroups: ['google-xpm-copy-root', 'google-xpm-latex', ...COMMON_CANDIDATE_GROUPS],
			subtreeCandidateGroups: ['google-xpm-copy-root', 'google-xpm-latex', ...COMMON_CANDIDATE_GROUPS],
			rangeCandidateGroups: ['google-xpm-copy-root', 'google-xpm-latex', ...COMMON_CANDIDATE_GROUPS],
			detectorChain: ['google-ai-data-xpm', ...SHARED_DETECTOR_CHAIN],
		},
		default: {
			id: 'default',
			targetCandidateGroups: [...COMMON_CANDIDATE_GROUPS],
			subtreeCandidateGroups: [...COMMON_CANDIDATE_GROUPS],
			rangeCandidateGroups: [...COMMON_CANDIDATE_GROUPS],
			detectorChain: SHARED_DETECTOR_CHAIN,
		},
	};
	const candidateGroupCache = new Map();
	const candidateSelectorCache = new Map();
	const detectorChainCache = new Map();
	const reportedDetectorErrors = new Set();

	// ==== CHECKS (boolean helper functions) ====

	function getActiveSiteProfile() {
		if (isWikipedia()) return SITE_CANDIDATE_PROFILES.wikipedia;
		if (isGoogleSearch()) return SITE_CANDIDATE_PROFILES.googleSearch;
		return SITE_CANDIDATE_PROFILES.default;
	}

	function getDetectorChain(profile) {
		if (detectorChainCache.has(profile.id)) return detectorChainCache.get(profile.id);
		const chain = profile.detectorChain.map((detectorId) => {
			const detector = DETECTORS_BY_ID.get(detectorId);
			if (!detector) throw new Error(`[Copy LaTeX] Unknown detector: ${detectorId}`);
			return detector;
		});
		detectorChainCache.set(profile.id, chain);
		return chain;
	}

	function getCandidateGroups(profile, operation) {
		const cacheKey = `${profile.id}:${operation}`;
		if (candidateGroupCache.has(cacheKey)) return candidateGroupCache.get(cacheKey);

		const groups = profile[`${operation}CandidateGroups`].map((groupId) => {
			const group = CANDIDATE_GROUPS.get(groupId);
			if (!group) throw new Error(`[Copy LaTeX] Unknown candidate group: ${groupId}`);
			return group;
		});
		candidateGroupCache.set(cacheKey, groups);
		return groups;
	}

	function getCandidateSelector(profile, operation, relation) {
		const cacheKey = `${profile.id}:${operation}:${relation}`;
		if (candidateSelectorCache.has(cacheKey)) return candidateSelectorCache.get(cacheKey);

		const selectors = new Set();
		for (const group of getCandidateGroups(profile, operation)) {
			if (group[operation].includes(relation)) {
				for (const selector of group.selectors) selectors.add(selector);
			}
		}
		const combinedSelector = [...selectors].join(', ');
		candidateSelectorCache.set(cacheKey, combinedSelector);
		return combinedSelector;
	}

	function candidateMatches(el, profile, operation, relation) {
		const selector = getCandidateSelector(profile, operation, relation);
		return el instanceof Element && selector !== '' && el.matches(selector);
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
		if (!el?.classList?.contains('katex')) return null;
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


	// Get which elements to inspect based on the targeted element (hovered, clicked or selected element).
	function getCandidateElementsFromTarget(target, profile = getActiveSiteProfile()) {
		if (!(target instanceof Element)) return [];

		const groups = getCandidateGroups(profile, 'target');
		const nearestByGroup = new Map();
		let current = target;
		let isTarget = true;

		// Walk the target's ancestor chain once, remembering the nearest match per group.
		while (current instanceof Element) {
			for (const group of groups) {
				if (nearestByGroup.has(group.group)) continue;
				const relation = isTarget ? 'self' : 'ancestors';
				if (group.target.includes(relation) && current.matches(group.selector)) {
					nearestByGroup.set(group.group, current);
				}
			}
			current = current.parentElement;
			isTarget = false;
		}

		const candidates = [];
		const seen = new Set();
		const add = (element) => {
			if (element && !seen.has(element)) {
				seen.add(element);
				candidates.push(element);
			}
		};

		for (const group of groups) {
			add(nearestByGroup.get(group.group));
			if (!group.target.includes('descendants')) continue;
			for (const descendant of target.querySelectorAll(group.selector)) add(descendant);
		}
		return candidates;
	}

	function reportDetectorError(detector, stage, error) {
		const key = `${detector.id}:${stage}`;
		if (reportedDetectorErrors.has(key)) return;
		reportedDetectorErrors.add(key);
		console.error(`[Copy LaTeX] Detector "${detector.id}" failed during ${stage}.`, error);
	}

	function detectMathOnElement(el, profile = getActiveSiteProfile()) {
		if (!(el instanceof Element)) return null;
		const context = { site: profile.id, profile };

		for (const detector of getDetectorChain(profile)) {
			let tex;
			try {
				if (!detector.matches(el, context)) continue;
				tex = detector.extractTex(el, context);
			} catch (error) {
				reportDetectorError(detector, 'match/extract', error);
				continue;
			}

			if (typeof tex !== 'string' || !tex.trim()) continue;
			tex = tex.trim();

			let displayMode = 'inline';
			if (detector.getDisplayMode) {
				try {
					const resolvedMode = detector.getDisplayMode(el, context);
					if (resolvedMode === 'display' || resolvedMode === 'inline') displayMode = resolvedMode;
				} catch (error) {
					reportDetectorError(detector, 'display mode', error);
				}
			}

			let overlayTarget = el;
			if (detector.getOverlayTarget) {
				try {
					const resolvedTarget = detector.getOverlayTarget(el, context);
					if (resolvedTarget instanceof Element) overlayTarget = resolvedTarget;
				} catch (error) {
					reportDetectorError(detector, 'overlay target', error);
				}
			}

			return {
				element: el,
				overlayTarget,
				tex,
				displayMode,
				kind: detector.id,
				duplicatePolicy: detector.duplicatePolicy || null,
			};
		}
		return null;
	}

	// Given a target element, get it's candidates, iterate them and try to get math elements from them
	function detectFromTarget(target) {
		const profile = getActiveSiteProfile();
		for (const candidate of getCandidateElementsFromTarget(target, profile)) {
			const result = detectMathOnElement(candidate, profile);
			if (result) return result;
		}
		return null;
	}

	// Given a DOM node (a root), inspect its root/descendant candidate relationships.
	function findCandidatesWithin(root, profile, operation) {
		if (!(root instanceof Element || root instanceof DocumentFragment)) return [];

		const candidates = [];
		const rootSelector = getCandidateSelector(profile, operation, 'root');
		if (root instanceof Element && rootSelector && root.matches(rootSelector)) {
			candidates.push(root);
		}

		const descendantSelector = getCandidateSelector(profile, operation, 'descendants');
		if (descendantSelector) candidates.push(...root.querySelectorAll(descendantSelector));
		return candidates;
	}

	// Given a root node, we get it's candidate elements, inspect them for math and if math gets detected
	// then filter which detections are good and actually get the math from the detections list
	function detectMathElementsWithin(root) {
		const detections = [];
		const profile = getActiveSiteProfile();
		for (const candidate of findCandidatesWithin(root, profile, 'subtree')) {
			const detection = detectMathOnElement(candidate, profile);
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
		const profile = getActiveSiteProfile();
		const candidates = new Set(findCandidatesWithin(searchRoot, profile, 'range'));

		let ancestor = searchRoot;
		while (ancestor) {
			if (candidateMatches(ancestor, profile, 'range', 'search-root-ancestors')) candidates.add(ancestor);
			ancestor = ancestor.parentElement;
		}

		const detections = [];
		for (const candidate of candidates) {
			if (!range.intersectsNode(candidate)) continue;
			const detection = detectMathOnElement(candidate, profile);
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

	// Publish the detection operations used by main.js and selection-to-markdown.js.
	ns.detect = {
		findCandidatesFromTarget: getCandidateElementsFromTarget,
		detectFromTarget,
		detectMathElementsWithin,
		detectMathElementsInRange,
	};
})();
