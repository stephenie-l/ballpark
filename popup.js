// popup.js

const keyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const status = document.getElementById('save-status');

// Load existing key (show masked if present)
chrome.storage.local.get('apiKey', ({ apiKey }) => {
  if (apiKey) {
    keyInput.placeholder = 'sk-…' + apiKey.slice(-4);
  }
});

saveBtn.addEventListener('click', () => {
  const value = keyInput.value.trim();
  if (!value) {
    showStatus('Enter an API key first.', 'error');
    return;
  }
  if (!value.startsWith('sk-')) {
    showStatus('That doesn\'t look like an Anthropic key.', 'error');
    return;
  }
  chrome.storage.local.set({ apiKey: value }, () => {
    keyInput.value = '';
    keyInput.placeholder = 'sk-…' + value.slice(-4);
    showStatus('Saved.', 'ok');
  });
});

keyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveBtn.click();
});

function showStatus(msg, type) {
  status.textContent = msg;
  status.className = 'hint status-' + type;
  setTimeout(() => {
    status.textContent = '';
    status.className = 'hint';
  }, 3000);
}
