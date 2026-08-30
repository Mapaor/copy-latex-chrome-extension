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

	function isGoogleSearch() {
		const hostname = window.location.hostname;
		return hostname === 'www.google.com' || hostname.endsWith('.google.com') || hostname.startsWith('www.google.');
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

	function findChatGPTTex(el) {
		// New ChatGPT Katex rendering
		const katexEl = el?.closest?.('.katex');
		if (!katexEl) return null;

		const mathSource = katexEl
			.closest('[data-math-source]')
			?.getAttribute('data-math-source');

		if (mathSource?.trim()) {
			return mathSource.trim();
		}

		return null;
	}

	function findAnnotationTex(el) {
		// Typical Katex rendering
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

	function stripTexDelimiters(tex) {
		const value = tex?.trim();
		if (!value) return null;

		const delimiterPairs = [
			['\\[', '\\]'],
			['\\(', '\\)'],
			['$$', '$$'],
			['$', '$'],
		];

		for (const [opening, closing] of delimiterPairs) {
			if (value.startsWith(opening) && value.endsWith(closing)) {
				return value.slice(opening.length, -closing.length).trim() || null;
			}
		}

		return value;
	}

	function findZhihuMathElementFromEventTarget(target) {
		if (!(target instanceof Element)) return null;
		return target.closest?.('.ztext-math[data-tex]') || null;
	}

	function findZhihuTex(el) {
		const mathEl = el?.closest?.('.ztext-math[data-tex]');
		if (!mathEl) return null;

		return stripTexDelimiters(mathEl.getAttribute('data-tex'));
	}

	function findKaTeXElementFromEventTarget(target) {
		if (!(target instanceof Element)) return null;

		// Only treat the hover/click as "KaTeX" when the pointer is actually inside
		// a KaTeX-rendered subtree. Avoid scanning for any descendant `.katex`, because
		// that makes the hit area too broad (e.g. entire lines containing inline math).
		return target.closest?.('.katex') || null;
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

	function findGoogleAIMathTex(el) {
		if (!isGoogleSearch()) return null;
		if (!(el instanceof Element)) return null;

		const latexEl =
			el.closest?.('[data-xpm-copy-root][data-xpm-latex]') ||
			el.closest?.('[data-xpm-latex]');
		if (!latexEl) return null;

		const latex = latexEl.getAttribute('data-xpm-latex');
		return latex && latex.trim() ? latex.trim() : null;
	}

	ns.detect = {
		isWikipedia,
		findWikipediaTex,
		findMathJaxV3Tex,
		findAnnotationTex,
		findZhihuMathElementFromEventTarget,
		findZhihuTex,
		findKaTeXElementFromEventTarget,
		findMathJaxTex,
		findGoogleAIMathTex,
		findChatGPTTex,
	};
})();
