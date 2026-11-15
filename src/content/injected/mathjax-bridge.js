// Problem: In MathJax v3/v4 the LaTeX source code is not present in the DOM
// Solution: We can use the MathJax API (which exposes the LaTeX source code)
// New problem: A content script runs in an isolated JS world and therefore it does not have
// access to the page MathJax object.
// Solution to that: We set this script as a `web_accessible_resource` so that the content script (main.js)
// can inject it as a normal page script (like adding <script></script> inside the page HTML).
// New problem: If we had to inject a script to every page it would not be quite ideal design and it could conflict with MathJax v2
// Simple solution: We only inject the mathjax bridge script if the page contains MathJax v3/v4, well
// to be precise, we do inject the script in all pages but when we detect it does not contain MathJax v3/v4 we exit (empty function)

(function () {
	// Exit early when the site is not running MathJax v3/v4
	var mathjax = window.MathJax;
	var version = mathjax && mathjax.version ? mathjax.version : null;
	if (!mathjax || !(version && (version.startsWith('3') || version.startsWith('4')))) {
		return;
	}

	// MathJax stores the LaTeX in its internal list of math items, we can access it trough the MathJax API
	// by walking the list or by simply using the new function `MathJax.startup.document.getMathItemsWithin()`.
	// TODO: see if using the new API function would benefit in any way
  function getLatexForContainer(mjxContainer) {
    if (typeof mathjax === 'undefined' || !mathjax.startup || !mathjax.startup.document || !mathjax.startup.document.math) {
        return null;
    }

    const targetHTML = mjxContainer.innerHTML; // Read the HTML of the provided container
    let current = mathjax.startup.document.math.list; // Get the list of math items using the MathJax API

		while (current && current.data) {
			const mathItem = current.data; // The math item is stored in the data field of the list element
      if (
        mathItem.typesetRoot &&
        mathItem.typesetRoot.innerHTML === targetHTML // (current element inner HTML === targeted element inner HTML)
      ) {
				if (mathItem.math && typeof mathItem.math === 'string') {
					return mathItem.math.trim(); // The latex is stored inside the data.math of each list element
				}
			}
			current = current.next;
      if (current === mathjax.startup.document.math.list) { // Back on the starting point (it's a circular list)
        break;
      }
		}
		return null; // No LaTeX code found in the list of math items
  }

  // Listens for an event (hover or click)
  // detects if the targeted element is a child of a mathjax container
  // if it is, it gets it's LaTeX code and sends it
  // as a runtime message (so that main.js can read it)
  function handleMathJaxEvent(event) {
    const mjx = event.target.closest('mjx-container');
    if (!mjx) return;

    const latex = getLatexForContainer(mjx);
    if (!latex) return;

    window.postMessage(
      {
        type: 'CopyLaTeX_MathJaxV3',
        latex,
        mjxId: mjx.getAttribute('ctxtmenu_counter'),
      },
      '*'
    );
  }

 	// On hover get the LaTeX of the container and send it as a message
  document.addEventListener('mouseover', handleMathJaxEvent, true);
  // Also send it in the case of a click (just in case someone is using the extension in mobile and can click but cannot hover)
  document.addEventListener('click', handleMathJaxEvent, true);
})();
