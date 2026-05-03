// Inject page script for MathJax v3 extraction
async function injectMathJaxPageScript() {
  try {
    const scriptUrl = browser.runtime.getURL('mathjax-api.js');
    
    const script = document.createElement('script');
    script.src = scriptUrl;
    document.documentElement.appendChild(script);
  } catch (error) {
    console.error('[Copy LaTeX] Failed to inject MathJax script:', error);
  }
}

injectMathJaxPageScript();

// Listen for LaTeX messages from the page script
let lastMathJaxV3Latex = null;
window.addEventListener('message', function(event) {
  if (event.source !== window) return;
  if (event.data && event.data.type === 'CopyLaTeX_MathJaxV3') {
    lastMathJaxV3Latex = event.data.latex;
  }
});

let overlay;
let currentTarget = null;

const copy_svg = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4 a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const check_svg = '<svg class="check-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -1 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 5 9 17l-5-5"/></svg>';

function createSvgFromString(svgString) {
  // Use DOMParser to safely parse SVG strings without innerHTML security warnings
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  return doc.documentElement;
}

function isWikipedia() {
  const hostname = window.location.hostname;
  return hostname.endsWith('.wikipedia.org') || hostname === 'www.wikiwand.com' || hostname === "wikimedia.org" || hostname.endsWith(".wikiversity.org") || hostname.endsWith(".wikibooks.org");
}

function findWikipediaTex(el) {
  // Only work on Wikipedia/Wikiwand sites
  if (!isWikipedia()) return null;
  
  // Check if it's a Wikipedia math image
  if (el.tagName === 'IMG' && 
      (el.classList.contains('mwe-math') || 
      el.classList.contains('mwe-math-fallback-image-inline') ||
      el.classList.contains('mwe-math-fallback-image-display'))) {
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) {
      // Remove leading '{\displaystyle' and trailing '}'
      const match = alt.trim().match(/^\{\\displaystyle\s*([\s\S]*?)\}$/);
      if (match) {
        return match[1].trim();
      }
      return alt.trim();
    }
  }
  
  return null;
}

function findMathJaxV3Tex(el) {
  // Check for MathJax v3 containers
  const mjxContainer = el.closest('mjx-container');
  if (!mjxContainer) {
    return null;
  }

  // Use the last received LaTeX from the page script
  if (lastMathJaxV3Latex) {
    return lastMathJaxV3Latex;
  }

  // Fallback: try to find any associated script elements nearby
  let current = mjxContainer;
  for (let i = 0; i < 5; i++) { // Check a few siblings
    if (current.nextElementSibling) {
      current = current.nextElementSibling;
      if (current.tagName === 'SCRIPT' && 
          (current.type === 'math/tex' || current.type === 'math/tex; mode=display')) {
        return current.textContent.trim();
      }
    } else {
      break;
    }
  }

  return null;
}

function findAnnotationTex(el) {
  const katexEl = el.closest('.katex');
  if (!katexEl) return null;

  const ann = katexEl.querySelector(
    'annotation[encoding="application/x-tex"], annotation[encoding="application/x-latex"], annotation[encoding="application/tex"]'
  );
  if (ann && ann.textContent.trim()) {
    return ann.textContent.trim();
  }

  const dataLatex =
    katexEl.getAttribute('data-tex') ||
    katexEl.getAttribute('data-latex') ||
    katexEl.getAttribute('aria-label');
  if (dataLatex && dataLatex.trim()) return dataLatex.trim();

  return null;
}

function findKaTeXElementFromEventTarget(target) {
  if (!(target instanceof Element)) return null;

  // In almost all katex sites event target is inside a .katex span tag
  // Which normally contains two children: katex-html (where the event target is) and katex-mathml (where the TeX expression is stored).
  const closest = target.closest?.('.katex');
  if (closest) return closest;

  const directDescendant = target.querySelector?.('.katex');
  if (directDescendant) return directDescendant;

  // Try a few ancestors and look for a descendant .katex
  let node = target;
  for (let i = 0; i < 4; i++) {
    node = node.parentElement;
    if (!node) break;
    const descendant = node.querySelector?.('.katex');
    if (descendant) return descendant;
  }

  return null;
}

