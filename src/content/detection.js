(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		lastMathJaxV3Latex: null,
		lastCopyGestureTs: 0,
		lastCopiedTex: null,
	};

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

	function findWikipediaTex(el) {
    // Only work on Wikipedia/Wikiwand sites
		if (!isWikipedia()) return null;
		if (!el || el.tagName !== 'IMG') return null;

    // Check if it's a Wikipedia math image
		if (
			el.classList.contains('mwe-math') ||
			el.classList.contains('mwe-math-fallback-image-inline') ||
			el.classList.contains('mwe-math-fallback-image-display')
		) {
			const alt = el.getAttribute('alt');
			if (alt && alt.trim()) {
        // Remove leading '{\displaystyle' and trailing '}'
				const match = alt.trim().match(/^\{\\displaystyle\s*([\s\S]*?)\}$/);
				if (match) return match[1].trim();
				return alt.trim();
			}
		}

		return null;
	}

	function findMathJaxV3Tex(el) {
    // Check for MathJax v3 containers
		const mjxContainer = el?.closest?.('mjx-container');
		if (!mjxContainer) return null;

    // Use the last received LaTeX from the page script
		if (ns.state.lastMathJaxV3Latex) {
			return ns.state.lastMathJaxV3Latex;
		}

    // Fallback: try to find any associated script elements nearby
		let current = mjxContainer;
		for (let i = 0; i < 5; i++) {  // Check a few siblings
			if (!current.nextElementSibling) break;
			current = current.nextElementSibling;
			if (
				current.tagName === 'SCRIPT' &&
				(current.type === 'math/tex' || current.type === 'math/tex; mode=display')
			) {
				return current.textContent.trim();
			}
		}

		return null;
	}

	function findAnnotationTex(el) {
		const katexEl = el?.closest?.('.katex');
		if (!katexEl) return null;

		const ann = katexEl.querySelector(
			'annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"], annotation[encoding="application/tex"]'
		);
		if (ann && ann.textContent.trim()) return ann.textContent.trim();

		const dataLatex =
			katexEl.getAttribute('data-tex') ||
			katexEl.getAttribute('data-latex') ||
			katexEl.getAttribute('aria-label');
		if (dataLatex && dataLatex.trim()) return dataLatex.trim();

		return null;
	}

	function findKaTeXElementFromEventTarget(target) {
		if (!(target instanceof Element)) return null;

		
    // In almost all katex sites event target is inside a .katex span tag
    // Which normally contains two children: katex-html (where the event target is) and katex-mathml (where the TeX expression is stored).
    const closest = target.closest?.('.katex');
		if (closest) return closest;

		const directDescendant = target.querySelector?.('.katex');
		if (directDescendant) return directDescendant;

    // Try a few ancestors and look for a descendant .katex
		let node = target;
		for (let i = 0; i < 4; i++) {
			node = node.parentElement;
			if (!node) break;
			const descendant = node.querySelector?.('.katex');
			if (descendant) return descendant;
		}

		return null;
	}

	function findMathJaxTex(el) {
    // Check for MathJax display equations
		const mathJaxDisplay = el.closest?.('.MathJax_Display, .MJXc-display');
		if (mathJaxDisplay) {
      // Look for the script element after the display div
			let sibling = mathJaxDisplay.nextElementSibling;
			while (sibling) {
				if (sibling.tagName === 'SCRIPT' && sibling.type === 'math/tex; mode=display') {
					return sibling.textContent.trim();
				}
				sibling = sibling.nextElementSibling;
			}
		}

    // Check for MathJax inline equations (various formats)
		const mathJaxInline = el.closest?.('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML');
		if (mathJaxInline) {
      // For traditional MathJax elements with IDs
			if (mathJaxInline.id && mathJaxInline.id.includes('MathJax-Element-')) {
        // Look for the script element after the MathJax span
        let sibling = mathJaxInline.nextElementSibling;
				while (sibling) {
					if (sibling.tagName === 'SCRIPT' && sibling.type === 'math/tex') {
						return sibling.textContent.trim();
					}
					sibling = sibling.nextElementSibling;
				}
			}
      
      // For newer MathJax formats (mjx-chtml, MathJax_CHTML)
      // Look for script elements with math/tex type
			let sibling = mathJaxInline.nextElementSibling;
			while (sibling) {
				if (
					sibling.tagName === 'SCRIPT' &&
					(sibling.type === 'math/tex' || sibling.type === 'math/tex; mode=display')
				) {
					return sibling.textContent.trim();
				}
				sibling = sibling.nextElementSibling;
			}
		}

		return null;
	}

	ns.detect = {
		isWikipedia,
		findWikipediaTex,
		findMathJaxV3Tex,
		findAnnotationTex,
		findKaTeXElementFromEventTarget,
		findMathJaxTex,
	};
})();

