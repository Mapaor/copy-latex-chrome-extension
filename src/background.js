// Note: This script runs in the extension process (not inside a webpage)
// it is not a content script, it never inspects the DOM itself

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
  const result = await browser.storage.local.get(['outputFormat', 'showContextMenu', 'showOverlay']);

  // We save the preferences as local variables
  const format = result.outputFormat || 'latex';
  const showContextMenu = (result.showContextMenu === undefined) ? true : !!result.showContextMenu; // Defaults to true if undefined
  const showOverlay = (result.showOverlay === undefined) ? true : !!result.showOverlay; // Defaults to true for existing installs

  return { format, showContextMenu, showOverlay };
}

// === SHOW OR HIDE THE CONTEXT MENU COPY SELECTION OPTION ===
const CONTEXT_MENU_ID = 'copy-selection-as-markdown';
const COPY_EQUATION_CONTEXT_MENU_ID = 'copy-equation';

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

// The equation item is independent of the selection-to-markdown item
// Note: Leaving the equation context menu item always present (even for text nodes) is a design decision
// Firefox can support conditional visibility with contextMenus.refresh and contextMenus.onShown
// but unfortunately Chrome does not have equivalent APIs and therefore it wouldn't work in the chrom version
async function ensureEquationContextMenuExists() {
  try {
    await browser.contextMenus.update(COPY_EQUATION_CONTEXT_MENU_ID, { title: 'Copy equation' });
    return;
  } catch (e) {
    // Menu might not exist yet (try creating it)
  }

  try {
    await browser.contextMenus.create({
      id: COPY_EQUATION_CONTEXT_MENU_ID,
      title: 'Copy equation',
      contexts: ['all']
    });
  } catch (e) {
    try {
      await browser.contextMenus.update(COPY_EQUATION_CONTEXT_MENU_ID, { title: 'Copy equation' });
    } catch (updateError) {
      console.error('[Copy LaTeX] Error ensuring equation context menu exists:', updateError);
    }
  }
}

async function ensureEquationContextMenuRemoved() {
  try {
    await browser.contextMenus.remove(COPY_EQUATION_CONTEXT_MENU_ID);
  } catch (e) {
    // Menu might not exist (ignore)
  }
}

async function renderContextMenus() {
  const config = await getLocalStorageConfig();

  if (config.showContextMenu) {
    const title = getContextMenuTitle(config.format);
    await ensureContextMenuExists({ title });
  } else {
    await ensureContextMenuRemoved();
  }

  if (config.showOverlay) {
    await ensureEquationContextMenuRemoved();
  } else {
    await ensureEquationContextMenuExists();
  }
}

// Create context menu on extension installation or extension startup
browser.runtime.onInstalled.addListener(() => {
  renderContextMenus();
});
browser.runtime.onStartup.addListener(() => {
  renderContextMenus();
});

// Listen for new preference changes regarding context menu
browser.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.showContextMenu || changes.outputFormat || changes.showOverlay) { // If it has changed
    await renderContextMenus(); // Create/update the relevant items
  }
});

// === CONTEXT MENU CLICKS ===
// How it works: The background script is constanly listening for context menu clicks,
// when one happens, the browser supplies in which tab the click happened,
// and the background script sends a message to the content script of that tab saying it happened
// then the content script (on it's own) reads and clones the (live) selection
browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  let message;
  if (info.menuItemId === CONTEXT_MENU_ID) {
    message = { type: 'convertSelectionToMarkdown' };
  } else if (info.menuItemId === COPY_EQUATION_CONTEXT_MENU_ID) {
    message = { type: 'copyContextEquation' };
  } else {
    return;
  }

  try {
    const frameOptions = Number.isInteger(info.frameId) ? { frameId: info.frameId } : undefined;
    const response = frameOptions
      ? await browser.tabs.sendMessage(tab.id, message, frameOptions)
      : await browser.tabs.sendMessage(tab.id, message);
    if (!response?.ok) {
      console.error('[Copy LaTeX] Context menu action failed:', response?.error || 'No response from content script');
    }
  } catch (error) {
    console.error('[Copy LaTeX] Context menu action error:', error);
  }
});
