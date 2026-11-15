// DOM helpers
(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});

  function isElement(node) {
    // Nodes can be elements or not (for example text nodes are not elements while mathml nodes are)
    return node instanceof Element;
	}

	function closest(el, selector) {
		return isElement(el) ? el.closest?.(selector) ?? null : null; // Nearest matching ancestor (or null for non-elements/no match)
	}

	ns.dom = {
		isElement,
		closest,
	};
})();
