// popup.js — shared by popup.html and welcome.html. Key entry lives ONLY on
// the welcome page (#api-key/#save-btn/#save-status and the Gemini elements
// #gemini-key/#save-gemini-btn/#save-gemini-status); the popup has neither —
// it is engine-picker + status + nudge. Every block guards on its elements.

const keyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const status = document.getElementById('save-status');
const keyState = document.getElementById('key-state'); // may be null

if (keyInput) {
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
      showStatus(status, 'Enter an API key first.', 'error');
      return;
    }
    if (!value.startsWith('sk-')) {
      showStatus(status, 'That doesn\'t look like an Anthropic key.', 'error');
      return;
    }
    chrome.storage.local.set({ apiKey: value }, () => {
      keyInput.value = '';
      keyInput.placeholder = 'sk-…' + value.slice(-4);
      showKeyState(value);
      showStatus(status, 'Saved — Ballpark now uses your Claude key.', 'ok');
      // Saving a key also activates that engine: the dispatcher is config-only,
      // so a saved-but-unselected key would silently keep answering on the free
      // engine. The engine toggle remains the way to flip back.
      setEngine('anthropic');
    });
  });

  keyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });
}

// ---- Gemini key (the welcome page's cloud-fallback offer; absent in popup) ----

const geminiKeyInput = document.getElementById('gemini-key');
const geminiSaveBtn = document.getElementById('save-gemini-btn');
const geminiStatus = document.getElementById('save-gemini-status');

if (geminiKeyInput) {
  chrome.storage.local.get('geminiApiKey', ({ geminiApiKey }) => {
    if (geminiApiKey) geminiKeyInput.placeholder = '…' + geminiApiKey.slice(-4);
  });

  geminiSaveBtn.addEventListener('click', () => {
    const value = geminiKeyInput.value.trim();
    if (!value) {
      showStatus(geminiStatus, 'Enter a key first.', 'error');
      return;
    }
    // Google issues both classic `AIza…` keys and the newer `AQ.…` auth keys.
    if (!value.startsWith('AIza') && !value.startsWith('AQ.')) {
      showStatus(geminiStatus, 'That doesn\'t look like a Gemini key.', 'error');
      return;
    }
    chrome.storage.local.set({ geminiApiKey: value }, () => {
      geminiKeyInput.value = '';
      geminiKeyInput.placeholder = '…' + value.slice(-4);
      showStatus(geminiStatus, 'Saved — Ballpark now uses the free cloud engine.', 'ok');
      setEngine('gemini');
    });
  });

  geminiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') geminiSaveBtn.click();
  });
}

function showStatus(el, msg, type) {
  if (!el) return;
  el.textContent = msg;
  el.className = 'hint status-' + type;
  setTimeout(() => {
    el.textContent = '';
    el.className = 'hint';
  }, 3000);
}

// Persistent indicator that a key is stored (popup only).
function showKeyState(apiKey) {
  if (!keyState) return;
  keyState.textContent = '✓ Key saved (…' + apiKey.slice(-4) + ')';
}

// ---- Calibration-engine picker (popup only; welcome.html lacks these) ----
// Two segments [ free | Claude ]. Nano and Gemini are mutually exclusive free
// engines (Gemini is the fallback for devices that can't run Nano), so the
// free segment renders one of them contextually via engineState().freeEngine —
// never both.

const segOndevice = document.getElementById('seg-ondevice');
const segKey = document.getElementById('seg-key');
const engineHint = document.getElementById('engine-hint');
const engineNudge = document.getElementById('engine-nudge');

const FREE_SEG_LABELS = {
  nano: '⚡ On-device<small>Free · private</small>',
  gemini: '☁ Gemini<small>Free · cloud</small>',
};

const ENGINE_HINTS = {
  nano: 'Free, on-device — no key needed.',
  'nano-key': 'On-device — your saved Claude key is kept, just not used right now.',
  gemini: 'Free cloud — no web search, daily limit.',
  anthropic: 'Web-searched, source-backed answers via your Claude key.',
};

// What a click on the free segment selects; set by the last render.
let currentFreeEngine = 'nano';

function renderEngine({ apiKey, geminiApiKey, activeProvider }) {
  const { active, freeEngine, enabled } =
    BallparkStatus.engineState({ apiKey, geminiApiKey, activeProvider });
  currentFreeEngine = freeEngine;
  segOndevice.innerHTML = FREE_SEG_LABELS[freeEngine];
  segOndevice.classList.toggle('on', active !== 'anthropic');
  segKey.classList.toggle('on', active === 'anthropic');
  segKey.disabled = !enabled.anthropic;
  engineHint.textContent =
    active === 'anthropic' ? ENGINE_HINTS.anthropic
    : active === 'gemini' ? ENGINE_HINTS.gemini
    : enabled.anthropic ? ENGINE_HINTS['nano-key']
    : ENGINE_HINTS.nano;
  refreshNudge({ apiKey, geminiApiKey, activeProvider, enabled, active });
}

// Contextual link under the hint. Priority: "Finish setup →" when On-device is
// the active engine but the model isn't ready (availability lives in the ESM
// Nano provider, so ask the worker); else "Add a Claude key →" when no paid
// key is saved (key entry lives on the welcome page); hidden when Claude is
// active.
function refreshNudge({ apiKey, geminiApiKey, activeProvider, enabled, active }) {
  if (!engineNudge) return;
  if (active === 'anthropic') {
    engineNudge.hidden = true;
    return;
  }
  chrome.runtime.sendMessage({ type: 'GET_NANO_STATE' }, (resp) => {
    const nanoState = chrome.runtime.lastError ? null : resp && resp.state;
    if (BallparkStatus.nanoNudgeVisible({ apiKey, geminiApiKey, activeProvider, nanoState })) {
      engineNudge.textContent = 'Finish setup →';
      engineNudge.hidden = false;
    } else if (!enabled.anthropic) {
      engineNudge.textContent = 'Add a Claude key →';
      engineNudge.hidden = false;
    } else {
      engineNudge.hidden = true;
    }
  });
}

// Guarded: popup.js is shared with welcome.html, which has no engine elements.
function refreshEngine() {
  if (!segOndevice) return;
  chrome.storage.local.get(['apiKey', 'geminiApiKey', 'activeProvider'], renderEngine);
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
  segOndevice.addEventListener('click', () => setEngine(currentFreeEngine));
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
