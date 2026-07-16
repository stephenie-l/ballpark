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
    refreshEngine(); // the key side of the engine toggle can now be selected
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

// ---- Calibration-engine toggle (popup only; welcome.html lacks these) ----

const segOndevice = document.getElementById('seg-ondevice');
const segKey = document.getElementById('seg-key');
const engineHint = document.getElementById('engine-hint');

const ENGINE_HINTS = {
  'nano-nokey': 'Free, on-device — no key needed. Add a key below to unlock web-search grounding.',
  'nano-key': 'On-device — your saved key is kept, just not used right now.',
  anthropic: 'Using your Anthropic key — Haiku 4.5 with web-search grounding.',
};

function renderEngine({ apiKey, activeProvider }) {
  const { active, keyEnabled } = BallparkStatus.engineState({ apiKey, activeProvider });
  segOndevice.classList.toggle('on', active === 'nano');
  segKey.classList.toggle('on', active === 'anthropic');
  segKey.disabled = !keyEnabled;
  engineHint.textContent =
    active === 'anthropic'
      ? ENGINE_HINTS.anthropic
      : keyEnabled
        ? ENGINE_HINTS['nano-key']
        : ENGINE_HINTS['nano-nokey'];
}

// Guarded: popup.js is shared with welcome.html, which has no engine elements.
function refreshEngine() {
  if (!segOndevice) return;
  chrome.storage.local.get(['apiKey', 'activeProvider'], renderEngine);
}

function setEngine(provider) {
  chrome.storage.local.set({ activeProvider: provider }, () => {
    // Switching engines invalidates cached answers (the cache is keyed by
    // number+url, not provider), so clear the session cache — a re-click on the
    // same number then re-runs on the newly-selected engine.
    chrome.storage.session.clear(refreshEngine);
  });
}

if (segOndevice) {
  segOndevice.addEventListener('click', () => setEngine('nano'));
  segKey.addEventListener('click', () => { if (!segKey.disabled) setEngine('anthropic'); });
  refreshEngine();
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

// popup.js is shared with welcome.html, which has no status section and does not
// load lib/status.js. Only run the panel where it actually exists.
if (statusLine && typeof BallparkStatus !== 'undefined') {
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
}

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
