// status.js — pure helpers for the popup's "This page" panel. Classic IIFE on
// window (popup-only; not a content script). No DOM/chrome access here — just
// turns a pageStatus object into display strings and the next override action,
// so the logic is unit-testable.

(function () {
  'use strict';

  // status: { run, gate, reason, override } from the active tab's content script,
  // or null if no content script answered (a restricted page).
  function formatStatus(status) {
    if (!status) {
      return {
        line: "Ballpark isn't active on this page",
        detail: "This is a browser or Web Store page where extensions can't run.",
      };
    }
    const overridden =
      status.override === 'force-on' || status.override === 'force-off';
    if (status.run) {
      return {
        line: '✓ Ballpark is on for this page',
        detail: overridden ? 'You turned it on for this site.' : '',
      };
    }
    return {
      line: '⏸ Ballpark is off here',
      detail: overridden ? 'You turned it off for this site.' : status.reason || '',
    };
  }

  // Which override button to show: turn on, turn off, reset, or none.
  function nextOverrideAction(status) {
    if (!status) return null;
    if (status.override === 'force-on' || status.override === 'force-off') {
      return 'reset';
    }
    return status.run ? 'force-off' : 'force-on';
  }

  // Calibration-engine toggle state for the popup. Mirrors resolveProvider's
  // rule (anthropic only when it's selected AND a key exists) so the popup can't
  // show a state the dispatcher won't honor. keyEnabled gates the API-key side.
  function engineState({ apiKey, activeProvider } = {}) {
    const keyEnabled = !!apiKey;
    const active = activeProvider === 'anthropic' && keyEnabled ? 'anthropic' : 'nano';
    return { active, keyEnabled };
  }

  window.BallparkStatus = { formatStatus, nextOverrideAction, engineState };
})();
