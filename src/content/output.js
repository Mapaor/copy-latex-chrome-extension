(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});
	ns.state = ns.state || {
		overlay: null,
		currentTarget: null,
		lastMathJaxV3Latex: null,
		lastCopyGestureTs: 0,
		lastCopiedTex: null,
	};

  // Convert LaTeX to Typst using the tex2typst library
	function latexToTypst(latex) {
		if (!window.tex2typst) {
			console.error('[Copy LaTeX] tex2typst library not loaded');
			return latex; // Fallback to original LaTeX
		}

		try {
			return window.tex2typst(latex); // Library already loaded as a content script
		} catch (error) {
			console.error('[Copy LaTeX] Conversion error:', error);
			return latex; // Fallback to original LaTeX
		}
	}

  // Copy LaTeX or Typst code based on user preference
	async function copyLatex(tex) {
		try {
			let overlay = ns.state.overlay;
			if (!overlay && typeof ns.output?.createOverlay === 'function') {
				overlay = ns.output.createOverlay();
			}

      // Get user's format preference
			const result = await browser.storage.local.get('outputFormat');
			const format = result.outputFormat || 'latex';

			// Convert to Typst if selected
      const outputText = format === 'typst' ? latexToTypst(tex) : tex;

      // Copy to clipboard
			await navigator.clipboard.writeText(outputText);

      // Show success 'Copied!' feedback on the overlay
			overlay.classList.add('copied');
			const span = overlay.querySelector('span');
			span.textContent = 'Copied! ';
			span.appendChild(ns.svg.createSvgFromString(ns.svg.check_svg));
			setTimeout(() => {
				overlay.classList.remove('copied');
				span.textContent = 'Click to copy';
			}, 1500);
		} catch (err) {
			console.error('[Copy LaTeX] Clipboard error:', err);
		}
	}



  // Selection to Markdown (with LaTeX) or to Typst
  // Listen for messages from background script
  browser.runtime.onMessage.addListener((message) => {
		if (message?.type !== 'convertHtmlToMarkdown') return;

		return (async () => {
			if (typeof convertAndCopyHtml !== 'function') {
				return { ok: false, error: 'convertAndCopyHtml is not available' };
			}

      // console.log('[Copy LaTeX] Converting HTML to Markdown, length:', message.html?.length);
			const result = await convertAndCopyHtml(message.html);
			if (!result.ok) return result;

      // Check user's format preference
			const { outputFormat = 'latex' } = await browser.storage.local.get('outputFormat');
			
      // If LaTeX mode (not Typst mode), simply return the Markdown result without conversion
      if (outputFormat !== 'typst') return result;

      // If markdown2typst library not detected, return an error
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

