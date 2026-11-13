// Convert the live selection to Markdown and copy it to the clipboard.
// Kept as a classic script for Firefox MV3 compatibility.
// Only exposes `convertAndCopySelection` on globalThis.

(() => {
  async function convertAndCopySelection(selection) {
    try {
      const markdown = await convertSelectionToLatexMarkdown(selection);
      if (!markdown) return { ok: false, error: 'No content' };
      return await copyToClipboard(markdown);
    } catch (error) {
      console.error('[Copy LaTeX] Error in convertAndCopySelection:', error);
      return { ok: false, error: String(error) };
    }
  }

  // Turndown preserves this marker while the rendered math subtree is discarded.
  function createLatexMarker(detection) {
    const delimiter = detection.displayMode === 'display' ? '$$' : '$';
    const marker = document.createElement('span');
    marker.className = 'latex-marker';
    marker.textContent = `${delimiter}${detection.tex}${delimiter}`;
    marker.setAttribute('data-latex-mode', detection.displayMode);
    return marker;
  }

  // Clone only selected content. Math roots are replaced as units, even if a range
  // clips through one; ordinary text nodes are still clipped to the selected offsets.
  function cloneSelectedNode(node, range, detectionsByElement) {
    if (!range.intersectsNode(node)) return null;

    const detection = detectionsByElement.get(node);
    if (detection) return createLatexMarker(detection);

    if (node.nodeType === Node.TEXT_NODE) {
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : node.length;
      if (start >= end) return null;
      return document.createTextNode(node.textContent.slice(start, end));
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const clone = node.cloneNode(false);
      for (const child of node.childNodes) {
        const selectedChild = cloneSelectedNode(child, range, detectionsByElement);
        if (selectedChild) clone.appendChild(selectedChild);
      }
      return clone;
    }

    return node.cloneNode();
  }

  // Find roots in the live DOM before cloning so endpoint ancestors and renderer
  // metadata remain available without serializing page HTML through the background.
  function cloneRangeWithMathMarkers(range) {
    const fragment = document.createDocumentFragment();
    const detections = window.CopyLatex.detect.findMathElementsInRange(range);
    const detectionsByElement = new Map(
      detections.map((detection) => [detection.element, detection])
    );

    const enclosingMath = detections.find(
      ({ element }) =>
        element.contains(range.startContainer) && element.contains(range.endContainer)
    );
    if (enclosingMath) {
      fragment.appendChild(createLatexMarker(enclosingMath));
      return fragment;
    }

    const commonAncestor = range.commonAncestorContainer;
    if (commonAncestor.nodeType === Node.TEXT_NODE) {
      const selectedText = cloneSelectedNode(commonAncestor, range, detectionsByElement);
      if (selectedText) fragment.appendChild(selectedText);
      return fragment;
    }

    for (const child of commonAncestor.childNodes) {
      const selectedChild = cloneSelectedNode(child, range, detectionsByElement);
      if (selectedChild) fragment.appendChild(selectedChild);
    }
    return fragment;
  }

  function createSelectionFragment(selection) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < selection.rangeCount; i++) {
      fragment.appendChild(cloneRangeWithMathMarkers(selection.getRangeAt(i)));
    }
    return fragment;
  }

  // Convert a copy of the selected DOM, leaving the page itself untouched.
  async function convertSelectionToLatexMarkdown(selection) {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';

    const container = document.createElement('div');
    container.appendChild(createSelectionFragment(selection));

    // Remove duplicate MathJax scripts, MathML annotations, and rendered Unicode
    // fallbacks once a recognized equation has a LaTeX marker.
    container.querySelectorAll('script[type*="math/tex"]').forEach((script) => script.remove());
    container.querySelectorAll('math, .katex-mathml').forEach((mathml) => mathml.remove());
    container.querySelectorAll('annotation').forEach((annotation) => annotation.remove());
    container.querySelectorAll('.katex-html, .katex-fallback, mjx-assistive-mml').forEach((el) => el.remove());
    container.querySelectorAll('semantics').forEach((el) => el.remove());

    // Preserve usable URLs when the selected content contained relative references.
    // Convert relative URLs to absolute before serializing the selected fragment.
    container.querySelectorAll('a').forEach((link) => {
      link.setAttribute('href', link.href);
    });
    container.querySelectorAll('img').forEach((img) => {
      img.setAttribute('src', img.src);
    });

    // TURNDOWN LIBRARY AND GFM PLUGIN ORIGINAL SOURCE:
    // Library: https://unpkg.com/turndown/dist/turndown.js
    // Plugin: https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    })
      .remove('script')
      .remove('style');
    // Use the GFM plugin for table support.
    turndownService.use(turndownPluginGfm.gfm);
    // Keep generated LaTeX markers verbatim through HTML-to-Markdown conversion.
    turndownService.addRule('latexMarker', {
      filter: (node) =>
        node.nodeName === 'SPAN' && node.classList?.contains('latex-marker'),
      replacement: (content, node) => node.textContent || '',
    });

    // Turndown reads a serialization of the cloned, detached selection fragment.
    let markdown = turndownService.turndown(container.innerHTML);
    // Add spacing around display equations, normalize whitespace-only lines,
    // collapse excess blank lines, then trim the final Markdown.
    markdown = markdown.replace(/(\$\$[\s\S]+?\$\$)/g, '\n\n$1\n\n');
    markdown = markdown.replace(/^[ \t]+$/gm, '');
    markdown = markdown.replace(/\n{3,}/g, '\n\n');
    return markdown.trim();
  }

  // Copy text to clipboard with fallback methods
  async function copyToClipboard(text) {
    class KnownFailureError extends Error {}

    // Method 1: Try navigator.clipboard API
    const useClipboardAPI = async (t) => {
      let ret;
      try {
        ret = await navigator.permissions.query({
          name: 'clipboard-write',
          allowWithoutGesture: true,
        });
      } catch (e) {
        if (e instanceof TypeError) {
          // Firefox doesn't support querying clipboard-write; try the write directly.
          await navigator.clipboard.writeText(t);
          return true;
        }
        throw e;
      }

      if (ret && ret.state === 'granted') {
        await navigator.clipboard.writeText(t);
        return true;
      }
      throw new KnownFailureError('no permission to call navigator.clipboard API');
    };

    // Method 2: Fallback to textarea + execCommand
    const useOnPageTextarea = async (t) => {
      const textBox = document.createElement('textarea');
      document.body.appendChild(textBox);
      try {
        textBox.value = t;
        textBox.select();
        const result = document.execCommand('Copy');
        if (result) return Promise.resolve(true);
        return Promise.reject(new KnownFailureError('execCommand returned false'));
      } catch (e) {
        return Promise.reject(e);
      } finally {
        if (document.body.contains(textBox)) document.body.removeChild(textBox);
      }
    };

    // Try clipboard API first
    try {
      await useClipboardAPI(text);
      return { ok: true, method: 'navigator_api' };
    } catch (error) {
      if (error instanceof KnownFailureError) {
        console.debug('[Copy LaTeX]', error);
        // Continue to fallback (textarea method)
      } else {
        const err = error;
        console.error('[Copy LaTeX] Clipboard error (navigator_api):', err);
        return { ok: false, error: `${err.name} ${err.message}`, method: 'navigator_api' };
      }
    }

    // Try textarea fallback
    try {
      await useOnPageTextarea(text);
      return { ok: true, method: 'textarea' };
    } catch (error) {
      const err = error;
      console.error('[Copy LaTeX] Clipboard error (textarea):', err);
      return { ok: false, error: `${err.name} ${err.message}`, method: 'textarea' };
    }
  }

  // Expose only the single entrypoint
  globalThis.convertAndCopySelection = convertAndCopySelection;
})();
