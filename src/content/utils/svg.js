(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});

	const copy_svg =
		'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4 a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';

	const check_svg =
		'<svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -1 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5 9 17l-5-5"/></svg>';

	function createSvgFromString(svgString) {
    // Use DOMParser to safely parse SVG strings without innerHTML security warnings
		const parser = new DOMParser();
		const doc = parser.parseFromString(svgString, 'image/svg+xml');
		return doc.documentElement;
	}

	ns.svg = {
		copy_svg,
		check_svg,
		createSvgFromString,
	};
})();

