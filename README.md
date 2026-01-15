# CopyLaTeX

A Firefox extension that lets you quickly copy LaTeX code (KaTeX or MathJax) from equations displayed on websites like ChatGPT, DeepSeek, or any blog using mathematical equations. It works simply by hovering over an equation and clicking to copy the LaTeX expression.

Version 1.1: Now it also works with with Wikipedia and Wikiwand images.

Version 1.2: Now it also works for MathJax v3 (when there is no LaTeX code in the HTML) via API.

Version 1.3: Dark mode enabled and replaced check emoji with SVG icon.

Version 1.4: New feature! Select text (that includes formulas), right click on it and a `Copy as Markdown (with LaTeX)` option will appear.

## Example GIFs
#### KaTeX
<img src="assets/gif-demo-katex.gif" alt="Demo-KaTeX" width="800">

#### MathJax
<img src="assets/gif-demo-mathjax.gif" alt="Demo-MathJax" width="800">

#### Wikipedia images
<img src="assets/gif-demo-wikipedia.gif" alt="Demo-MathJax" width="800">

#### Copy as Markdown
<img src="assets/gif-demo-copy-as-markdown.gif" alt="Demo-Markdown" width="800">

You can use [https://markdown-preview-katex.vercel.app/](https://markdown-preview-katex.vercel.app/) to test this feature.

#### Copy as Typst

<img src="assets/gif-demo-copy-as-typst.gif" alt="Demo-Typst" width="800">

You can use [https://typst-online.vercel.app/](https://typst-online-editor.vercel.app/) to test this feature.


## Popular Sites Using MathJax/KaTeX
Generally any math, physics, or engineering-related blog or website. Some typical examples:
- KaTeX: ChatGPT, DeepSeek, Notion, Gemini...
- MathJax: Stack Exchange, ProofWiki...

## Host permissions and speed
You can check the javascript source code yourself. It loads after everything and is very fast and small sized. However if you want you can always customize in which hosts (websites) the extension loads or not:

<img src="assets/toggle-firefox.jpg" alt="Manage-extension-permissions" width="800">

This is done in "Firefox Settings > Extensions & Themes" (or simply search `about:addons`), clicking the extension and choosing the tab "Permissions and Data".

In case you turn off the "all sites" toggle option, you can also add manual sites that are not in the default list.

<img src="assets/manual-specific-site.jpg" alt="Manage-extension-permissions" width="800">

And now the custom site should appear as a new toggle in the "Permissions and data" tab.


## How it works technically

1. **Content Script (`content.js`)**:
   -  **For KaTeX**
      - Automatically detects all `<span class="katex">` elements on the page.
      - Extracts the LaTeX code from `<annotation encoding="application/x-tex">`.
   - **For Gemini KaTeX**
     - Extracts LaTeX inside `data-math` attribute.
   - **For MathJax**
     - Extracts LaTeX inside `<script type="math/tex">` elements.
   - **For MathJax v3/v4**
      - Injects page script (`mathjax-api.js`) to extract LaTeX from `mjx-container` elements via MathJax's API. Only possible via API and inject script because no LaTeX code present in the generated HTML.
   - **For Wikipedia**
     - Extracts LaTeX from `alt` attributes of images.
   - **For all of them** 
   - Shows an overlay when hovering over the equation.
   - Allows clicking to copy the code to clipboard using `navigator.clipboard.writeText()`.
   - Uses an inline `<svg>` to avoid external file dependencies.

2. **CSS (`overlay.css`)**:
   - Overlay styling: white background, subtle border and shadow.
   - Large, readable text.
   - Centered over the KaTeX formula.
   - `pointer` cursor.

3. **Extension declaration `manifest.json`**:
   - Injects `content.js`, `overlay.css` and the other scripts.
   - Sets information and permissions of the extension.
4. **Background script `background.js`**:
   - Handles context menu (right click). Needed to display the "Copy as Markdown" option when right clicking the selected text.
5. **Selection script `selection-to-markdown.js`**:
   - A set of functions, workers and utilities to convert HTML to markdown while preserving our extracted LaTeX. Under the hood uses the `turndown.js` library and the `turndown-plugin-gfm.js` GitHub-flavored markdown plugin for converting HTML to Markdown.

### How to test the extension locally

1. Create a zip that contains all the files inside the `src` directory (without containing the src folder itself).
2. Then go to `about:debugging` (as if it were an URL) and in the 'This Firefox' tab select the button 'Load a Temporary Add-On...' and input the zip file.

## Links
- Firefox Add-on page: [https://addons.mozilla.org/en-US/firefox/addon/copy-latex](https://addons.mozilla.org/en-US/firefox/addon/copy-latex)
- GitHub Repo: [https://github.com/Mapaor/copy-latex-firefox-extension](https://github.com/Mapaor/copy-latex-firefox-extension)
- README as a website: [https://mapaor.github.io/copy-latex-firefox-extension/](https://mapaor.github.io/copy-latex-firefox-extension/)

## Chrome version
There is also a Chrome version of this extension: [https://github.com/Mapaor/copy-latex-chrome-extension](https://github.com/Mapaor/old-copy-latex-chrome-extension) 

TODO: Update chrome version and generate it as a fork of this one (pending).

## Acknowledgements

Credits to @leander-ow for his dark mode contribution and to  @ashigirl96 for suggesting and providing a working code implementation for the "Copy as Markdown" feature. 

This extension also works thanks to the following open source projects:
- [Turndown](https://github.com/mixmark-io/turndown) - Library for converting HTML to Markdown
- [tex2typst](https://github.com/qwinsi/tex2typst) - Library for converting LaTeX to Typst
- [markdown2typst](https://github.com/Mapaor/markdown2typst) - Library for converting Markdown to Typst

## License

MIT License.

It is MIT Licensed so that anyone can customize it to their needs but please don't just copy-cat the code and publish it with a new name, it's weird. 

If you have an idea for a new feature open an issue and let me know! Also if you have the time to implement a feature you want it would be great if you made a pull request.

## Planned features:

- [X] **Text selection to Markdown**: Select some text that includes equations, right click and a new option "[Extension Icon] Copy as Markdown" appears.
- [ ] **Typst support**: 
  Pop up with a toggle between LaTeX and Typst
- [ ] **Custom  delimiters**: 
Chose between no delimiters (default), `$` and `$$`, `\(` and `\[`, always `$`, or always `$$`.