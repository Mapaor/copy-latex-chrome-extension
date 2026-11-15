(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		mathJaxV3LatexById: new Map(),
	};

	const DETECTION_REGISTRY = ns.detectionRegistry;
	if (!Array.isArray(DETECTION_REGISTRY)) {
		throw new Error('[Copy LaTeX] detection-registry.js must load before detection.js');
	}
	delete ns.detectionRegistry;

	function sameStringList(left, right) {
		return left.length === right.length && left.every((value, index) => value === right[index]);
	}

	function buildCandidateGroupRegistry() {
		const groups = new Map();
		const detectorIds = new Set();
		for (const entry of DETECTION_REGISTRY) {
			if (!entry.id || detectorIds.has(entry.id)) {
				throw new Error(`[Copy LaTeX] Missing or duplicate detector ID: ${entry.id}`);
			}
			detectorIds.add(entry.id);
			if (entry.site && typeof entry.appliesTo !== 'function') {
				throw new Error(`[Copy LaTeX] Site detector "${entry.id}" requires appliesTo()`);
			}
			for (const rule of entry.candidates) {
				const existing = groups.get(rule.group);
				if (existing) {
					const relationsMatch = ['target', 'subtree', 'range'].every((operation) =>
						sameStringList(existing[operation], rule[operation])
					);
					if (!sameStringList(existing.selectors, rule.selectors) || !relationsMatch) {
						throw new Error(`[Copy LaTeX] Conflicting candidate group: ${rule.group}`);
					}
					continue;
				}

				groups.set(rule.group, {
					...rule,
					selector: rule.selectors.join(', '),
				});
			}
		}
		return groups;
	}

	const CANDIDATE_GROUPS = buildCandidateGroupRegistry();
	const candidateGroupCache = new Map();
	const candidateSelectorCache = new Map();
	const detectorChainCache = new Map();
	const reportedDetectorErrors = new Set();

	function getActiveSiteProfile() {
		const applicableSiteDetectors = DETECTION_REGISTRY.filter(
			(detector) => detector.site && detector.appliesTo()
		);
		const id = applicableSiteDetectors[0]?.site || 'default';
		const siteSpecificDetectors = applicableSiteDetectors.filter((detector) => detector.site === id);
		const cacheKey = `${id}:${siteSpecificDetectors.map(({ id: detectorId }) => detectorId).join(',')}`;
		return { id, cacheKey, siteSpecificDetectors };
	}

	function getDetectorChain(profile) {
		if (detectorChainCache.has(profile.cacheKey)) return detectorChainCache.get(profile.cacheKey);
		const shared = DETECTION_REGISTRY.filter((detector) => !detector.site);
		const chain = [...profile.siteSpecificDetectors, ...shared];
		detectorChainCache.set(profile.cacheKey, chain);
		return chain;
	}

	function getCandidateGroups(profile, operation) {
		const cacheKey = `${profile.cacheKey}:${operation}`;
		if (candidateGroupCache.has(cacheKey)) return candidateGroupCache.get(cacheKey);

		const siteSpecific = profile.siteSpecificDetectors;
		const shared = DETECTION_REGISTRY.filter((detector) => !detector.site);
		const sharedGroupIds = new Set(shared.flatMap((detector) => detector.candidates.map(({ group }) => group)));
		const orderedGroupIds = [];
		const seen = new Set();
		const addGroups = (entries, isShared) => {
			for (const entry of entries) {
				for (const rule of entry.candidates) {
					if (!rule[operation].length) continue;
					if (!isShared && sharedGroupIds.has(rule.group)) continue;
					if (seen.has(rule.group)) continue;
					seen.add(rule.group);
					orderedGroupIds.push(rule.group);
				}
			}
		};
		addGroups(siteSpecific, false);
		addGroups(shared, true);

		const groups = orderedGroupIds.map((groupId) => {
			const group = CANDIDATE_GROUPS.get(groupId);
			if (!group) throw new Error(`[Copy LaTeX] Unknown candidate group: ${groupId}`);
			return group;
		});
		candidateGroupCache.set(cacheKey, groups);
		return groups;
	}

	function getCandidateSelector(profile, operation, relation) {
		const cacheKey = `${profile.cacheKey}:${operation}:${relation}`;
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
