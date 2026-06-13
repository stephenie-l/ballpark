// gates.js — page-level run/suppress decision (Gate 1).
// Classic content script: no imports, exposes window.BallparkGates. Loads in
// the same world as detector.js. evaluatePage is PURE (document in, decision
// out) so it's testable in jsdom; overrides + storage live in content.js.

(function () {
  'use strict';

  // --- Reason strings (human text shown in the status panel) ---
  const REASONS = {
    'gate1-communication': 'Looks like a messaging or email surface',
    'gate1-sensitive': 'Looks like a private account (banking, health, etc.)',
    'gate1-editable': "You're composing or editing on this page",
    'gate1-interface': 'Looks like an app or dashboard, not an article',
  };

  // --- Gate 1a: hardcoded hostname list (safety net, checked first) ---
  // Short and high-stakes only; heuristics carry everything not named here.
  const HOST_LIST = [
    // Communication cluster
    { gate: 'gate1-communication', domains: [
      'mail.google.com', 'outlook.live.com', 'outlook.office.com',
      'outlook.office365.com', 'mail.proton.me', 'slack.com',
      'teams.microsoft.com', 'discord.com', 'web.whatsapp.com', 'messenger.com',
    ] },
    // Sensitive-account cluster
    { gate: 'gate1-sensitive', domains: [
      'chase.com', 'bankofamerica.com', 'wellsfargo.com', 'citi.com',
      'capitalone.com', 'usbank.com', 'pnc.com',
      'fidelity.com', 'vanguard.com', 'schwab.com',
      'myuhc.com', 'anthem.com', 'mychart.com',
      'irs.gov', 'ssa.gov', 'uscis.gov',
    ] },
  ];

  // Domain-suffix match: host === domain or host ends with '.' + domain.
  function matchHostList(host) {
    if (!host) return null;
    for (const cluster of HOST_LIST) {
      for (const d of cluster.domains) {
        if (host === d || host.endsWith('.' + d)) {
          return { gate: cluster.gate, reason: REASONS[cluster.gate] };
        }
      }
    }
    return null;
  }

  function suppress(gate) {
    return { run: false, gate, reason: REASONS[gate] };
  }

  // evaluatePage(document) -> { run, gate, reason }
  function evaluatePage(doc) {
    const host = (doc.location && doc.location.hostname) || '';

    const listed = matchHostList(host);
    if (listed) return { run: false, gate: listed.gate, reason: listed.reason };

    // Heuristics arrive in the next task; until then, non-listed hosts run.
    return { run: true, gate: 'none', reason: '' };
  }

  window.BallparkGates = { evaluatePage };
})();
