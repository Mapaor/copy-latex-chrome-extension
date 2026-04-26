// Load and display current format preference and context menu option
document.addEventListener('DOMContentLoaded', async () => {
      // Theme application logic
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
    // Theme radio buttons logic
    const themeRadios = document.querySelectorAll('input[name="themeMode"]');
    const themeResult = await browser.storage.local.get('themeMode');
    const themeMode = themeResult.themeMode || 'system';
    for (const radio of themeRadios) {
      radio.checked = radio.value === themeMode;
      radio.addEventListener('change', async (e) => {
        if (e.target.checked) {
          await browser.storage.local.set({ themeMode: e.target.value });
          applyTheme(e.target.value);
        }
      });
    }
    applyTheme(themeMode);
  // Format toggle logic
  const toggle = document.getElementById('formatToggle');
  const result = await chrome.storage.local.get('outputFormat');
  const isTypst = result.outputFormat === 'typst';
  toggle.checked = isTypst;
  
  // Save preference on change
  toggle.addEventListener('change', async (e) => {
    const format = e.target.checked ? 'typst' : 'latex';
    await browser.storage.local.set({ outputFormat: format });
  });

  // Config/settings panel logic
  const configBtn = document.getElementById('configBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  let panelOpen = false;
  const body = document.body;


  function restorePopupHeight() {
    body.classList.remove('expanded');
  }


  configBtn.addEventListener('click', (e) => {
    panelOpen = !panelOpen;
    settingsPanel.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) {
      body.classList.add('expanded');
    } else {
      restorePopupHeight();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (panelOpen && !settingsPanel.contains(e.target) && !configBtn.contains(e.target)) {
      settingsPanel.style.display = 'none';
      panelOpen = false;
      restorePopupHeight();
    }
  });

  // Context menu option checkbox logic
  const contextMenuOptionCheckbox = document.getElementById('contextMenuOption');
  const cmResult = await browser.storage.local.get('showContextMenu');
  // Default to true if undefined
  const showContextMenu = cmResult.showContextMenu;
  contextMenuOptionCheckbox.checked = (showContextMenu === undefined) ? true : !!showContextMenu;
  // Save the preference when the checkbox is toggled
  contextMenuOptionCheckbox.addEventListener('change', async () => {
    await browser.storage.local.set({ showContextMenu: contextMenuOptionCheckbox.checked });
  });

  // Config/settings panel logic
  const configBtn = document.getElementById('configBtn');
  const settingsPanel = document.getElementById('settingsPanel');
  let panelOpen = false;
  const body = document.body;


  function restorePopupHeight() {
    body.classList.remove('expanded');
  }


  configBtn.addEventListener('click', (e) => {
    panelOpen = !panelOpen;
    settingsPanel.style.display = panelOpen ? 'block' : 'none';
    if (panelOpen) {
      body.classList.add('expanded');
    } else {
      restorePopupHeight();
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (panelOpen && !settingsPanel.contains(e.target) && !configBtn.contains(e.target)) {
      settingsPanel.style.display = 'none';
      panelOpen = false;
      restorePopupHeight();
    }
  });

  // Context menu option checkbox logic
  const contextMenuOptionCheckbox = document.getElementById('contextMenuOption');
  const cmResult = await browser.storage.local.get('showContextMenu');
  // Default to true if undefined
  const showContextMenu = cmResult.showContextMenu;
  contextMenuOptionCheckbox.checked = (showContextMenu === undefined) ? true : !!showContextMenu;
  // Save the preference when the checkbox is toggled
  contextMenuOptionCheckbox.addEventListener('change', async () => {
    await browser.storage.local.set({ showContextMenu: contextMenuOptionCheckbox.checked });
  });
});