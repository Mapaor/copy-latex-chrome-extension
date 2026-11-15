document.addEventListener('DOMContentLoaded', async () => {

  // === UTILITY FUNCTIONS ===

  function restorePopupHeight() {
    body.classList.remove('expanded');
  }

  function increasePopupHeight() {
    body.classList.add('expanded');
  }

  function applyTheme(theme) {
    document.body.classList.remove('theme-light', 'theme-dark', 'theme-system');
    if (theme === 'light') {
      document.body.classList.add('theme-light');
    } else if (theme === 'dark') {
      document.body.classList.add('theme-dark');
    } else {
      document.body.classList.add('theme-system');
    }
  }

  // ==== TOGGLE LATEX-TYPST ====

  // Toggle button [LaTeX|Typst], unchecked means LaTeX checked means Typst
  const toggle = document.getElementById('formatToggle');
  const result = await browser.storage.local.get('outputFormat');
  const isTypst = result.outputFormat === 'typst';
  toggle.checked = isTypst;

  // Listen for changes on the toggle button
  toggle.addEventListener('change', async (e) => {
    const format = e.target.checked ? 'typst' : 'latex';
    await browser.storage.local.set({ outputFormat: format }); // Save preference
  });

  // === SETTINGS PANEL STATE ===

  // Note: the settings panel state (open or closed) is not saved anywhere, it's only for that popup instance
  // which is the intended UX (a new popup will always have the settings collapsed)
  const configBtn = document.getElementById('configBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  let panelOpen = false;
  const body = document.body;

  configBtn.addEventListener('click', (e) => { // Settings button clicked
    panelOpen = !panelOpen;
    settingsPanel.style.display = panelOpen ? 'block' : 'none'; // Show/hide settings
    if (panelOpen) {
      increasePopupHeight();
    } else {
      restorePopupHeight();
    }
  });

  // Clicking the popup but outside the settings panel collapses the settings
  document.addEventListener('mousedown', (e) => {
    if (panelOpen && !settingsPanel.contains(e.target) && !configBtn.contains(e.target)) {
      settingsPanel.style.display = 'none';
      panelOpen = false;
      restorePopupHeight();
    }
  });

  // ==== SETTINGS ====

  // SHOW OVERLAY ON HOVER (checked, unchecked)
  const showOverlayOptionCheckbox = document.getElementById('showOverlayOption');
  const overlayResult = await browser.storage.local.get('showOverlay');
  showOverlayOptionCheckbox.checked = (overlayResult.showOverlay === undefined) ? true : !!overlayResult.showOverlay;
  showOverlayOptionCheckbox.addEventListener('change', async () => {
    await browser.storage.local.set({ showOverlay: showOverlayOptionCheckbox.checked });
  });

  // SHOW COPY SELECTION OPTION (checked, unchecked)
  const contextMenuOptionCheckbox = document.getElementById('contextMenuOption');
  const cmResult = await browser.storage.local.get('showContextMenu');
  const showContextMenu = cmResult.showContextMenu;
  contextMenuOptionCheckbox.checked = (showContextMenu === undefined) ? true : !!showContextMenu; // Defaults to true if undefined
  contextMenuOptionCheckbox.addEventListener('change', async () => { // Listen for changes on the checkbox
    await browser.storage.local.set({ showContextMenu: contextMenuOptionCheckbox.checked }); // Save the preference
  });

  // OVERRIDE CTRL+C FOR SELECTION (unchecked by default)
  const overrideSelectionCopyOption = document.getElementById('overrideSelectionCopyOption');
  const overrideSelectionCopyResult = await browser.storage.local.get('overrideSelectionCopy');
  overrideSelectionCopyOption.checked = overrideSelectionCopyResult.overrideSelectionCopy === true;
  overrideSelectionCopyOption.addEventListener('change', async () => {
    await browser.storage.local.set({ overrideSelectionCopy: overrideSelectionCopyOption.checked });
  });

  // THEME (Light, Dark, System)
  const themeRadios = document.querySelectorAll('input[name="themeMode"]');
  const themeResult = await browser.storage.local.get('themeMode');
  const themeMode = themeResult.themeMode || 'system';
  for (const radio of themeRadios) {
    radio.checked = radio.value === themeMode;
    radio.addEventListener('change', async (e) => { // Listen for checkbox change events
      if (e.target.checked) {
        await browser.storage.local.set({ themeMode: e.target.value }); // Save theme preference
        applyTheme(e.target.value); // Apply theme preference
      }
    });
  }
  applyTheme(themeMode);
});
