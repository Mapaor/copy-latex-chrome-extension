// Background script (service worker) for context menu

// We use the Polyfill extension to use promise-based 'browser' API in Chrome (instead of the default 'chrome' callback-based API).
importScripts('lib/polyfill/browser-polyfill.min.js');

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

// Handle context menu clicks. The content script reads and clones the live selection;
// the background only routes the request and never serializes page DOM.
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return;

  try {
    const response = await browser.tabs.sendMessage(tab.id, {
      type: 'convertSelectionToMarkdown',
    });
    if (!response?.ok) {
      console.error('[Copy LaTeX] Copy failed:', response?.error || 'No response from content script');
    }
  } catch (error) {
    console.error('[Copy LaTeX] Error:', error);
  }
});
