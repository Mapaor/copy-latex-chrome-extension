// Simple and secure script. Read and understand it yourself. 
// This injection is necessary for using the MathJax API 
// There is no other way to obtain the LaTeX code for MathJax v3 and v4.

(function() {
  var mathjax = window.MathJax;
  var version = mathjax && mathjax.version ? mathjax.version : null;
  if (!mathjax || !(version && (version.startsWith('3') || version.startsWith('4')))) {
    return;
  }

  function getLatexForContainer(mjxContainer) {
    if (typeof MathJax !== 'undefined' && MathJax.startup && MathJax.startup.document && MathJax.startup.document.math) {
      let current = MathJax.startup.document.math.list;
      const targetHTML = mjxContainer.innerHTML;
      while (current && current.data) {
        const mathItem = current.data;
        if (mathItem.typesetRoot && mathItem.typesetRoot.innerHTML === targetHTML) {
          if (mathItem.math && typeof mathItem.math === 'string') {
            return mathItem.math.trim();
          }
        }
        current = current.next;
        if (current === MathJax.startup.document.math.list) break;
      }
    }
    return null;
  }

  document.addEventListener('mouseover', function(e) {
    const mjx = e.target.closest('mjx-container');
    if (mjx) {
      const latex = getLatexForContainer(mjx);
      if (latex) {
        window.postMessage({ type: 'CopyLaTeX_MathJaxV3', latex, mjxId: mjx.getAttribute('ctxtmenu_counter') }, '*');
      } 
    }
  }, true);

  document.addEventListener('click', function(e) {
    const mjx = e.target.closest('mjx-container');
    if (mjx) {
      const latex = getLatexForContainer(mjx);
      if (latex) {
        window.postMessage({ type: 'CopyLaTeX_MathJaxV3', latex, mjxId: mjx.getAttribute('ctxtmenu_counter') }, '*');
      }
    }
  }, true);
})();