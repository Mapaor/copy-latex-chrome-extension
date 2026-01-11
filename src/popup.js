// Load and display current format preference
document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById('formatToggle');
  
  // Load saved preference
  const result = await chrome.storage.local.get('outputFormat');
  const isTypst = result.outputFormat === 'typst';
  toggle.checked = isTypst;
  
  // Save preference on change
  toggle.addEventListener('change', async (e) => {
    const format = e.target.checked ? 'typst' : 'latex';
    await chrome.storage.local.set({ outputFormat: format });
  });
});