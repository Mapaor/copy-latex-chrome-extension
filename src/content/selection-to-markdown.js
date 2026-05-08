// Convert HTML to Markdown and copy to clipboard (main function)
// Kept as a classic script (not ESM) for Firefox MV3 compatibility.
// Exposes `convertAndCopyHtml` and `convertHtmlToLatexMarkdown` on globalThis.

(() => {
  const MATH_SELECTOR = [
    '.katex',
    '[data-math]',
    'mjx-container',
    '.MathJax_Display',
    '.MJXc-display',
    '.MathJax',
    '.mjx-chtml',
    '.MathJax_CHTML',
    '.MathJax_MathML',
    'img.mwe-math',
    'img.mwe-math-fallback-image-inline',
    'img.mwe-math-fallback-image-display',
  ].join(', ');
  const COPY_SHORTCUT_WINDOW_MS = 1200;

  const copyShortcutState = {
    enabled: true,
    outputFormat: 'latex',
    lastKeyboardCopyTs: 0,
  };

  async function convertAndCopyHtml(html) {
    try {
      const markdown = convertHtmlToLatexMarkdown(html);

      if (!markdown) {
        return { ok: false, error: 'No content' };
      }

      const result = await copyToClipboard(markdown);
      return result;
    } catch (error) {
      console.error('[Copy LaTeX] Error in convertAndCopyHtml:', error);
      return { ok: false, error: String(error) };
    }
  }

  // Convert HTML to Markdown
  function convertHtmlToLatexMarkdown(html) {
    const container = document.createElement('div');
    // innerHTML usage here is safe: the 'html' parameter comes from trusted sources
    // (user selection on the page), and we immediately process it in a controlled way
    // without executing scripts or injecting external code.
    container.innerHTML = html;

    // 1) We detect all math elements
    const mathElements = Array.from(container.querySelectorAll(MATH_SELECTOR));

    // 2) Replace math elements with LaTeX markers ($..$ or $$...$$)
    mathElements.forEach((el) => {
      const latex = extractLatexFromElement(el);
      if (!latex) return;

      const displayMode = getDisplayMode(el);
      const delimiter = displayMode === 'display' ? '$$' : '$';

      // Create a marker that Turndown will preserve, containing the LaTeX code
      const marker = document.createElement('span');
      marker.className = 'latex-marker';
      marker.textContent = `${delimiter}${latex}${delimiter}`;
      marker.setAttribute('data-latex-mode', displayMode);

      el.replaceWith(marker);
    });

    // 2.1) Avoid selecting unicode fallbacks (we already have the LaTeX code)
    // In other works, don't select any element that may contain math/latex content
    container.querySelectorAll('script[type*="math/tex"]').forEach((script) => script.remove());
    container.querySelectorAll('math, .katex-mathml').forEach((mathml) => mathml.remove());
    container.querySelectorAll('annotation').forEach((ann) => ann.remove());
    container.querySelectorAll('.katex-html, .katex-fallback, mjx-assistive-mml').forEach((el) => el.remove());
    container.querySelectorAll('semantics').forEach((el) => el.remove());

    // 3) Convert relative URLs to absolute
    container.querySelectorAll('a').forEach((link) => {
      link.setAttribute('href', link.href);
    });
    container.querySelectorAll('img').forEach((img) => {
      img.setAttribute('src', img.src);
    });

    // 4) Convert to Markdown using Turndown

    // TURNDOWN LIBRARY AND PLUGIN ORIGINAL SOURCE:
    // Library: https://unpkg.com/turndown/dist/turndown.js
    // Plugin: https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js

    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    })
      .remove('script')
      .remove('style');

    // Use GFM plugin for tables support
    turndownService.use(turndownPluginGfm.gfm);

    // Custom rule to preserve LaTeX markers
    turndownService.addRule('latexMarker', {
      filter: (node) => {
        return (
          node.nodeName === 'SPAN' && node.classList && node.classList.contains('latex-marker')
        );
      },
      replacement: (content, node) => {
        // // Check if it's display mode ($$...$$) or inline ($...$)
        // const isDisplay = node.getAttribute('data-latex-mode') === 'display';
        // const latex = node.textContent || '';
        
        // // Block equations with blank lines before and after them
        // return isDisplay ? `\n\n${latex}\n\n` : latex;

        // New (simpler) approach: newlines handled in the markdown output via regex
        return node.textContent || '';
      },
    });

    // innerHTML usage here is safe: we're reading back the DOM structure we created
    // above through controlled manipulation. The container only contains elements we
    // explicitly created or modified, with all scripts removed. This read-only use
    // preserves the exact HTML structure needed for Turndown conversion while maintaining
    // inline vs block equation distinctions (getComputedStyle requires rendered DOM).
    const htmlString = container.innerHTML;
    let markdown = turndownService.turndown(htmlString);

    // To ensure exactly one blank line around block equations:
    // First we add spacing around all block equations ($$ as delimiter)
    markdown = markdown.replace(/(\$\$[\s\S]+?\$\$)/g, '\n\n$1\n\n');
    // Normalize (convert lines with only whitespaces to empty lines)
    markdown = markdown.replace(/^[ \t]+$/gm, '');
    // Then collapse 3 or more newlines to 2 newlines
    markdown = markdown.replace(/\n{3,}/g, '\n\n');
    // Then we trim other leading or trailing whitespaces
    markdown = markdown.trim();

    return markdown;
  }

  // Extract LaTeX replicating the logic from detection.js
  // TODO One day: Unify this detection logic using the same as detection.js
  function extractLatexFromElement(el) {
    // Wikipedia
    if (
      el.tagName === 'IMG' &&
      (
        el.classList.contains('mwe-math') ||
        el.classList.contains('mwe-math-fallback-image-inline') ||
        el.classList.contains('mwe-math-fallback-image-display')
      )
    ) {
      const alt = el.getAttribute('alt');
      if (alt) {
        const match = alt.match(/^\{\\displaystyle\s*([\s\S]*?)\}$/);
        return match && match[1] ? match[1].trim() : alt.trim();
      }
    }

    // KaTeX
    if (el.classList.contains('katex')) {
      const ann = el.querySelector('.katex-mathml annotation[encoding="application/x-tex"]');
      if (ann && ann.textContent) return ann.textContent.trim();

      return (
        el.getAttribute('data-tex') ||
        el.getAttribute('data-latex') ||
        el.getAttribute('aria-label') ||
        null
      );
    }

    // Gemini (data-math attribute)
    if (el.hasAttribute('data-math')) {
      const dataMath = el.getAttribute('data-math');
      if (dataMath && dataMath.trim()) return dataMath.trim();
    }

    // MathJax v3/v4
    if (el.tagName === 'MJX-CONTAINER') {
      // Try global variable set by page script
      const globalLatex = window.__lastMathJaxV3Latex;
      if (globalLatex) return globalLatex;

      // Fallback to script element
      const sibling = el.nextElementSibling;
      if (sibling && sibling.tagName === 'SCRIPT') {
        const scriptEl = sibling;
        if (scriptEl.type && scriptEl.type.includes('math/tex')) {
          return sibling.textContent?.trim() || null;
        }
      }
    }

    // MathJax v2
    const sibling = el.nextElementSibling;
    if (sibling && sibling.tagName === 'SCRIPT') {
      const scriptEl = sibling;
      const type = scriptEl.type;
      if (type === 'math/tex' || type === 'math/tex; mode=display') {
        return sibling.textContent?.trim() || null;
      }
    }

    return null;
  }

  // Determine if math should be inline or display mode
  function getDisplayMode(el) {
    // Wikipedia
    if (el.classList.contains('mwe-math-fallback-image-display')) return 'display';

    // MathJax v2
    if (el.classList.contains('MathJax_Display') || el.classList.contains('MJXc-display')) {
      return 'display';
    }

    // MathJax v3/v4
    if (el.tagName === 'MJX-CONTAINER' && el.hasAttribute('display')) {
      return 'display';
    }

    // KaTeX: check for display class on parent
    if (el.classList.contains('katex')) {
      if (el.parentElement?.classList.contains('katex-display')) return 'display';
      if (el.parentElement) {
        const style = window.getComputedStyle(el.parentElement);
        if (style.display === 'block') return 'display';
      }
    }

    // Gemini: check if div (block equation) or span (inline equation)
    if (el.hasAttribute('data-math')) {
      return el.tagName === 'DIV' ? 'display' : 'inline';
    }

    return 'inline';
  }

  function cloneCurrentSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    const container = document.createElement('div');
    for (let i = 0; i < selection.rangeCount; i++) {
      container.appendChild(selection.getRangeAt(i).cloneContents());
    }

    return container;
  }

  function selectionContainsSupportedMath(container) {
    return !!container.querySelector(MATH_SELECTOR);
  }

  function getElementFromNode(node) {
    if (!node) return null;
    if (node instanceof Element) return node;
    return node.parentElement || null;
  }

  function isEditableNode(node) {
    const el = getElementFromNode(node);
    if (!el) return false;
    if (el.isContentEditable) return true;
    return !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
  }

  function shouldHandleCopyShortcut(event) {
    if (!copyShortcutState.enabled) return false;
    if (!event.clipboardData) return false;
    if (event.defaultPrevented) return false;
    if (Date.now() - copyShortcutState.lastKeyboardCopyTs > COPY_SHORTCUT_WINDOW_MS) return false;
    if (isEditableNode(event.target) || isEditableNode(document.activeElement)) return false;

    const selection = window.getSelection();
    if (!selection) return false;
    if (isEditableNode(selection.anchorNode) || isEditableNode(selection.focusNode)) return false;

    return true;
  }

  function convertMarkdownToConfiguredOutput(markdown) {
    if (copyShortcutState.outputFormat !== 'typst') return markdown;
    if (!window.markdown2typst) throw new Error('markdown2typst library not loaded');
    return window.markdown2typst(markdown);
  }

  function handleCopyShortcut(event) {
    if (!shouldHandleCopyShortcut(event)) return;

    const container = cloneCurrentSelection();
    if (!container || !selectionContainsSupportedMath(container)) return;

    try {
      const markdown = convertHtmlToLatexMarkdown(container.innerHTML);
      if (!markdown) return;

      const outputText = convertMarkdownToConfiguredOutput(markdown);
      if (!outputText) return;

      event.clipboardData.setData('text/plain', outputText);
      event.preventDefault();
      event.stopImmediatePropagation();
    } catch (error) {
      console.error('[Copy LaTeX] Error handling copy shortcut:', error);
    }
  }

  function handleCopyShortcutKeydown(event) {
    const key = String(event.key || '').toLowerCase();
    const isCopyKey = key === 'c' || event.code === 'KeyC';
    if ((event.ctrlKey || event.metaKey) && !event.altKey && isCopyKey) {
      copyShortcutState.lastKeyboardCopyTs = Date.now();
    }
  }

  async function loadCopyShortcutConfig() {
    if (typeof browser === 'undefined') return;

    try {
      const result = await browser.storage.local.get(['enableCopyShortcut', 'outputFormat']);
      copyShortcutState.enabled =
        result.enableCopyShortcut === undefined ? true : !!result.enableCopyShortcut;
      copyShortcutState.outputFormat = result.outputFormat || 'latex';
    } catch (error) {
      console.error('[Copy LaTeX] Error loading copy shortcut config:', error);
    }
  }

  function installCopyShortcut() {
    document.addEventListener('keydown', handleCopyShortcutKeydown, { capture: true });
    document.addEventListener('copy', handleCopyShortcut, { capture: true });

    if (typeof browser === 'undefined') return;

    loadCopyShortcutConfig();
    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      if (changes.enableCopyShortcut) {
        copyShortcutState.enabled =
          changes.enableCopyShortcut.newValue === undefined
            ? true
            : !!changes.enableCopyShortcut.newValue;
      }
      if (changes.outputFormat) {
        copyShortcutState.outputFormat = changes.outputFormat.newValue || 'latex';
      }
    });
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
          // Firefox: clipboard-write is not queryable, just try to write.
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

  // Expose conversion entrypoints for the background message handler and tests.
  globalThis.convertAndCopyHtml = convertAndCopyHtml;
  globalThis.convertHtmlToLatexMarkdown = convertHtmlToLatexMarkdown;
  installCopyShortcut();
})();
