// Background script (service worker) for context menu

const CONTEXT_MENU_ID = 'copy-selection-as-markdown';

function getContextMenuTitle(format) {


  const title = format === 'typst'
    ? 'Copy as Typst'
    : 'Copy as Markdown (with LaTeX)';
  return title;
}

async function getLocalStorageConfig() {
  const result = await browser.storage.local.get(['outputFormat', 'showContextMenu']);

  const format = result.outputFormat || 'latex';
  // Default to true if undefined
  const showContextMenu = (result.showContextMenu === undefined) ? true : !!result.showContextMenu;

  return { format, showContextMenu };
}

async function ensureContextMenuExists({ title }) {
  try {
    await browser.contextMenus.update(CONTEXT_MENU_ID, { title });
    return;
  } catch (e) {
    // Menu might not exist yet; try creating it.
  }

  try {
    await browser.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title,
      contexts: ['selection']
    });
  } catch (e) {
    // If it was created concurrently (or still exists), try updating once more.
    try {
      await browser.contextMenus.update(CONTEXT_MENU_ID, { title });
    } catch (updateError) {
      console.error('[Copy LaTeX] Error ensuring context menu exists:', updateError);
    }
  }
}

async function ensureContextMenuRemoved() {
  try {
    await browser.contextMenus.remove(CONTEXT_MENU_ID);
  } catch (e) {
    // Menu might not exist; ignore.
  }
}

// Render context menu based on user preference
async function renderContextMenu() {
  const config = await getLocalStorageConfig();
  const format = config.format;
  const showContextMenu = config.showContextMenu;

  if (!showContextMenu) {
    await ensureContextMenuRemoved();
    return;
  }

  const title = getContextMenuTitle(format);
  await ensureContextMenuExists({ title });
}


// Create context menu on installation or startup
browser.runtime.onInstalled.addListener(() => {
  renderContextMenu();
});
browser.runtime.onStartup.addListener(() => {
  renderContextMenu();
});

// Storage change listener
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.showContextMenu || changes.outputFormat) {
    await renderContextMenu();
  }
});

// Handle context menu clicks
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_ID && tab?.id) {
    // console.log('[Copy LaTeX] Context menu clicked, tab ID:', tab.id);

    try {
      // Execute script to get the selection HTML
      const results = await browser.scripting.executeScript({
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
          const response = await browser.tabs.sendMessage(tab.id, {
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
