// background.js — service worker
// Handles all Anthropic API calls; content scripts can't call external APIs cleanly in MV3.

import { calibrate } from './lib/api.js';

let cachedPrompt = null;

async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const url = chrome.runtime.getURL('prompts/calibration.md');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load calibration prompt: ${res.status}`);
  cachedPrompt = await res.text();
  return cachedPrompt;
}

async function getApiKey() {
  const { apiKey } = await chrome.storage.local.get('apiKey');
  if (!apiKey) throw new Error('No API key set. Open the Ballpark popup to add your Anthropic API key.');
  return apiKey;
}

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'CALIBRATE') return false;

  (async () => {
    try {
      const cached = await getCached(message.payload);
      if (cached) {
        sendResponse({ success: true, data: cached, cached: true });
        return;
      }

      const [apiKey, prompt] = await Promise.all([getApiKey(), loadPrompt()]);
      const data = await calibrate(apiKey, prompt, message.payload);
      await setCached(message.payload, data);
      sendResponse({ success: true, data });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep message channel open for async response
});
