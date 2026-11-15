(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,

	};

  // Translate LaTeX equations to Typst equations using the tex2typst library
	function latexToTypst(latex) {
		if (!window.tex2typst) {
			console.error('[Copy LaTeX] tex2typst library not loaded');
			return latex; // Fallback to original LaTeX if the library is not found
		}

		try {
			return window.tex2typst(latex);
		} catch (error) {
			console.error('[Copy LaTeX] Conversion error:', error);
			return latex; // Fallback to original LaTeX if the library failed (can happen in some advanced LaTeX equations)
		}
	}

	// SINGLE EQUATION COPY
	async function copyLatex(tex) {
		try {
			let overlay = ns.state.overlay;
			if (!overlay && typeof ns.output?.createOverlay === 'function') {
				overlay = ns.output.createOverlay();
			}

      // Get [LaTeX|Typst] preference from local storage
			const result = await browser.storage.local.get('outputFormat');
			const format = result.outputFormat || 'latex';

			// Convert to Typst if selected (if not proceed with the original LaTeX)
      const outputText = format === 'typst' ? latexToTypst(tex) : tex;

      // Copy to clipboard
			await navigator.clipboard.writeText(outputText);

      // Show 'Copied!' on the overlay
			overlay.classList.add('copied'); // copied class makes the overlay green
			const span = overlay.querySelector('span');
			span.textContent = 'Copied! ';
			span.appendChild(ns.svg.createSvgFromString(ns.svg.check_svg)); // Add checkmark SVG icon
			setTimeout(() => {
				overlay.classList.remove('copied');
				span.textContent = 'Click to copy'; // This also removes all child nodes of span (including the SVG checkmark icon)
			}, 1500); // Restore the overlay after 1.5s
		} catch (err) {
			console.error('[Copy LaTeX] Clipboard error:', err);
		}
	}



	// SELECTION COPY
  // The background.js script sends the (selection conversion) request
  // selection-to-markdown.js reads the selection, clones it and converts the HTML to markdown
  // output.js reads the markdown, if needed converts it to Typst, and finally copies the result to the clipboard
	browser.runtime.onMessage.addListener((message) => {
		if (message?.type !== 'convertSelectionToMarkdown') return;

		return (async () => {
			if (typeof convertAndCopySelection !== 'function') {
				return { ok: false, error: 'convertAndCopySelection is not available' };
			}

			const result = await convertAndCopySelection(window.getSelection()); // This gets the markdown but also copies it to the clipboard
			if (!result.ok) return result;

      // Check [LaTeX|Typst] preference from local storage
			const { outputFormat = 'latex' } = await browser.storage.local.get('outputFormat');

      // Convert to Typst if selected (if not exit with the markdown)
      if (outputFormat !== 'typst') return result;

      // Check markdown2typst library is present
			if (!window.markdown2typst) {
				console.error('[Copy LaTeX] markdown2typst library not loaded');
				return { ok: false, error: 'markdown2typst library not loaded' };
			}

			try {
        // Get the markdown from clipboard (we just copied it)
				const markdown = await navigator.clipboard.readText();
				const typst = window.markdown2typst(markdown);

        // Copy typst back to clipboard
				await navigator.clipboard.writeText(typst);
        // console.log('[Copy LaTeX] Converted to Typst and copied');

				return { ok: true, format: 'typst' };

			} catch (error) {
				console.error('[Copy LaTeX] Typst conversion error:', error);
				return { ok: false, error: String(error) };
			}
		})();
	});

	ns.output = ns.output || {};
	Object.assign(ns.output, {
		latexToTypst,
		copyLatex,
	});
})();
