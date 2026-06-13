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
    'gate2-commerce': 'Looks like a shopping, listing, or booking page',
    'override-on': 'You turned Ballpark on for this site',
    'override-off': 'You turned Ballpark off for this site',
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

  // NOTE (tuning candidate): prose is measured by <p> only. This is deliberately
  // conservative — sites that build paragraphs from <div> (Medium, Substack, some
  // React/CMS news) will read as low-prose and get suppressed, recoverable via the
  // per-site override. Broadening this (e.g. counting non-chrome text) is a known
  // option to validate against real run results before loosening; it has
  // corpus-wide effects (e.g. it flips the real-estate soft case to "run").
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

  // --- Gate 2: page-type / commerce-archetype detection ---
  // Document-like pages whose archetype makes their numbers transactional or
  // comparative (shopping, listings, travel, menus). Detected from structured
  // data the page already ships for SEO, plus a small hostname net for
  // real-estate SPAs that don't. Per-site override recovers any miss.

  const COMMERCE_TYPES = new Set([
    'Product', 'ProductGroup', 'IndividualProduct', 'Offer', 'AggregateOffer',
    'Hotel', 'LodgingBusiness', 'Resort', 'Motel', 'BedAndBreakfast',
    'Flight', 'FlightReservation', 'LodgingReservation', 'TripReservation',
    'Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'Menu', 'MenuItem',
    'RealEstateListing', 'Residence', 'Apartment', 'ApartmentComplex',
    'SingleFamilyResidence', 'House', 'Vehicle', 'Car',
  ]);

  // An explicit "this is an article" declaration overrides commerce signals
  // (a news review that quotes a price still runs).
  const ARTICLE_TYPES = new Set([
    'Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle',
    'TechArticle', 'OpinionNewsArticle', 'ReviewNewsArticle',
  ]);

  // Real-estate SPAs whose listings often ship no usable markup. Small,
  // override-recoverable net; domain-suffix match.
  const COMMERCE_HOSTS = [
    'zillow.com', 'apartments.com', 'apartmentlist.com', 'redfin.com',
    'trulia.com', 'realtor.com', 'hotpads.com',
  ];

  function matchCommerceHost(host) {
    return COMMERCE_HOSTS.some((d) => host === d || host.endsWith('.' + d));
  }

  // Strip a schema.org URL/prefix to the bare type name (e.g.
  // "https://schema.org/Product" -> "Product").
  function bareType(t) {
    return String(t)
      .replace(/^https?:\/\/schema\.org\//i, '')
      .replace(/\/$/, '')
      .split('/')
      .pop();
  }

  // All top-level @type names across the page's JSON-LD blocks. Handles a bare
  // object, an array of objects, or an @graph; @type may be string or array.
  function jsonLdTypes(doc) {
    const out = [];
    for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(el.textContent); } catch (e) { continue; }
      const nodes = Array.isArray(data)
        ? data
        : data && Array.isArray(data['@graph'])
        ? data['@graph']
        : data
        ? [data]
        : [];
      for (const node of nodes) {
        const t = node && node['@type'];
        if (typeof t === 'string') out.push(bareType(t));
        else if (Array.isArray(t)) for (const x of t) out.push(bareType(x));
      }
    }
    return out;
  }

  function ogType(doc) {
    const m = doc.querySelector('meta[property="og:type"]');
    return m ? (m.getAttribute('content') || '').trim().toLowerCase() : '';
  }

  function hasCommerceMicrodata(doc) {
    for (const el of doc.querySelectorAll('[itemscope][itemtype]')) {
      if (COMMERCE_TYPES.has(bareType(el.getAttribute('itemtype') || ''))) return true;
    }
    return false;
  }

  // Page-level: is this a commerce/transactional archetype?
  function isCommercePage(doc) {
    const host = (doc.location && doc.location.hostname) || '';
    const og = ogType(doc);
    const ldTypes = jsonLdTypes(doc);

    // Article guard wins — an explicit informational page never suppresses here.
    // Prefix match catches OGP subtypes like "article.section".
    if (og.indexOf('article') === 0 || ldTypes.some((t) => ARTICLE_TYPES.has(t))) return false;

    if (matchCommerceHost(host)) return true;
    if (og.indexOf('product') === 0) return true;
    if (ldTypes.some((t) => COMMERCE_TYPES.has(t))) return true;
    if (hasCommerceMicrodata(doc)) return true;
    return false;
  }

  // evaluatePage(document) -> { run, gate, reason }
  function evaluatePage(doc) {
    const host = (doc.location && doc.location.hostname) || '';

    const listedGate = matchHostList(host);
    if (listedGate) return suppress(listedGate);

    // Gate 2: commerce/transactional page archetype (before the Gate 1
    // heuristics, so prose-rich commerce is caught and attributed correctly).
    if (isCommercePage(doc)) return suppress('gate2-commerce');

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

  // Per-site override wins over the gate verdict, in both directions.
  // override: 'force-on' | 'force-off' | undefined
  function applyOverride(verdict, override) {
    if (override === 'force-on') {
      return { run: true, gate: 'override-on', reason: REASONS['override-on'] };
    }
    if (override === 'force-off') {
      return { run: false, gate: 'override-off', reason: REASONS['override-off'] };
    }
    return verdict;
  }

  window.BallparkGates = { evaluatePage, applyOverride };
})();
