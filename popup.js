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

// ---- This-page status panel ----

const statusLine = document.getElementById('status-line');
const statusDetail = document.getElementById('status-detail');
const overrideBtn = document.getElementById('override-btn');

const OVERRIDE_LABELS = {
  'force-on': 'Run Ballpark on this site',
  'force-off': "Don't run on this site",
  'reset': 'Reset to automatic',
};

let activeTabId = null;
let pageHost = null;

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab || tab.id == null) return renderStatus(null);
  activeTabId = tab.id;
  chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, (status) => {
    // lastError fires when no content script is present (chrome://, web store…).
    if (chrome.runtime.lastError) return renderStatus(null);
    if (status) pageHost = status.host;
    renderStatus(status || null);
  });
});

function renderStatus(status) {
  const { line, detail } = BallparkStatus.formatStatus(status);
  statusLine.textContent = line;
  statusDetail.textContent = detail;

  const action = BallparkStatus.nextOverrideAction(status);
  if (!action || !pageHost) {
    overrideBtn.hidden = true;
    return;
  }
  overrideBtn.hidden = false;
  overrideBtn.textContent = OVERRIDE_LABELS[action];
  overrideBtn.onclick = () => applyOverrideAction(action);
}

function applyOverrideAction(action) {
  if (!pageHost || activeTabId == null) return;
  chrome.storage.local.get('siteOverrides', ({ siteOverrides }) => {
    const map = siteOverrides || {};
    if (action === 'reset') delete map[pageHost];
    else map[pageHost] = action; // 'force-on' | 'force-off'
    chrome.storage.local.set({ siteOverrides: map }, () => {
      chrome.tabs.reload(activeTabId);
      window.close(); // popup closes; reopen shows the new state
    });
  });
}
