// gates.js — page-level run/suppress decision (Gate 1).
// Classic content script: no imports, exposes window.BallparkGates. Loads in
// the same world as detector.js. evaluatePage is PURE (document in, decision
// out) so it's testable in jsdom; overrides + storage live in content.js.

(function () {
  'use strict';

  // --- Gate 1b heuristic thresholds (tuned against the Tier 3 corpus) ---
  const PROSE_RATIO_RUN = 0.4;        // region runs if >= this share of text is in <p>
  const CONTROL_MIN = 5;              // need this many controls before "interface" fires
  const CONTROL_TO_PROSE = 2;         // controls outnumber <p> by this factor -> interface
  const EDITABLE_MAX_PROSE_BLOCKS = 2; // editable region with <= this many <p> = authoring

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
  // Returns the gate id string (e.g. 'gate1-sensitive') or null.
  function matchHostList(host) {
    if (!host) return null;
    for (const cluster of HOST_LIST) {
      for (const d of cluster.domains) {
        if (host === d || host.endsWith('.' + d)) {
          return cluster.gate;
        }
      }
    }
    return null;
  }

  function suppress(gate) {
    return { run: false, gate, reason: REASONS[gate] };
  }

  // The dominant content region we measure (not the whole doc — peripheral
  // chrome shouldn't sway the decision).
  function dominantRegion(doc) {
    return doc.querySelector('main, [role="main"], article') || doc.body;
  }

  // Whitespace-normalized length — HTML indentation must not skew the ratio.
  function textLen(s) {
    return s.replace(/\s+/g, ' ').trim().length;
  }

  function proseBlockCount(region) {
    return region.querySelectorAll('p').length;
  }

  function proseChars(region) {
    let n = 0;
    for (const p of region.querySelectorAll('p')) n += textLen(p.textContent);
    return n;
  }

  function controlCount(region) {
    return region.querySelectorAll(
      'button, [role="button"], input, select, textarea'
    ).length;
  }

  function isEditableEl(el) {
    return !!el.matches && el.matches('[contenteditable=""], [contenteditable="true"]');
  }

  // Dominant region is an authoring surface: the region itself is editable, or
  // it holds a contenteditable element and almost no article prose (so a comment
  // box under a real article doesn't trip it). Textareas alone are NOT enough —
  // a form or API console with a textarea routes through the control-density check.
  function hasDominantEditable(region) {
    if (isEditableEl(region)) return true;
    const editable = region.querySelector(
      '[contenteditable=""], [contenteditable="true"]'
    );
    return !!editable && proseBlockCount(region) <= EDITABLE_MAX_PROSE_BLOCKS;
  }

  // evaluatePage(document) -> { run, gate, reason }
  function evaluatePage(doc) {
    const host = (doc.location && doc.location.hostname) || '';

    const listedGate = matchHostList(host);
    if (listedGate) return suppress(listedGate);

    const region = dominantRegion(doc);

    // Near-decisive: authoring surface.
    if (hasDominantEditable(region)) return suppress('gate1-editable');

    // Controls dominate -> app/dashboard/console.
    const controls = controlCount(region);
    const pBlocks = proseBlockCount(region);
    if (controls >= CONTROL_MIN && controls > pBlocks * CONTROL_TO_PROSE) {
      return suppress('gate1-interface');
    }

    // Prose density carries the app-vs-article band; ambiguous defaults to suppress.
    const total = textLen(region.textContent);
    const ratio = total > 0 ? proseChars(region) / total : 0;
    if (ratio >= PROSE_RATIO_RUN) return { run: true, gate: 'none', reason: '' };

    return suppress('gate1-interface');
  }

  window.BallparkGates = { evaluatePage };
})();
