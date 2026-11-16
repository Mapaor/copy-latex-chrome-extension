(() => {
	const ns = (window.CopyLatex = window.CopyLatex || {});

	// CONTEXT
	// The popup saves this preference in browser.storage.local
	// Keep a local copy because the copy event cannot wait for a storage read
	// Missing preference means the override stays disabled
	let overrideSelectionCopy = false;
	let overrideSelectionCopyPreferenceRevision = 0;

	function setOverrideSelectionCopyPreference(value) {
		overrideSelectionCopy = value === true;
	}

	try {
		browser.storage.onChanged.addListener((changes, areaName) => {
			if (areaName !== 'local' || !changes.overrideSelectionCopy) return;
			overrideSelectionCopyPreferenceRevision += 1;
			setOverrideSelectionCopyPreference(changes.overrideSelectionCopy.newValue);
		});

		// Keep a new setting change if it arrives before this first read finishes
		const initialRevision = overrideSelectionCopyPreferenceRevision;
		browser.storage.local.get('overrideSelectionCopy').then(({ overrideSelectionCopy: preference }) => {
			if (overrideSelectionCopyPreferenceRevision === initialRevision) {
				setOverrideSelectionCopyPreference(preference);
			}
		}).catch((error) => {
			console.warn('[Copy LaTeX] Failed to read selection-copy preference:', error);
		});
	} catch (error) {
		console.warn('[Copy LaTeX] Failed to watch selection-copy preference:', error);
	}

	let pendingSelectionCopyShortcut = false;
	let pendingSelectionCopyTimeout = null;

	function clearPendingSelectionCopyShortcut() {
		pendingSelectionCopyShortcut = false;
		if (pendingSelectionCopyTimeout !== null) {
			window.clearTimeout(pendingSelectionCopyTimeout);
			pendingSelectionCopyTimeout = null;
		}
	}

	// Keep normal copy behavior when the user is editing text
	function isEditableTarget(target) {
		if (document.designMode === 'on') return true;
		const elements = [target, document.activeElement].filter((element) => element instanceof Element);
		return elements.some((element) => element.closest(
			'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'
		));
	}

	// Record the shortcut but do not block the keydown event
	// If conversion fails, the browser can still copy the selected text
	// output.js changes the clipboard text during the copy event
	document.addEventListener('keydown', (event) => {
		if (
			!overrideSelectionCopy ||
			event.defaultPrevented ||
			event.repeat ||
			event.key.toLowerCase() !== 'c' ||
			event.altKey ||
			event.shiftKey ||
			(!event.ctrlKey && !event.metaKey) ||
			isEditableTarget(event.target)
		) {
			return;
		}

		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

		pendingSelectionCopyShortcut = true;
		if (pendingSelectionCopyTimeout !== null) window.clearTimeout(pendingSelectionCopyTimeout);
		pendingSelectionCopyTimeout = window.setTimeout(clearPendingSelectionCopyShortcut, 1000); // Clear the shortcut if no copy event follows
	}, true);

	// Only change the copy event after Ctrl+C or Command+C (when a page selection is active)
	document.addEventListener('copy', (event) => {
		if (!pendingSelectionCopyShortcut) return;
		clearPendingSelectionCopyShortcut();
		if (!overrideSelectionCopy || isEditableTarget(event.target) || event.defaultPrevented) return;
		if (typeof ns.output?.writeSelectionToCopyEvent === 'function') {
			ns.output.writeSelectionToCopyEvent(event);
		}
	}, true);

	// Clear the pending shortcut if no copy event happens
	document.addEventListener('keyup', (event) => {
		if (event.key.toLowerCase() === 'c') clearPendingSelectionCopyShortcut();
	}, true);
	window.addEventListener('blur', clearPendingSelectionCopyShortcut);
})();