function findMathJaxTex(el) {
  // Check for MathJax display equations
  const mathJaxDisplay = el.closest('.MathJax_Display, .MJXc-display');
  if (mathJaxDisplay) {
    // Look for the script element after the display div
    let sibling = mathJaxDisplay.nextElementSibling;
    while (sibling) {
      if (sibling.tagName === 'SCRIPT' && 
          sibling.type === 'math/tex; mode=display') {
        return sibling.textContent.trim();
      }
      sibling = sibling.nextElementSibling;
    }
  }

  // Check for MathJax inline equations (various formats)
  const mathJaxInline = el.closest('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML');
  if (mathJaxInline) {
    // For traditional MathJax elements with IDs
    if (mathJaxInline.id && mathJaxInline.id.includes('MathJax-Element-')) {
      // Look for the script element after the MathJax span
      let sibling = mathJaxInline.nextElementSibling;
      while (sibling) {
        if (sibling.tagName === 'SCRIPT' && 
            sibling.type === 'math/tex') {
          return sibling.textContent.trim();
        }
        sibling = sibling.nextElementSibling;
      }
    }
    
    // For newer MathJax formats (mjx-chtml, MathJax_CHTML)
    // Look for script elements with math/tex type
    let sibling = mathJaxInline.nextElementSibling;
    while (sibling) {
      if (sibling.tagName === 'SCRIPT' && 
          (sibling.type === 'math/tex' || sibling.type === 'math/tex; mode=display')) {
        return sibling.textContent.trim();
      }
      sibling = sibling.nextElementSibling;
    }
  }

  return null;
}

function createOverlay() {
  overlay = document.createElement('div');
  overlay.className = 'hoverlatex-overlay';
  console.log('[Copy LaTeX] Overlay created. Initial class:', overlay.className);

  // Set theme class based on user preference
  setOverlayThemeClass().then(() => {
    console.log('[Copy LaTeX] Overlay after theme set. Classes:', overlay.className);
    const bg = window.getComputedStyle(overlay).backgroundColor;
    console.log('[Copy LaTeX] Overlay computed background after theme set:', bg);
  });

  // MutationObserver to log class/style changes (I'll remove it later)
  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'attributes' && (mutation.attributeName === 'class' || mutation.attributeName === 'style')) {
        console.log('[Copy LaTeX][MutationObserver] Overlay attribute changed:', mutation.attributeName, {
          class: overlay.className,
          style: overlay.getAttribute('style'),
          computedBg: window.getComputedStyle(overlay).backgroundColor
        });
      }
    }
  });
  observer.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] });

  // Random interval observer: logs computed background color at random intervals (10-100ms)
  let lastBg = '';
  function randomBgLogger() {
    if (overlay) {
      const bg = window.getComputedStyle(overlay).backgroundColor;
      if (bg !== lastBg) {
        console.log('[Copy LaTeX][RandomBgObserver] Overlay computed background:', bg);
        lastBg = bg;
      }
    }
    // Schedule next check at a random interval between 10ms and 100ms
    const nextDelay = Math.floor(Math.random() * 91) + 10;
    setTimeout(randomBgLogger, nextDelay);
  }
  randomBgLogger();

  // HTML overlay content with inline SVG icon and 'Click to copy' text
  overlay.appendChild(createSvgFromString(copy_svg));
  const span = document.createElement('span');
  span.textContent = 'Click to copy';
  overlay.appendChild(span);

  document.body.appendChild(overlay);
}

async function setOverlayThemeClass() {
  if (!overlay) return;
  // Remove any previous theme class
  overlay.classList.remove('theme-light', 'theme-dark');
  let theme = 'system';
  try {
    const result = await browser.storage.local.get('themeMode');
    console.log('[Copy LaTeX] setOverlayThemeClass: browser.storage.local themeMode =', result.themeMode);
    theme = result.themeMode || 'system';
  } catch (e) {
    // This can happen during navigation/refresh or extension reload: the content-script
    // context is torn down while an async storage call is in-flight.
    const message = (e && typeof e === 'object' && 'message' in e) ? String(e.message) : String(e);
    if (!message.includes('Extension context invalidated')) {
      console.warn('[Copy LaTeX] setOverlayThemeClass: error reading browser.storage.local', e);
    }
  }
  console.log('[Copy LaTeX] setOverlayThemeClass: using theme =', theme);
  if (theme === 'light') {
    overlay.classList.add('theme-light');
  } else if (theme === 'dark') {
    overlay.classList.add('theme-dark');
  }
  // If system, do not add any theme class so CSS media query applies
}

