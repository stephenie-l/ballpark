// popup.js — shared by popup.html and welcome.html (both expose #api-key,
// #save-btn, #save-status; #key-state is optional and only present in the popup).

const keyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const status = document.getElementById('save-status');
const keyState = document.getElementById('key-state'); // may be null

// Load existing key (show masked if present)
chrome.storage.local.get('apiKey', ({ apiKey }) => {
  if (apiKey) {
    keyInput.placeholder = 'sk-…' + apiKey.slice(-4);
    showKeyState(apiKey);
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
    showKeyState(value);
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

// Persistent indicator that a key is stored (popup only).
function showKeyState(apiKey) {
  if (!keyState) return;
  keyState.textContent = '✓ Key saved (…' + apiKey.slice(-4) + ')';
}
