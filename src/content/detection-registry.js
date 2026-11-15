(() => {
  const ns = (window.CopyLatex = window.CopyLatex || {});
  const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

  function candidateRule(group, selectors, relations = {}) {
    return {
      group,
      selectors,
      target: relations.target ?? ["self", "ancestors"],
      subtree: relations.subtree ?? ["root", "descendants"],
      range: relations.range ?? [
        "root",
        "descendants",
        "search-root-ancestors",
      ],
    };
  }

  const KATEX_COPY_DUPLICATE_POLICY = {
    id: "katex-copy-gesture",
    key: "tex",
    windowMs: 700,
  };

  // ==== CHECKS (boolean helper functions) ====

  function isWikipedia() {
    const hostname = window.location.hostname;
    return (
      hostname.endsWith(".wikipedia.org") ||
      hostname === "www.wikiwand.com" ||
      hostname === "wikimedia.org" ||
      hostname.endsWith(".wikiversity.org") ||
      hostname.endsWith(".wikibooks.org")
    ); // True if Wikipedia, Wikimedia, Wikiversity, Wikibooks or Wikiwand
  }

  function isGoogleSearch() {
    const hostname = window.location.hostname;
    return (
      hostname === "www.google.com" ||
      hostname.endsWith(".google.com") ||
      hostname.startsWith("www.google.")
    );
  }

  function isZhihu() {
    const hostname = window.location.hostname;
    return hostname === "zhihu.com" || hostname.endsWith(".zhihu.com"); // For example zhuanlan.zhihu.com
  }

  function isHtmlElementNamed(el, localName) {
    return el?.namespaceURI === HTML_NAMESPACE && el.localName === localName;
  }

  function hasAnyClass(el, classNames) {
    return classNames.some((className) => el.classList.contains(className));
  }

  // ====== EXTRACTOR HELPER FUNCTIONS ======

  function extractWikipediaMathJaxDataMwTex(el) {
    if (!isHtmlElementNamed(el, "mjx-container")) return null;

    const mathElement = el.querySelector(".mwe-math-element[data-mw]");
    try {
      const source = JSON.parse(mathElement?.getAttribute("data-mw") || "").body
        ?.extsrc;
      if (typeof source === "string" && source.trim()) return source.trim();
    } catch {
      // Ignore absent or malformed metadata and let the detector chain continue.
    }
    return null;
  }

  function extractWikipediaImageAltTex(el) {
    if (!isHtmlElementNamed(el, "img")) return null;
    if (
      !hasAnyClass(el, [
        "mwe-math",
        "mwe-math-fallback-image-inline",
        "mwe-math-fallback-image-display",
      ])
    ) {
      return null;
    }
    const alt = el.getAttribute("alt");
    if (!alt?.trim()) return null;
    const match = alt.trim().match(/^\{\\displaystyle\s*([\s\S]*?)\}$/);
    return match ? match[1].trim() : alt.trim();
  }

  function extractMathJaxV3Tex(el) {
    // MathJax v3/v4 renders into an HTML custom element (`mjx-container`), not a MathML <math> node
    const mjxContainer = isHtmlElementNamed(el, "mjx-container") ? el : null;
    if (!mjxContainer) return null;

    const containerId = mjxContainer.getAttribute("data-copy-latex-mathjax-id");
    const indexedTex =
      containerId && ns.state.mathJaxV3LatexById?.get(containerId);
    if (typeof indexedTex === "string" && indexedTex.trim())
      return indexedTex.trim();

    // In case no LaTeX code is found, fallback to nearby TeX script nodes (used in some MathJax integrations)
    let current = mjxContainer;
    for (let i = 0; i < 5; i++) {
      // Note: 5 is kinda arbitrary here (siblings scanned), to avoid a too broad scanning
      current = current.nextElementSibling;
      if (!current) break;
      if (
        isHtmlElementNamed(current, "script") &&
        (current.type === "math/tex" ||
          current.type === "math/tex; mode=display")
      ) {
        return current.textContent.trim() || null;
      }
    }
    return null;
  }

  // ChatGPT has a custom KaTeX rendering, the LaTeX code is on an ancestor's data-math-source attribute.
  function extractChatGPTTex(el) {
    const mathSource = el
      .closest("[data-math-source]")
      ?.getAttribute("data-math-source");
    return mathSource?.trim() || null;
  }

  // Most KaTeX renderers commonly keep TeX inside MathML annotation (or data) attributes
  function extractAnnotationTex(el) {
    const annotation = el.querySelector(
      'annotation[encoding="application/x-tex"], ' +
        'annotation[encoding="application/x-latex"], ' +
        'annotation[encoding="application/tex"]',
    );
    return annotation?.textContent.trim() || null;
  }

  function extractKatexAttributeTex(el) {
    const dataLatex =
      el.getAttribute("data-tex") ||
      el.getAttribute("data-latex") ||
      el.getAttribute("aria-label");
    return dataLatex?.trim() || null;
  }

  function extractZhihuTex(el) {
    const value = el.getAttribute("data-tex")?.trim();
    if (!value) return null;

    const delimiterPairs = [
      ["\\[", "\\]"],
      ["\\(", "\\)"],
      ["$$", "$$"],
      ["$", "$"],
    ];
    for (const [opening, closing] of delimiterPairs) {
      if (value.startsWith(opening) && value.endsWith(closing)) {
        return value.slice(opening.length, -closing.length).trim() || null;
      }
    }
    return value;
  }

  function getZhihuDisplayMode(el) {
    const script = el.querySelector('script[type^="math/tex"]');
    const type =
      script?.getAttribute("type")?.replace(/\s/g, "").toLowerCase() || "";
    return type.includes("mode=display") ? "display" : "inline";
  }

  function getKatexDisplayMode(el) {
    return el.closest(".katex-display") ? "display" : "inline";
  }

  function extractGoogleSearchTex(el) {
    const latex =
      el.getAttribute("data-xpm-latex") ||
      el.querySelector("[data-xpm-latex]")?.getAttribute("data-xpm-latex");
    return latex?.trim() || null;
  }

  function getGoogleSearchDisplayMode(el) {
    const root = el.closest("[data-xpm-copy-root]") || el;
    return root.style.display === "inline-flex" ? "display" : "inline";
  }

  function findFollowingMathJaxTex(el, scriptTypes) {
    // Return undefined when no matching script exists
    let sibling = el.nextElementSibling;
    while (sibling) {
      if (
        isHtmlElementNamed(sibling, "script") &&
        scriptTypes.includes(sibling.type)
      ) {
        return sibling.textContent.trim() || null;
      }
      sibling = sibling.nextElementSibling;
    }
    return undefined;
  }

  function extractMathJaxTex(el) {
    // MathJax v2 display equations have their LaTeX code in a sibling math/tex script with mode=display
    const mathJaxDisplay = el?.matches?.(".MathJax_Display, .MJXc-display") // MathJax v2 display equations can be identified by these classes
      ? el
      : null;
    if (mathJaxDisplay) {
      const tex = findFollowingMathJaxTex(mathJaxDisplay, [
        "math/tex; mode=display",
      ]);
      if (tex !== undefined) return tex;
    }

    // MathJax v2 inline equations work the same way (via the sibling script)
    const mathJaxInline = el?.matches?.(
      ".MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML",
    ) // MathJax v2 inline equations can be identified by these classes
      ? el
      : null;
    if (!mathJaxInline) return null;

    // If it has a MathJax-Element-[something] id, check for a math/tex script first
    if (mathJaxInline.id?.includes("MathJax-Element-")) {
      const tex = findFollowingMathJaxTex(mathJaxInline, ["math/tex"]);
      if (tex !== undefined) return tex;
    }

    // As a fallback, also check for either script type alongside inline equations
    return (
      findFollowingMathJaxTex(mathJaxInline, [
        "math/tex",
        "math/tex; mode=display",
      ]) ?? null
    );
  }

  const KATEX_ENTRIES = [
    {
      id: "katex-data-math-source",
      candidates: [candidateRule("katex", [".katex"])],
      matches: (el) => el.classList.contains("katex"),
      extractTex: extractChatGPTTex,
      getDisplayMode: getKatexDisplayMode,
      duplicatePolicy: KATEX_COPY_DUPLICATE_POLICY,
      testingExamples: [],
    },
    {
      id: "katex-annotation",
      candidates: [candidateRule("katex", [".katex"])],
      matches: (el) => el.classList.contains("katex"),
      extractTex: extractAnnotationTex,
      getDisplayMode: getKatexDisplayMode,
      duplicatePolicy: KATEX_COPY_DUPLICATE_POLICY,
      testingExamples: [
        "https://fmin.xyz/docs/theory/convex%20sets/Affine_sets.html",
        "https://katex.org/",
        "https://chat.deepseek.com",
        "https://chatgpt.com",
      ],
    },
    {
      id: "katex-attributes",
      candidates: [candidateRule("katex", [".katex"])],
      matches: (el) => el.classList.contains("katex"),
      extractTex: extractKatexAttributeTex,
      getDisplayMode: getKatexDisplayMode,
      duplicatePolicy: KATEX_COPY_DUPLICATE_POLICY,
      testingExamples: [],
    },
  ];

  // ========= DETECTION REGISTRY ==========

  const DETECTION_REGISTRY = [
    // Note: order is slightly important (in the rare case of candidate overlap, order determines which one is used)
    {
      id: "wikipedia-mathjax-data-mw",
      site: "wikipedia",
      appliesTo: isWikipedia,
      candidates: [candidateRule("mathjax-container", ["mjx-container"])],
      matches: (el, context) =>
        context.site === "wikipedia" && isHtmlElementNamed(el, "mjx-container"),
      extractTex: extractWikipediaMathJaxDataMwTex,
      getDisplayMode: (el) =>
        el.getAttribute("display") === "true" ? "display" : "inline",
      getOverlayTarget: (el) =>
        el.getAttribute("display") === "true"
          ? el.querySelector("svg") || el
          : el,
      testingExamples: ["https://en.wikipedia.org/wiki/Euler%27s_formula"],
    },
    {
      id: "wikipedia-image-alt",
      site: "wikipedia",
      appliesTo: isWikipedia,
      candidates: [
        candidateRule("wikipedia-images", [
          "img.mwe-math",
          "img.mwe-math-fallback-image-inline",
          "img.mwe-math-fallback-image-display",
        ]),
      ],
      matches: (el, context) =>
        context.site === "wikipedia" &&
        isHtmlElementNamed(el, "img") &&
        hasAnyClass(el, [
          "mwe-math",
          "mwe-math-fallback-image-inline",
          "mwe-math-fallback-image-display",
        ]),
      extractTex: extractWikipediaImageAltTex,
      getDisplayMode: (el) =>
        el.classList.contains("mwe-math-fallback-image-display")
          ? "display"
          : "inline",
      testingExamples: ["https://www.wikiwand.com/en/Euler's_formula"], // Recentyl Wikipedia updated all equatoins to use SVGs, wikiwand still uses <img> with an alt description
    },
    {
      id: "zhihu-data-tex",
      site: "zhihu",
      appliesTo: isZhihu,
      candidates: [candidateRule("zhihu-math", [".ztext-math[data-tex]"])],
      matches: (el, context) =>
        context.site === "zhihu" && el.matches(".ztext-math[data-tex]"),
      extractTex: extractZhihuTex,
      getDisplayMode: getZhihuDisplayMode,
      testingExamples: [
        "https://www.zhihu.com/en/article/45078785",
        "https://zhuanlan.zhihu.com/p/420075994",
      ],
    },
    {
      id: "google-ai-data-xpm",
      site: "google-search",
      appliesTo: isGoogleSearch,
      candidates: [
        candidateRule("google-xpm-copy-root", ["[data-xpm-copy-root]"]),
        candidateRule("google-xpm-latex", ["[data-xpm-latex]"]),
      ],
      matches: (el, context) =>
        context.site === "google-search" &&
        (el.hasAttribute("data-xpm-copy-root") ||
          el.hasAttribute("data-xpm-latex")),
      extractTex: extractGoogleSearchTex,
      getDisplayMode: getGoogleSearchDisplayMode,
      testingExamples: [
        "https://www.google.com/search?client=firefox-b-d&q=explain+to+me+the+euler+identity+and+where+it+comes+from",
      ],
    },
    ...KATEX_ENTRIES,
    {
      id: "data-math",
      candidates: [candidateRule("data-math", ["[data-math]"])],
      matches: (el) => el.hasAttribute("data-math"),
      extractTex: (el) => el.getAttribute("data-math"),
      getDisplayMode: (el) =>
        isHtmlElementNamed(el, "div") ? "display" : "inline",
      testingExamples: [],
    },
    {
      id: "mathjax-v3-v4-api",
      candidates: [candidateRule("mathjax-container", ["mjx-container"])],
      matches: (el) => isHtmlElementNamed(el, "mjx-container"),
      extractTex: extractMathJaxV3Tex,
      getDisplayMode: (el) =>
        el.hasAttribute("display") ? "display" : "inline",
      testingExamples: [
        "https://sylvain69780.github.io/2021/06/05/dihedral-angle-and-the-spider-slider-puzzle.html",
        "https://11011110.github.io/blog/2026/08/17/fractional-rings-tangent.html",
      ],
    },
    {
      id: "mathjax-v2",
      candidates: [
        candidateRule("mathjax-v2-display", [
          ".MathJax_Display",
          ".MJXc-display",
        ]),
        candidateRule("mathjax-v2-inline", [
          ".MathJax",
          ".mjx-chtml",
          ".MathJax_CHTML",
          ".MathJax_MathML",
        ]),
      ],
      matches: (el) =>
        el.matches(
          ".MathJax_Display, .MJXc-display, .MathJax, .mjx-chtml, .MathJax_CHTML, .MathJax_MathML",
        ),
      extractTex: extractMathJaxTex,
      getDisplayMode: (el) =>
        el.matches(".MathJax_Display, .MJXc-display") ? "display" : "inline",
      testingExamples: [
        "https://math.stackexchange.com/questions/2660361/how-do-i-interpret-eulers-formula",
      ],
    },
  ];

  ns.detectionRegistry = DETECTION_REGISTRY;
})();
