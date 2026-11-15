// Converts the live selection to Markdown and copies it to the clipboard

(() => {

  // Problem: Turndown works great for converting headings, bold, italics, etc. That is common HTML tags to markdown
  // however for equations it does not know how these are rendered nor where their latex code is stored
  // Solution: We replace the HTML before the conversion, generating spans with a class 'latex-marker' and
  // single or double dollars as delimiters (based on our display mode information).
  // Then we'll use a custom Turndown rule to identify them and properly convert them.
  function createLatexMarker(detection) {
    const delimiter = detection.displayMode === 'display' ? '$$' : '$';
    const marker = document.createElement('span');
    marker.className = 'latex-marker';
    marker.textContent = `${delimiter}${detection.tex}${delimiter}`;
    marker.setAttribute('data-latex-mode', detection.displayMode);
    return marker;  // Detection (JS object) -> Marker (HTML span containing the LaTeX)
  }

  // Clones selected content, math equations get fully clone even if they're partially selected
  function cloneSelectedNode(node, range, detectionsByElement) {
    if (!range.intersectsNode(node)) return null;

    const detection = detectionsByElement.get(node);
    if (detection) return createLatexMarker(detection);

    if (node.nodeType === Node.TEXT_NODE) {
      // Partially selected text clones only the exact selected range
      const start = range.startContainer === node ? range.startOffset : 0;
      const end = range.endContainer === node ? range.endOffset : node.length;
      if (start >= end) return null;
      return document.createTextNode(node.textContent.slice(start, end));
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const clone = node.cloneNode(false);
      for (const child of node.childNodes) {
        const selectedChild = cloneSelectedNode(child, range, detectionsByElement); // Clone child nodes recursively
        if (selectedChild) clone.appendChild(selectedChild);
      }
      return clone;
    }

    return node.cloneNode();
  }

  // First we detect math roots in the selected range, then we add latex markers for those
  // finally we clone each node of the selection using the above cloneSelectedNode() function
  function cloneRangeWithMathMarkers(range) {
    const fragment = document.createDocumentFragment();
    const detections = window.CopyLatex.detect.detectMathElementsInRange(range);
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

  // Given a selection we get it's corresponding document fragment and clone it
  function createSelectionFragment(selection) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < selection.rangeCount; i++) {
      fragment.appendChild(cloneRangeWithMathMarkers(selection.getRangeAt(i)));
    }
    return fragment;
  }

  // Given a cloned DOM fragment (selection), we convert it to markdown using Turndown and custom rules
  // for things turndown does not know how to handle
  function convertSelectionToLatexMarkdown(selection) {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return '';

    const container = document.createElement('div'); // All conversion will happen inside this div container
    container.appendChild(createSelectionFragment(selection)); // We put all the cloned selection inside the container

    // Remove duplicates (like MathJax scripts and MathML annotations)
    // Note: We have already "deleted/replaced" all these elements with spans, so these should in principle not be there
    // but in some cases they are (for example for their unicode-fallback), so we remove them to avoid Turndown generating this unicode fallback
    container.querySelectorAll('script[type*="math/tex"]').forEach((script) => script.remove());
    container.querySelectorAll('math, .katex-mathml').forEach((mathml) => mathml.remove());
    container.querySelectorAll('annotation').forEach((annotation) => annotation.remove());
    container.querySelectorAll('semantics').forEach((el) => el.remove());
    container.querySelectorAll('.katex-html, .katex-fallback, mjx-assistive-mml').forEach((el) => el.remove());

    container.querySelectorAll('a').forEach((link) => {
      link.setAttribute('href', link.href);
    });
    container.querySelectorAll('img').forEach((img) => {
      img.setAttribute('src', img.src);
    });

    // ChatGPT Fix for Tables
    // ChatGPT wraps each cell value in a <p> element, the problem is that Turndown treats paragraphs as block elements
    // this means that Turndown will add undesired blank lines between table cells.
    // The solution is to remove this <p> wrappers
    // <td><p><span>Bla</span></p></td> -> <td><span>Bla</span></td>
    container.querySelectorAll('table th > p, table td > p').forEach((paragraph) => {
      paragraph.replaceWith(...paragraph.childNodes);
    });

    // TODO: Add a settings option to choose the bulleted list marker for Turndown (* or -)

    // TURNDOWN LIBRARY + GFM PLUGIN
    // Used locally (inside lib/), their original sources can be found at npm via unpkg or jsdelivr
    // Turndown library: https://unpkg.com/turndown/dist/turndown.js
    // GitHub-Flavored Markdown plugin: https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    })
      .remove('script')
      .remove('style');

    turndownService.use(turndownPluginGfm.gfm); // GFM plugin is used not for math but for tables

    // CUSTOM turndown rule (identify the LaTeX markers we have placed as spans in the HTML)
    turndownService.addRule('latexMarker', {
      filter: (node) =>
        node.nodeName === 'SPAN' && node.classList?.contains('latex-marker'),
      replacement: (content, node) => node.textContent || '',
    });

    // The container inner HTML contains the whole cloned selection
    // Now we just use turndown for the conversion
    let markdown = turndownService.turndown(container.innerHTML);

    // POST-PROCESSING
    // Now that we have markdown, we need to do some post-processing
    // TODO: Add custom delimiters settings in the popup and handle them here as post-processing. Maybe also create a specific postprocessMarkdown() function
    markdown = markdown.replace(/(\$\$[\s\S]+?\$\$)/g, '\n\n$1\n\n'); // Normalized spacing (\n\n) around display equations
    markdown = markdown.replace(/^[ \t]+$/gm, '');  // Trim the final markdown
    markdown = markdown.replace(/\n{3,}/g, '\n\n'); // collapse extra blank lines
    return markdown.trim();
  }

  // Expose only the conversion entry point; output.js owns clipboard operations.
  const ns = (window.CopyLatex = window.CopyLatex || {});
  ns.selection = ns.selection || {};
  ns.selection.toMarkdown = convertSelectionToLatexMarkdown;
})();
