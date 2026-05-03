// Background script (service worker) for context menu

// Promisified wrappers for contextMenus
function removeAllMenus() {
  return new Promise((resolve) => {
    chrome.contextMenus.removeAll(() => resolve());
  });
}
function createMenu(options) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(options, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}
function updateMenu(id, props) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.update(id, props, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

// Update context menu title based on user preference
async function updateContextMenuTitle() {
  const result = await chrome.storage.local.get('outputFormat');
  const format = result.outputFormat || 'latex';
  const title = format === 'typst'
    ? 'Copy as Typst'
    : 'Copy as Markdown (with LaTeX)';
  try {
    await updateMenu('copy-selection-as-markdown', { title });
  } catch (e) {
    // Menu might not exist yet; ignore
  }
}

// Update context menu visibility based on user preference
async function updateContextMenuVisibility() {
  const result = await chrome.storage.local.get('showContextMenu');
  // Default to true if undefined
  const showContextMenu = (result.showContextMenu === undefined) ? true : !!result.showContextMenu;

  // Remove all context menus before (re)creating
  try {
    await removeAllMenus();
  } catch (e) {
    console.warn('[Copy LaTeX] Error removing context menus:', e);
  }

  if (showContextMenu) {
    const formatResult = await chrome.storage.local.get('outputFormat');
    const format = formatResult.outputFormat || 'latex';
    const title = format === 'typst'
      ? 'Copy as Typst'
      : 'Copy as Markdown (with LaTeX)';
    try {
      await createMenu({
        id: 'copy-selection-as-markdown',
        title,
        contexts: ['selection']
      });
    } catch (e) {
      console.error('[Copy LaTeX] Error creating context menu:', e);
    }
  } else {
    // No need to do anything else since we already removed all menus
  }
}


// Create context menu on installation or startup
chrome.runtime.onInstalled.addListener(() => {
  updateContextMenuVisibility();
});
chrome.runtime.onStartup.addListener(() => {
  updateContextMenuVisibility();
});

// Storage change listener
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.showContextMenu) {
    await updateContextMenuVisibility();
  }
  if (changes.outputFormat) {
    await updateContextMenuTitle();
  }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'copy-selection-as-markdown' && tab?.id) {
    // console.log('[Copy LaTeX] Context menu clicked, tab ID:', tab.id);

    try {
      // Execute script to get the selection HTML
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          // This function runs in the content script context
          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) {
            return { ok: false, error: 'No selection' };
          }

          const container = document.createElement('div');
          for (let i = 0; i < selection.rangeCount; i++) {
            container.appendChild(selection.getRangeAt(i).cloneContents());
          }

          const html = container.innerHTML;
          // console.log('[Copy LaTeX] Selection HTML:', html.substring(0, 200));

          // Return HTML to background script
          return { ok: true, html, text: selection.toString() };
        }
      });

      // console.log('[Copy LaTeX] executeScript result:', results);

      if (results && results[0] && results[0].result) {
        const result = results[0].result;

        if (result.ok && result.html) {
          // console.log('[Copy LaTeX] Got selection HTML, length:', result.html.length);

          // Send message to content script to convert HTML to Markdown
          const response = await chrome.tabs.sendMessage(tab.id, {
            type: 'convertHtmlToMarkdown',
            html: result.html
          });

          // console.log('[Copy LaTeX] Markdown conversion response:', response);

          if (response && response.ok) {
            // console.log('[Copy LaTeX] Copy successful');
          } else {
            console.error('[Copy LaTeX] Copy failed:', response?.error);
          }
        } else {
          console.error('[Copy LaTeX] No selection or error:', result.error);
        }
      }
    } catch (error) {
      console.error('[Copy LaTeX] Error:', error);
      console.error('[Copy LaTeX] Error details:', JSON.stringify(error, null, 2));
    }
  }
});
