// This page-world bridge maps MathJax MathItems to their exact mjx-container
// roots, then sends the association to the isolated content-script world.
(function () {
	const OUTPUT_ID_ATTRIBUTE = 'data-copy-latex-mathjax-id';
	const MESSAGE_TYPE = 'CopyLaTeX_MathJaxIndex';
	const BATCH_SIZE = 100;
	const MAX_INDEX_ENTRIES = 2000;
	const MAX_LATEX_LENGTH = 100_000;
	const randomToken = Math.random().toString(36).slice(2) || '0';
	const idPrefix = `copy-latex-mjx-${Date.now().toString(36)}-${randomToken}-`;

	let mathjax = null;
	let pendingMathJax = null;
	let nextId = 0;
	let rebuildScheduled = false;
	const sourcesById = new Map();
	const rootsById = new Map();

	function isSupportedMathJax(candidate) {
		const version = candidate?.version;
		return Boolean(version && (version.startsWith('3') || version.startsWith('4')));
	}

	function getMathItems(candidate) {
		const mathDocument = candidate?.startup?.document;
		if (!mathDocument) return [];

		if (typeof mathDocument.getMathItemsWithin === 'function') {
			try {
				return mathDocument.getMathItemsWithin(document.body || document.documentElement) || [];
			} catch (error) {
				console.warn('[Copy LaTeX] MathJax getMathItemsWithin failed:', error);
			}
		}

		// Fallback for integrations where the convenience API is unavailable.
		const list = mathDocument.math?.list;
		if (!list) return [];

		const items = [];
		const visited = new Set();
		let current = list;
		while (current && !visited.has(current)) {
			visited.add(current);
			if (current.data) items.push(current.data);
			current = current.next;
		}
		return items;
	}

	function getOutputRoot(mathItem) {
		const root = mathItem?.typesetRoot;
		if (root?.nodeType !== Node.ELEMENT_NODE) return null;
		if (root.matches('mjx-container')) return root;

		// Some integrations may expose a wrapper as typesetRoot. Accept it only
		// when it contains exactly one MathJax output root, avoiding ambiguous matches.
		const nestedRoots = root.querySelectorAll('mjx-container');
		return nestedRoots.length === 1 ? nestedRoots[0] : null;
	}

	function getOrAssignId(root, usedIds) {
		let id = root.getAttribute(OUTPUT_ID_ATTRIBUTE);
		if (!id?.startsWith(idPrefix) || usedIds.has(id)) {
			id = `${idPrefix}${++nextId}`;
			root.setAttribute(OUTPUT_ID_ATTRIBUTE, id);
		}
		usedIds.add(id);
		return id;
	}

	function postIndexChanges(updates, removedIds) {
		const batchCount = Math.max(
			Math.ceil(updates.length / BATCH_SIZE),
			Math.ceil(removedIds.length / BATCH_SIZE)
		);
		for (let batch = 0; batch < batchCount; batch++) {
			window.postMessage(
				{
					type: MESSAGE_TYPE,
					version: 1,
					updates: updates.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE),
					removedIds: removedIds.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE),
				},
				'*'
			);
		}
	}

	function rebuildIndex() {
		if (!mathjax) return;

		const nextSources = new Map();
		const nextRoots = new Map();
		const usedIds = new Set();
		for (const mathItem of getMathItems(mathjax)) {
			if (nextSources.size >= MAX_INDEX_ENTRIES) break;
			const root = getOutputRoot(mathItem);
			const latex = typeof mathItem.math === 'string' ? mathItem.math.trim() : '';
			if (!root?.isConnected || !latex || latex.length > MAX_LATEX_LENGTH) continue;

			const id = getOrAssignId(root, usedIds);
			nextSources.set(id, latex);
			nextRoots.set(id, root);
		}

		const updates = [];
		for (const [id, latex] of nextSources) {
			if (sourcesById.get(id) !== latex) updates.push({ id, latex });
		}

		const removedIds = [];
		for (const [id, root] of rootsById) {
			if (nextRoots.has(id)) continue;
			removedIds.push(id);
			if (root.getAttribute(OUTPUT_ID_ATTRIBUTE) === id) root.removeAttribute(OUTPUT_ID_ATTRIBUTE);
		}

		sourcesById.clear();
		rootsById.clear();
		for (const [id, latex] of nextSources) sourcesById.set(id, latex);
		for (const [id, root] of nextRoots) rootsById.set(id, root);
		postIndexChanges(updates, removedIds);
	}

	function nodeContainsMathJaxOutput(node) {
		if (!(node instanceof Element)) return false;
		return node.matches('mjx-container') || Boolean(node.querySelector('mjx-container'));
	}

	function mutationTouchesMathJaxOutput(mutation) {
		const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
		if (target?.closest?.('mjx-container')) return true;
		for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
			if (nodeContainsMathJaxOutput(node)) return true;
		}
		return false;
	}

	function scheduleIndexRebuild() {
		if (rebuildScheduled) return;
		rebuildScheduled = true;
		const rebuild = () => {
			rebuildScheduled = false;
			rebuildIndex();
		};
		if (typeof window.requestAnimationFrame === 'function') {
			window.requestAnimationFrame(rebuild);
		} else {
			window.setTimeout(rebuild, 0);
		}
	}

	function startProvider(candidate) {
		if (mathjax === candidate || !candidate?.startup?.document) return false;
		mathjax = candidate;
		rebuildIndex();

		const outputObserver = new MutationObserver((mutations) => {
			if (mutations.some(mutationTouchesMathJaxOutput)) scheduleIndexRebuild();
		});
		outputObserver.observe(document.documentElement, { childList: true, subtree: true });
		return true;
	}

	function tryInitialize() {
		const candidate = window.MathJax;
		if (!isSupportedMathJax(candidate)) return false;
		if (candidate === mathjax || candidate === pendingMathJax) return true;

		const startupPromise = candidate.startup?.promise;
		if (startupPromise && typeof startupPromise.then === 'function') {
			pendingMathJax = candidate;
			startupPromise.then(
				() => {
					if (pendingMathJax === candidate) pendingMathJax = null;
					if (window.MathJax === candidate) startProvider(candidate);
				},
				(error) => {
					if (pendingMathJax === candidate) pendingMathJax = null;
					console.warn('[Copy LaTeX] MathJax startup failed:', error);
				}
			);
			return true;
		}

		return startProvider(candidate);
	}

	function watchForLateMathJax() {
		if (tryInitialize()) return;

		let startupObserver = null;
		const retryInitialization = () => {
			const started = tryInitialize();
			const current = window.MathJax;
			const unsupportedVersion = current?.version && !isSupportedMathJax(current);
			if (started || unsupportedVersion) startupObserver?.disconnect();
			return started;
		};

		for (const script of document.querySelectorAll('script[src*="mathjax" i]')) {
			script.addEventListener('load', retryInitialization);
		}

		const candidate = window.MathJax;
		if (!candidate || (candidate.version && !isSupportedMathJax(candidate)) || !document.documentElement) return;

		// Only wait on pages that already expose a MathJax config object; ordinary
		// non-MathJax pages and MathJax v2 pages pay no observer cost.
		startupObserver = new MutationObserver(retryInitialization);
		startupObserver.observe(document.documentElement, { childList: true, subtree: true });
		const stopWaiting = () => {
			if (!retryInitialization()) startupObserver?.disconnect();
		};
		if (document.readyState === 'complete') {
			window.setTimeout(stopWaiting, 1000);
		} else {
			window.addEventListener('load', stopWaiting, { once: true });
		}
	}

	watchForLateMathJax();
})();
