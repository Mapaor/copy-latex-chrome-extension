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
	async function copyLatex(tex, { showOverlayFeedback = ns.state.showOverlay !== false } = {}) {
		let overlay = null;
		try {
			if (showOverlayFeedback) {
				overlay = ns.state.overlay;
				if (!overlay && typeof ns.output?.createOverlay === 'function') {
					overlay = ns.output.createOverlay();
				}
			}

      // Get [LaTeX|Typst] preference from local storage
			const result = await browser.storage.local.get('outputFormat');
			const format = result.outputFormat || 'latex';

			// Convert to Typst if selected (if not proceed with the original LaTeX)
      const outputText = format === 'typst' ? latexToTypst(tex) : tex;

      // Copy to clipboard
			await navigator.clipboard.writeText(outputText);

	      // Show 'Copied!' only when overlay feedback is enabled
			if (overlay) {
				overlay.classList.add('copied'); // copied class makes the overlay green
				const span = overlay.querySelector('span');
				if (span) {
					span.textContent = 'Copied! ';
					span.appendChild(ns.svg.createSvgFromString(ns.svg.check_svg)); // Add checkmark SVG icon
					setTimeout(() => {
						overlay.classList.remove('copied');
						span.textContent = 'Click to copy'; // This also removes all child nodes of span (including the SVG checkmark icon)
					}, 1500); // Restore the overlay after 1.5s
				}
			}
			return { ok: true, format };
		} catch (err) {
			console.error('[Copy LaTeX] Clipboard error:', err);
			return { ok: false, error: String(err) };
		}
	}



	// Keep the output format ready because the copy event cannot wait for storage
	// If the setting has not loaded yet, let the browser copy the selection as usual
	let cachedOutputFormat = 'latex';
	let outputFormatLoaded = false;
	let outputFormatPreferenceRevision = 0;

	function setOutputFormatPreference(value) {
		cachedOutputFormat = value === 'typst' ? 'typst' : 'latex';
		outputFormatLoaded = true;
	}

	try {
		browser.storage.onChanged.addListener((changes, areaName) => {
			if (areaName !== 'local' || !changes.outputFormat) return;
			outputFormatPreferenceRevision += 1;
			setOutputFormatPreference(changes.outputFormat.newValue);
		});

		// Keep a new setting change if it arrives before this first read finishes
		const initialRevision = outputFormatPreferenceRevision;
		browser.storage.local.get('outputFormat').then(({ outputFormat }) => {
			if (outputFormatPreferenceRevision === initialRevision) setOutputFormatPreference(outputFormat);
		}).catch((error) => {
			console.warn('[Copy LaTeX] Failed to read output format preference:', error);
		});
	} catch (error) {
		console.warn('[Copy LaTeX] Failed to watch output format preference:', error);
	}

	// Convert the selection and choose its output format without copying it yet
	// This runs during the copy event, before the browser copies the text
	function prepareSelectionOutput(selection, format) {
		if (typeof ns.selection?.toMarkdown !== 'function') {
			return { ok: false, error: 'Selection-to-Markdown conversion is not available' };
		}

		try {
			const markdown = ns.selection.toMarkdown(selection);
			if (!markdown) return { ok: false, error: 'No content' };
			if (format !== 'typst') return { ok: true, text: markdown, format: 'latex' };
			if (typeof window.markdown2typst !== 'function') {
				return { ok: false, error: 'markdown2typst library not loaded' };
			}
			return { ok: true, text: window.markdown2typst(markdown), format: 'typst' };
		} catch (error) {
			console.error('[Copy LaTeX] Selection conversion error:', error);
			return { ok: false, error: String(error) };
		}
	}

	// Method 1: Try the browser clipboard API
	async function copyTextToClipboard(text) {
		try {
			if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable');
			await navigator.clipboard.writeText(text);
			return { ok: true, method: 'navigator_api' };
		} catch (clipboardError) {
			// Method 2: If the clipboard API fails, use a temporary textarea and execCommand instead
			let textBox;
			try {
				textBox = document.createElement('textarea');
				textBox.value = text;
				textBox.setAttribute('readonly', '');
				textBox.style.position = 'fixed';
				textBox.style.opacity = '0';
				document.body.appendChild(textBox);
				textBox.select();
				if (!document.execCommand('copy')) throw new Error('execCommand returned false');
				return { ok: true, method: 'textarea' };
			} catch (fallbackError) {
				console.error('[Copy LaTeX] Selection clipboard error:', clipboardError, fallbackError);
				return { ok: false, error: `${fallbackError.name} ${fallbackError.message}` };
			} finally {
				textBox?.remove();
			}
		}
	}

	// Ctrl+C starts a copy event. Set clipboardData before the browser copies the text
	function writeSelectionToCopyEvent(event) {
		if (!outputFormatLoaded || !event?.clipboardData) return false;
		const result = prepareSelectionOutput(window.getSelection(), cachedOutputFormat);
		if (!result.ok) return false;

		try {
			event.clipboardData.setData('text/plain', result.text);
			event.preventDefault();
			return true;
		} catch (error) {
			console.warn('[Copy LaTeX] Could not write selection to copy event:', error);
			return false;
		}
	}

	async function convertAndCopySelection(selection) {
		const prepared = prepareSelectionOutput(selection, cachedOutputFormat);
		if (!prepared.ok) return prepared;
		const clipboardResult = await copyTextToClipboard(prepared.text);
		if (!clipboardResult.ok) return clipboardResult;
		return { ok: true, format: prepared.format, method: clipboardResult.method };
	}

	// SINGLE EQUATION CONTEXT MENU (For hidden overlay)
	// Copy the equation (cached by main.js)
	browser.runtime.onMessage.addListener((message) => {
		if (message?.type !== 'copyContextEquation') return;

		return (async () => {
			const snapshot = ns.state.contextMenuEquation;
			ns.state.contextMenuEquation = null;
			if (!snapshot?.tex || Date.now() - snapshot.timestamp > 30_000) {
				return { ok: false, error: 'No recent equation was detected under the context menu' };
			}
			return copyLatex(snapshot.tex, { showOverlayFeedback: false });
		})();
	});

	// SELECTION COPY
	// The background script sends this request after the context-menu item is clicked
	// selection-to-markdown.js reads the live selection, clones it and converts the HTML to Markdown
	// output.js converts the Markdown to Typst when needed and copies the result
	browser.runtime.onMessage.addListener((message) => {
		if (message?.type !== 'convertSelectionToMarkdown') return;
		return convertAndCopySelection(window.getSelection());
	});

	ns.output = ns.output || {};
	Object.assign(ns.output, {
		latexToTypst,
		copyLatex,
		writeSelectionToCopyEvent,
	});
})();
