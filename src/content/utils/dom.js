(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});

	function isElement(node) {
		return node instanceof Element;
	}

	function closest(el, selector) {
		return isElement(el) ? el.closest?.(selector) ?? null : null;
	}

	ns.dom = {
		isElement,
		closest,
	};
})();

