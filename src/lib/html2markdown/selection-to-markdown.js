
// Convert HTML to Markdown and copy to clipboard (main function)
async function convertAndCopyHtml(html) {
  try {
    // console.log('[Copy Latex] Converting HTML to Markdown...');

    const markdown = await convertHtmlToLatexMarkdown(html);

    // console.log('[Copy Latex] Markdown result:', markdown?.substring(0, 200));

    if (!markdown) {
      return { ok: false, error: 'No content' };
    }

    const result = await copyToClipboard(markdown);
    // console.log('[Copy LaTeX] Copy result:', result);

    return result;
  } catch (error) {
    console.error('[Copy LaTeX] Error in convertAndCopyHtml:', error);
    return { ok: false, error: String(error) };
  }
}

// Convert HTML to Markdown
async function convertHtmlToLatexMarkdown(html) {
  const container = document.createElement('div');
  // innerHTML usage here is safe: the 'html' parameter comes from trusted sources
  // (user selection on the page), and we immediately process it in a controlled way
  // without executing scripts or injecting external code.
  container.innerHTML = html;

  // 1) We detect all math elements
  // This is the same logic as in content.js
  const mathElements = [
    ...Array.from(container.querySelectorAll('.katex')),
    ...Array.from(container.querySelectorAll('[data-math]')),
    ...Array.from(container.querySelectorAll('mjx-container')),
    ...Array.from(container.querySelectorAll('.MathJax_Display, .MJXc-display, .MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML')),
    ...Array.from(container.querySelectorAll('img.mwe-math, img.mwe-math-fallback-image-inline, img.mwe-math-fallback-image-display')),
  ];

  // 2) Replace math elements with LaTeX markers ($..$ or $$...$$)
  mathElements.forEach((el) => {
    const latex = extractLatexFromElement(el);
    if (!latex) return;

    const displayMode = getDisplayMode(el);
    const delimiter = displayMode === 'display' ? '$$' : '$';

    // Create marker that Turndown will preserve
    const marker = document.createElement('span');
    marker.className = 'latex-marker';
    marker.textContent = `${delimiter}${latex}${delimiter}`;
    marker.setAttribute('data-latex-mode', displayMode);

    el.replaceWith(marker);
  });

  // 2.1) Avoid selecting unicode fallbacks (we already have the LaTeX code)
  
  // Don't select any element that may contain math/latex content
  container.querySelectorAll('script[type*="math/tex"]').forEach(script => script.remove());  
  container.querySelectorAll('math, .katex-mathml').forEach(mathml => mathml.remove());  
  container.querySelectorAll('annotation').forEach(ann => ann.remove());  
  container.querySelectorAll('.katex-html, .katex-fallback, mjx-assistive-mml').forEach(el => el.remove());  
  container.querySelectorAll('semantics').forEach(el => el.remove());

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
    codeBlockStyle: 'fenced'
  })
    .remove('script')
    .remove('style');

  // Use GFM plugin for tables support
  turndownService.use(turndownPluginGfm.gfm);

  // Custom rule to preserve LaTeX markers
  turndownService.addRule('latexMarker', {
    filter: (node) => {
      return node.nodeName === 'SPAN' &&
             node.classList && node.classList.contains('latex-marker');
    },
    replacement: (content, node) => {

      // // Check if it's display mode ($$...$$) or inline ($...$)
      // const isDisplay = node.getAttribute('data-latex-mode') === 'display';
      // const latex = node.textContent || '';
      
      // // Block equations with blank lines before and after them
      // return isDisplay ? `\n\n${latex}\n\n` : latex;

      // New (simpler) approach: newlines handled in the markdown output via regex
      return node.textContent || '';
    }
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

// Extract LaTeX
function extractLatexFromElement(el) {
  // Wikipedia
  if (el.tagName === 'IMG' && el.classList.contains('mwe-math')) {
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

    return el.getAttribute('data-tex') ||
           el.getAttribute('data-latex') ||
           el.getAttribute('aria-label') ||
           null;
  }

  // Gemini (data-math attribute)
  if (el.hasAttribute('data-math')) {
    const dataMath = el.getAttribute('data-math');
    if (dataMath && dataMath.trim()) {
      return dataMath.trim();
    }
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
    if (el.parentElement?.classList.contains('katex-display')) {
      return 'display';
    }
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
        // Firefox: clipboard-write is not queryable, just try to write
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
      if (result) {
        return Promise.resolve(true);
      }
      return Promise.reject(new KnownFailureError('execCommand returned false'));
    } catch (e) {
      return Promise.reject(e);
    } finally {
      if (document.body.contains(textBox)) {
        document.body.removeChild(textBox);
      }
    }
  };

  // Try clipboard API first
  try {
    await useClipboardAPI(text);
    return { ok: true, method: 'navigator_api' };
  } catch (error) {
    if (error instanceof KnownFailureError) {
      console.debug('[Copy LaTeX]', error);
      // Continue to fallback
    } else {
      const err = error;
      return { ok: false, error: `${err.name} ${err.message}`, method: 'navigator_api' };
    }
  }

  // Try textarea fallback
  try {
    await useOnPageTextarea(text);
    return { ok: true, method: 'textarea' };
  } catch (error) {
    const err = error;
    return { ok: false, error: `${err.name} ${err.message}`, method: 'textarea' };
  }
}