function showOverlay(target, tex) {
  if (!overlay) {
    console.log('[Copy LaTeX] showOverlay: overlay does not exist, creating...');
    createOverlay();
  } else {
    console.log('[Copy LaTeX] showOverlay: overlay exists, reusing. Classes:', overlay.className);
  }
  // Only make overlay visible after theme is set
  setOverlayThemeClass().then(() => {
    // Remove .visible if present before theme is set
    overlay.classList.remove('visible');
    console.log('[Copy LaTeX] showOverlay: after theme set. Classes:', overlay.className);
    const bg = window.getComputedStyle(overlay).backgroundColor;
    console.log('[Copy LaTeX] showOverlay: computed background:', bg);
    overlay.dataset.tex = tex;
    const rect = target.getBoundingClientRect();
    const overlayWidth = overlay.offsetWidth;
    const top = rect.top + window.scrollY - overlay.offsetHeight - 8;
    const left = rect.left + window.scrollX + (rect.width / 2) - (overlayWidth / 2);
    overlay.style.top = `${top}px`;
    overlay.style.left = `${left}px`;
    overlay.classList.add('visible');
  });
}

function hideOverlay() {
  if (overlay) {
    overlay.classList.remove('visible');
  }
}

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
    if (!overlay) createOverlay();

    // Get user's format preference
    const result = await browser.storage.local.get('outputFormat');
    const format = result.outputFormat || 'latex';
    
    // Convert to Typst if selected
    const outputText = format === 'typst' ? latexToTypst(tex) : tex;
    
    // Copy to clipboard
    await navigator.clipboard.writeText(outputText);
    
    // Show success feedback
    overlay.classList.add('copied');
    const span = overlay.querySelector('span');
    span.textContent = 'Copied! ';
    span.appendChild(createSvgFromString(check_svg));
    setTimeout(() => {
      overlay.classList.remove('copied');
      span.textContent = 'Click to copy';
    }, 1500);
  } catch (err) {
    console.error("[Copy LaTeX] Clipboard error:", err);
  }
}

document.addEventListener('mouseover', (e) => {
  // Check for Wikipedia math images first (only on Wikipedia/Wikiwand sites)
  if (isWikipedia()) {
    const wikipediaTex = findWikipediaTex(e.target);
    if (wikipediaTex) {
      currentTarget = e.target;
      e.target.classList.add('hoverlatex-hover');
      showOverlay(e.target, wikipediaTex);
      return;
    }
  }

  // Check for KaTeX elements
  const katex = findKaTeXElementFromEventTarget(e.target);
  if (katex) {
    const tex = findAnnotationTex(katex);
    if (tex) {
      currentTarget = katex;
      katex.classList.add('hoverlatex-hover');
      showOverlay(katex, tex);
      return;
    }
  }

  // Check for math elements with data-math
  const dataMathEl = e.target.closest('[data-math]');
  if (dataMathEl) {
    const tex = dataMathEl.getAttribute('data-math');
    if (tex && tex.trim()) {
      currentTarget = dataMathEl;
      dataMathEl.classList.add('hoverlatex-hover');
      showOverlay(dataMathEl, tex.trim());
      return;
    }
  }

  // Check for MathJax v3 elements
  const mjxContainer = e.target.closest('mjx-container');
  if (mjxContainer) {
    const tex = findMathJaxV3Tex(mjxContainer);
    if (tex) {
      currentTarget = mjxContainer;
      mjxContainer.classList.add('hoverlatex-hover');
      showOverlay(mjxContainer, tex);
      return;
    }
  }

  // Check for MathJax elements
  const mathJaxDisplay = e.target.closest('.MathJax_Display, .MJXc-display');
  const mathJaxInline = e.target.closest('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML');
  
  if (mathJaxDisplay || mathJaxInline) {
    const mathElement = mathJaxDisplay || mathJaxInline;
    const tex = findMathJaxTex(mathElement);
    if (tex) {
      currentTarget = mathElement;
      mathElement.classList.add('hoverlatex-hover');
      showOverlay(mathElement, tex);
    }
  }
});

