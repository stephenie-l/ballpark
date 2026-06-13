// content.js — main content script
// BallparkDetector and BallparkCard are loaded before this by the manifest.

(function () {
  'use strict';

  const RESCAN_DEBOUNCE_MS = 400;
  let observer = null;
  let rescanTimer = null;
  let pageStatus = { run: false, gate: 'none', reason: '', count: 0, override: undefined };

  function getOverride(host) {
    return new Promise((resolve) => {
      chrome.storage.local.get('siteOverrides', ({ siteOverrides }) => {
        resolve((siteOverrides || {})[host]);
      });
    });
  }

  function countUnderlines() {
    return document.querySelectorAll('.bp-number').length;
  }

  // Run detection after the DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  async function init() {
    const verdict = BallparkGates.evaluatePage(document);
    const override = await getOverride(location.hostname);
    const decision = BallparkGates.applyOverride(verdict, override);
    pageStatus = { ...decision, count: 0, override };

    registerStatusListener(); // always — so the panel can report, even when gated off

    if (!decision.run) return; // gated off: no scan, no observer, no listeners

    scan();
    pageStatus.count = countUnderlines();
    observeMutations();
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') BallparkCard.hide();
    });
  }

  // The popup asks the active tab for its status.
  function registerStatusListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === 'GET_STATUS') {
        sendResponse(pageStatus);
        return true;
      }
      return false;
    });
  }

  // Underline numbers in the current DOM. Idempotent: the detector skips any
  // node already inside a .bp-number span, so re-running never double-wraps.
  function scan() {
    BallparkDetector.underlineAll(document.body);
  }

  // Many news sites server-render the article, then React hydrates and
  // re-renders the subtree — discarding the spans we injected at document_idle,
  // so nothing stays underlined. Others inject the body after idle or swap it on
  // client-side navigation. A debounced observer re-applies underlines once the
  // DOM settles after any of these. We disconnect during our own scan so the
  // spans we add don't retrigger it.
  function observeMutations() {
    observer = new MutationObserver((mutations) => {
      const addedNodes = mutations.some((m) => m.addedNodes && m.addedNodes.length > 0);
      if (!addedNodes) return;
      clearTimeout(rescanTimer);
      rescanTimer = setTimeout(rescan, RESCAN_DEBOUNCE_MS);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function rescan() {
    if (observer) observer.disconnect();
    try {
      scan();
      pageStatus.count = countUnderlines();
    } finally {
      if (observer) observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function handleClick(e) {
    const span = e.target.closest('.bp-number');
    if (!span) return;

    e.preventDefault();
    e.stopPropagation();

    const numberText = span.textContent;
    const context = span.dataset.context || '';

    BallparkCard.show(numberText, span);

    try {
      chrome.runtime.sendMessage(
        {
          type: 'CALIBRATE',
          payload: {
            number: numberText,
            context,
            pageTitle: document.title,
            pageUrl: location.href,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            BallparkCard.error('Extension error: ' + chrome.runtime.lastError.message);
            return;
          }
          if (!response) {
            BallparkCard.error('No response from background worker.');
            return;
          }
          if (!response.success) {
            BallparkCard.error(response.error || 'Unknown error.');
            return;
          }
          if (response.data && response.data.insufficient) {
            BallparkCard.note(response.data.message);
            return;
          }
          BallparkCard.fill(response.data);
        }
      );
    } catch (err) {
      // sendMessage throws synchronously with "Extension context invalidated"
      // when Ballpark was reloaded/updated while this now-orphaned content
      // script is still running on the page. A page reload re-injects it.
      BallparkCard.error('Ballpark was updated — reload this page to use it.');
    }
  }
})();
