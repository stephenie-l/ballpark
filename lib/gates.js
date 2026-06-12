// gates.js — page-level run/suppress decision (Gates 1 & 2).
// Classic content script: no imports, exposes a global on window. Loads in the
// same world as detector.js.
//
// STUB (Spec 1): ships only the contract shape. evaluatePage() returns a
// permissive default — run everywhere, no gate responsible — identical to
// today's behavior. Spec 2 implements the real Gate 1 / Gate 2 logic here, and
// the decision-accuracy corpus (test/gates.test.js) is written against this
// contract and sits `todo` for the suppress cases until then.

(function () {
  'use strict';

  // evaluatePage(document) -> { run, gate, reason }
  //   run    — should Ballpark underline numbers on this page at all?
  //   gate   — stable machine id of the responsible gate (asserted by tests):
  //            'gate1-communication' | 'gate1-sensitive' | 'gate2-commerce' |
  //            'none'.
  //   reason — human-readable text for the Spec 2 status panel.
  function evaluatePage(_document) {
    return { run: true, gate: 'none', reason: '' };
  }

  window.BallparkGates = { evaluatePage };
})();
