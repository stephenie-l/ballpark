// status.js — pure helpers for the popup's "This page" panel. Classic IIFE on
// window (popup-only; not a content script). No DOM/chrome access here — just
// turns a pageStatus object into display strings and the next override action,
// so the logic is unit-testable.

(function () {
  'use strict';

  // status: { run, gate, reason, count, override } from the active tab's content
  // script, or null if no content script answered (inactive page).
  function formatStatus(status) {
    if (!status) {
      return { line: "Ballpark isn't active on this page", detail: '' };
    }
    if (status.run) {
      const n = status.count || 0;
      const noun = n === 1 ? 'number' : 'numbers';
      return { line: `✓ Ran — found ${n} ${noun}`, detail: '' };
    }
    return { line: "⏸ Didn't run", detail: status.reason || '' };
  }

  // Which override button to show: turn on, turn off, reset, or none.
  function nextOverrideAction(status) {
    if (!status) return null;
    if (status.override === 'force-on' || status.override === 'force-off') {
      return 'reset';
    }
    return status.run ? 'force-off' : 'force-on';
  }

  window.BallparkStatus = { formatStatus, nextOverrideAction };
})();
