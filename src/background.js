// Background script (service worker) for context menu

// Update context menu title based on user preference
async function updateContextMenuTitle() {
  const result = await chrome.storage.local.get('outputFormat');
  const format = result.outputFormat || 'latex';
  
  const title = format === 'typst' 
    ? 'Copy as Typst' 
    : 'Copy as Markdown (with LaTeX)';
  
  await chrome.contextMenus.update('copy-selection-as-markdown', { title });
}

// Create context menu on installation
chrome.runtime.onInstalled.addListener(async () => {
  const result = await chrome.storage.local.get('outputFormat');
  const format = result.outputFormat || 'latex';
  
  const title = format === 'typst' 
    ? 'Copy as Typst' 
    : 'Copy as Markdown (with LaTeX)';
  
  chrome.contextMenus.create({
    id: 'copy-selection-as-markdown',
    title: title,
    contexts: ['selection']
  });
  // console.log('[Copy LaTeX] Context menu created');
});

// Listen for storage changes to update context menu title
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.outputFormat) {
    updateContextMenuTitle();
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
            console.log('[Copy LaTeX] Copy successful');
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
