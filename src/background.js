// Background script (service worker) for context menu
// Note: This script runs in the extension process (not inside a webpage)
// it is not a content script, it never inspects the DOM itself

// We use the Polyfill extension to use the promise-based 'browser' API in Chrome (instead of the default 'chrome' callback-based API).
importScripts('lib/polyfill/browser-polyfill.min.js');

// === UTILITY FUNCTIONS ===
function getContextMenuTitle(format) {
  const title = format === 'typst'
    ? 'Copy as Typst'
    : 'Copy as Markdown (with LaTeX)';
  return title;
}

// Read preferences function
async function getLocalStorageConfig() {
  // CONTEXT
  // The content script popup.js saves preference changes in the local storage
  // Here in the background script we need to await the browser API because extension's storage is always async

  // We read the preferences
  const result = await browser.storage.local.get(['outputFormat', 'showContextMenu']);

  // We save the preferences as local variables
  const format = result.outputFormat || 'latex';
  const showContextMenu = (result.showContextMenu === undefined) ? true : !!result.showContextMenu; // Defaults to true if undefined

  return { format, showContextMenu };
}

// === SHOW OR HIDE THE CONTEXT MENU COPY SELECTION OPTION ===
const CONTEXT_MENU_ID = 'copy-selection-as-markdown';

// Note: We first check if a context menu item already exists, if so we update it, if not we create it and then retry to update it.
// This is because context menu item needs to be updated (for when we change from copy as Markdown to copy as Typst)
// but it also can be shown or not (hide context menu option in settings), so this way we avoid initialization/updating conflicts.
async function ensureContextMenuExists({ title }) {
  try {
    await browser.contextMenus.update(CONTEXT_MENU_ID, { title }); // TRY TO UPDATE
    return;
  } catch (e) {
    // Menu might not exist yet (try creating it)
  }

  try {
    await browser.contextMenus.create({ // CREATE
      id: CONTEXT_MENU_ID,
      title,
      contexts: ['selection']
    });
  } catch (e) {
    // If it was created concurrently (or still exists), try updating it (once more)
    try {
      await browser.contextMenus.update(CONTEXT_MENU_ID, { title }); // TRY TO UPDATE ONCE AGAIN
    } catch (updateError) {
      console.error('[Copy LaTeX] Error ensuring context menu exists:', updateError);
    }
  }
}

// Removing an already absent menu (for when we change the show context menu preference)
async function ensureContextMenuRemoved() {
  try {
    await browser.contextMenus.remove(CONTEXT_MENU_ID);
  } catch (e) {
    // Menu might not exist (ignore)
  }
}

// Update the browser's actual menu with the current preferences
async function renderContextMenu() {
  const config = await getLocalStorageConfig(); // We read the local storage preferences

  // We save the context menu related preferenced as variables
  const format = config.format;
  const showContextMenu = config.showContextMenu;

  if (!showContextMenu) {
    await ensureContextMenuRemoved(); // Remove the item if 'Show context menu option' is unchecked
    return;
  }

  const title = getContextMenuTitle(format); // Use the proper item
  await ensureContextMenuExists({ title }); // Create (and update) the context menu item
}

// Create context menu on extension installation or extension startup
browser.runtime.onInstalled.addListener(() => {
  renderContextMenu();
});
browser.runtime.onStartup.addListener(() => {
  renderContextMenu();
});

// Listen for new preference changes regarding context menu
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.showContextMenu || changes.outputFormat) { // If it has changed
    await renderContextMenu(); // Create/update it again
  }
});

// === CONTEXT MENU CLICKS ===
// How it works: The background script is constanly listening for context menu clicks,
// when one happens, the browser supplies in which tab the click happened,
// and the background script sends a message to the content script of that tab saying it happened
// then the content script (on it's own) reads and clones the (live) selection
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID || !tab?.id) return;

  try {
    const response = await browser.tabs.sendMessage(tab.id, { // Browser Tabs API always needs to be awaited
      type: 'convertSelectionToMarkdown',
    });
    if (!response?.ok) { // The content script responds with an ok response if it succeeded copying the selection
      console.error('[Copy LaTeX] Copy failed:', response?.error || 'No response from content script');
    }
  } catch (error) {
    console.error('[Copy LaTeX] Error:', error);
  }
});
