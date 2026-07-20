// background.js — service worker
// Dispatches calibration requests to whichever provider is resolved (Nano on-device by
// default, Anthropic if a key is configured); content scripts can't call external APIs
// cleanly in MV3, so this is also where any network calls happen.

import { resolveProvider, providers } from './lib/providers/index.js';

// First-run onboarding: Web Store installs are unpinned by default and the
// popup is easy to miss, so on a fresh install we open a welcome tab that walks
// the user through the extension (an Anthropic API key is optional — Nano is
// the default) and pinning the toolbar icon.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

// Cached responses keyed by number + page URL. Stored in session storage so
// the cache survives service worker restarts but resets when the browser does.
// Same number on the same page will always produce the same answer, so re-clicks
// and accidental double-clicks are free.
const CACHE_PREFIX = 'calibration:';

function cacheKey({ number, pageUrl }) {
  return CACHE_PREFIX + number + '::' + pageUrl;
}

async function getCached(payload) {
  const key = cacheKey(payload);
  const result = await chrome.storage.session.get(key);
  return result[key] ?? null;
}

async function setCached(payload, data) {
  await chrome.storage.session.set({ [cacheKey(payload)]: data });
}

async function getConfig() {
  const { activeProvider = 'nano', apiKey, geminiApiKey } =
    await chrome.storage.local.get(['activeProvider', 'apiKey', 'geminiApiKey']);
  return { activeProvider, apiKey, geminiApiKey };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'CALIBRATE') return false;

  (async () => {
    try {
      const cached = await getCached(message.payload);
      if (cached) {
        sendResponse({ success: true, data: cached, cached: true });
        return;
      }

      const config = await getConfig();
      const provider = resolveProvider(config);
      const data = await provider.calibrate(message.payload, config);

      // Cache stable answers (real results + insufficient). Never cache a
      // transient device state — a re-click after download must re-run.
      if (!data.status) await setCached(message.payload, data);
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // keep the channel open for the async response
});

// A device-state note's action link asks the worker to open an extension page
// (the setup guide) — content scripts can't open the popup themselves.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'OPEN_PAGE') return false;
  // page is supplied by our own provider code; getURL confines it to the
  // extension origin regardless. Default to the guide.
  const page = typeof message.page === 'string' ? message.page : 'welcome.html';
  chrome.tabs.create({ url: chrome.runtime.getURL(page) });
  return false; // fire-and-forget; no async response
});

// The popup can't import the ESM Nano provider (it's a classic script), so it
// asks the worker for the current on-device availability to decide whether to
// show its "Finish setup" nudge. Read-only; never throws to the caller.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'GET_NANO_STATE') return false;
  providers.nano.availability()
    .then((state) => sendResponse({ state }))
    .catch(() => sendResponse({ state: 'unavailable' }));
  return true; // async response — keep the channel open
});
