// Inject page script for MathJax v3 extraction
async function injectMathJaxPageScript() {
  try {
    const scriptUrl = chrome.runtime.getURL('mathjax-api.js');
    
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

  const ann = katexEl.querySelector('.katex-mathml annotation[encoding="application/x-tex"]');
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

  // HTML overlay content with inline SVG icon and 'Click to copy' text
  overlay.appendChild(createSvgFromString(copy_svg));
  const span = document.createElement('span');
  span.textContent = 'Click to copy';
  overlay.appendChild(span);

  document.body.appendChild(overlay);
}

function showOverlay(target, tex) {
  if (!overlay) createOverlay();

  overlay.dataset.tex = tex;
  const rect = target.getBoundingClientRect();
  const overlayWidth = overlay.offsetWidth;
  const top = rect.top + window.scrollY - overlay.offsetHeight - 8;
  const left = rect.left + window.scrollX + (rect.width / 2) - (overlayWidth / 2);

  overlay.style.top = `${top}px`;
  overlay.style.left = `${left}px`;

  overlay.classList.add('visible');
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
    // Get user's format preference
    const result = await chrome.storage.local.get('outputFormat');
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
  const katex = e.target.closest('.katex');
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
      !e.relatedTarget?.closest('.katex') && 
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

document.addEventListener('click', (e) => {
  // Check for Wikipedia math images first (only on Wikipedia/Wikiwand sites)
  if (isWikipedia()) {
    const wikipediaTex = findWikipediaTex(e.target);
    if (wikipediaTex) {
      copyLatex(wikipediaTex);
      return;
    }
  }

  // Check for KaTeX elements
  const katex = e.target.closest('.katex');
  if (katex) {
    const tex = findAnnotationTex(katex);
    if (tex) {
      copyLatex(tex);
      return;
    }
  }

  // Check for elements (div or span) with custom attribute `data-math` (for Gemini)
  const dataMathEl = e.target.closest('[data-math]');
  if (dataMathEl) {
    const tex = dataMathEl.getAttribute('data-math');
    if (tex) {
      copyLatex(tex);
      return;
    }
  }

  // Check for MathJax v3 elements
  const mjxContainer = e.target.closest('mjx-container');
  if (mjxContainer) {
    const tex = findMathJaxV3Tex(mjxContainer);
    if (tex) {
      copyLatex(tex);
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
      copyLatex(tex);
    }
  }
});


// NEW FEATURE!!!: Selection to Markdown with LaTeX
// NOW ALSO WITH TYPST SUPPORT ("Copy as Typst")

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'convertHtmlToMarkdown') {
    // console.log('[Copy LaTeX] Converting HTML to Markdown, length:', message.html?.length);
    convertAndCopyHtml(message.html).then(async result => {
      if (result.ok) {
        // Check user's format preference
        const storageResult = await chrome.storage.local.get('outputFormat');
        const format = storageResult.outputFormat || 'latex';
        
        // If Typst mode, convert markdown to typst
        if (format === 'typst') {
          try {
            if (!window.markdown2typst) {
              console.error('[Copy LaTeX] markdown2typst library not loaded');
              sendResponse({ ok: false, error: 'markdown2typst library not loaded' });
              return;
            }
            
            // Get the markdown from clipboard (we just copied it)
            const markdown = await navigator.clipboard.readText();
            const typst = window.markdown2typst(markdown);
            
            // Copy typst back to clipboard
            await navigator.clipboard.writeText(typst);
            console.log('[Copy LaTeX] Converted to Typst and copied');
            sendResponse({ ok: true, format: 'typst' });
          } catch (error) {
            console.error('[Copy LaTeX] Typst conversion error:', error);
            sendResponse({ ok: false, error: String(error) });
          }
        } else {
          sendResponse(result);
        }
      } else {
        sendResponse(result);
      }
    });
    return true;  // Keep channel open for async response
  }
});