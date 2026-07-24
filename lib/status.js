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

  // Calibration-engine state for the popup's two-segment picker. Three providers
  // are resolvable (nano/gemini/anthropic), but the popup shows two segments —
  // [ free | Claude ] — because Nano and Gemini are mutually exclusive free engines
  // (by the onboarding flow). Config-only, so it mirrors resolveProvider EXACTLY
  // (the popup must never offer a state the dispatcher won't honor); activeProvider
  // is the source of truth, set correctly at onboarding time (we only select
  // 'gemini' for users who can't run Nano).
  //   active: Anthropic if selected AND keyed; else Gemini if selected AND keyed;
  //           else Nano.
  //   freeEngine: what the single free segment renders. It IS `active` when a free
  //           engine is active (never mislabel the lit segment); when Claude is
  //           active it's the dormant free label — Gemini if a Gemini key is saved,
  //           else Nano.
  //   enabled: the two independent keys.
  function engineState({ apiKey, geminiApiKey, activeProvider } = {}) {
    const enabled = { anthropic: !!apiKey, gemini: !!geminiApiKey };
    let active;
    if (activeProvider === 'anthropic' && enabled.anthropic) active = 'anthropic';
    else if (activeProvider === 'gemini' && enabled.gemini) active = 'gemini';
    else active = 'nano';
    const freeEngine =
      active === 'gemini' ? 'gemini'
      : active === 'nano' ? 'nano'
      : (enabled.gemini ? 'gemini' : 'nano'); // anthropic active → dormant label
    return { active, freeEngine, enabled };
  }

  // Which onboarding screen a Nano availability() state maps to. Pure, so the
  // welcome page's render dispatch is unit-testable without a browser. Unknown
  // states fall back to the honest 'unavailable' screen.
  function screenForState(state) {
    switch (state) {
      case 'available': return 'ready';
      case 'downloadable': return 'consent';
      case 'downloading': return 'downloading';
      case 'unavailable': return 'unavailable';
      default: return 'unavailable';
    }
  }

  // Copy for the welcome page's failed-download card. `started` = whether any
  // download progress was ever reported. A download that dies before its first
  // byte (e.g. Chrome refuses: not enough disk space) must not claim "your
  // progress is saved" — instead surface the browser's stated reason, which is
  // otherwise console-only and leaves the user with a retry that can never work.
  function failedCopy({ message, started } = {}) {
    return {
      title: started ? "Setup didn't finish" : "Setup couldn't start",
      reason: message ? 'Chrome reports: “' + message + '”' : '',
      sub: started
        ? 'Your progress is saved — try again to pick up where it left off.'
        : message
          ? 'Once that’s sorted out, try again — or use the free cloud version below.'
          : 'Try again in a moment — or use the free cloud version below.',
    };
  }

  // Whether the popup's "Finish setup →" nudge should show: only when the free
  // on-device engine is the active one AND the model isn't ready yet. If the
  // user is on the Anthropic engine, or Nano is already 'available', or its
  // state is unknown, there's nothing to nudge about. nanoState is
  // availability()'s string, or null/undefined if we couldn't read it.
  function nanoNudgeVisible({ apiKey, geminiApiKey, activeProvider, nanoState } = {}) {
    const { active } = engineState({ apiKey, geminiApiKey, activeProvider });
    return active === 'nano' && nanoState != null && nanoState !== 'available';
  }

  window.BallparkStatus = { formatStatus, nextOverrideAction, engineState, screenForState, nanoNudgeVisible, failedCopy };
})();