document.addEventListener('mouseout', (e) => {
  if (currentTarget &&
      // Don't hide if we're still moving within the current target
      (e.relatedTarget instanceof Node && currentTarget.contains(e.relatedTarget)) === false &&
      // Don't hide if moving into our overlay
      !e.relatedTarget?.closest('.hoverlatex-overlay') &&
      !findKaTeXElementFromEventTarget(e.relatedTarget) &&
      !e.relatedTarget?.closest('[data-math]') &&
      !e.relatedTarget?.closest('mjx-container') &&
      !e.relatedTarget?.closest('.MathJax_Display, .MJXc-display') && 
      !e.relatedTarget?.closest('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML') &&
      !(isWikipedia() && 
        e.relatedTarget?.tagName === 'IMG' && 
        (e.relatedTarget?.classList.contains('mwe-math') || 
        e.relatedTarget?.classList.contains('mwe-math-fallback-image-inline') ||
        e.relatedTarget?.classList.contains('mwe-math-fallback-image-display')))) {
    currentTarget.classList.remove('hoverlatex-hover');
    hideOverlay();
    currentTarget = null;
  }
});

let lastCopyGestureTs = 0;
let lastCopiedTex = null;

function shouldHandleGesture(e) {
  // Only handle left-click style gestures for mouse.
  // For touch/pen, button is often 0 or undefined.
  if (typeof e.button === 'number' && e.button !== 0) return false;
  return true;
}

function handleCopyGesture(e, source) {
  if (!shouldHandleGesture(e)) return;

  // Allow clicking the extension's own overlay
  if (overlay && overlay.classList.contains('visible') && e.target?.closest('.hoverlatex-overlay')) {
    const tex = overlay.dataset.tex;
    if (tex && tex.trim()) {
      copyLatex(tex.trim());
    }
    return;
  }

  // Check for Wikipedia math images first (only on Wikipedia/Wikiwand sites)
  if (isWikipedia()) {
    const wikipediaTex = findWikipediaTex(e.target);
    if (wikipediaTex) {
      // console.log('[Copy LaTeX] Clicked Wikipedia math image:', e.target, 'TeX:', wikipediaTex);
      copyLatex(wikipediaTex);
      return;
    }
  }

  // Check for KaTeX elements
  const katex = findKaTeXElementFromEventTarget(e.target);
  if (katex) {
    const tex = findAnnotationTex(katex);
    if (tex) {
      const now = Date.now();
      // Dedupe: pointerdown often followed by click
      if (lastCopiedTex === tex && (now - lastCopyGestureTs) < 700) return;
      lastCopyGestureTs = now;
      lastCopiedTex = tex;
      copyLatex(tex);
      return;
    }
  }

  // Check for elements (div or span) with custom attribute `data-math` (for Gemini)
  const dataMathEl = e.target.closest?.('[data-math]');
  if (dataMathEl) {
    const tex = dataMathEl.getAttribute('data-math');
    if (tex) {
      // console.log('[Copy LaTeX] Clicked data-math element:', dataMathEl, 'TeX:', tex);
      copyLatex(tex);
      return;
    }
  }

  // Check for MathJax v3 elements
  const mjxContainer = e.target.closest?.('mjx-container');
  if (mjxContainer) {
    const tex = findMathJaxV3Tex(mjxContainer);
    if (tex) {
      // console.log('[Copy LaTeX] Clicked MathJax v3 element:', mjxContainer, 'TeX:', tex);
      copyLatex(tex);
      return;
    }
  }

  // Check for MathJax elements
  const mathJaxDisplay = e.target.closest?.('.MathJax_Display, .MJXc-display');
  const mathJaxInline = e.target.closest?.('.MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML');
  if (mathJaxDisplay || mathJaxInline) {
    const mathElement = mathJaxDisplay || mathJaxInline;
    const tex = findMathJaxTex(mathElement);
    if (tex) {
      // console.log('[Copy LaTeX] Clicked MathJax element:', mathElement, 'TeX:', tex);
      copyLatex(tex);
    }
  }
}

document.addEventListener('pointerdown', (e) => handleCopyGesture(e, 'pointerdown(capture)'), { capture: true });
document.addEventListener('click', (e) => handleCopyGesture(e, 'click(capture)'), { capture: true });


// NEW FEATURE!!!: Selection to Markdown with LaTeX
// NOW ALSO WITH TYPST SUPPORT ("Copy as Typst")

// Listen for messages from background script
browser.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'convertHtmlToMarkdown') return undefined;

  return (async () => {
    // console.log('[Copy LaTeX] Converting HTML to Markdown, length:', message.html?.length);
    const result = await convertAndCopyHtml(message.html);
    if (!result.ok) return result;

    // Check user's format preference
    const storageResult = await browser.storage.local.get('outputFormat');
    const format = storageResult.outputFormat || 'latex';

    // If Typst mode, convert markdown to typst
    if (format === 'typst') {
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
    }

    return result;
  })();
});