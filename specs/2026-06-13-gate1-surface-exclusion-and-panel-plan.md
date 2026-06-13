# Gate 1 + Status/Override Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lib/gates.js` actually gate the extension — implement Gate 1 (surface exclusion: hostname list + 3 heuristics), a per-site override layer, a status/override panel in the popup, and the runtime wiring — so Ballpark stays silent on inboxes, private-account pages, and app-like working surfaces (Salesforce, dashboards, admin tools).

**Architecture:** `evaluatePage(document) → {run, gate, reason}` stays a **pure** heuristic decision (Tier-3 testable in jsdom). A separate pure `applyOverride(verdict, override)` layers per-site overrides. `content.js` reads the override from `chrome.storage` (async), combines, and gates scanning; it records a `pageStatus` and answers `GET_STATUS` so the popup panel can report run/suppress + why. Thresholds are named constants tuned against the Tier 3 corpus.

**Tech Stack:** Vanilla JS (classic content-script IIFEs on `window`; ES-module-free), `node --test` + `jsdom`, `chrome.storage.local` / `chrome.tabs` / `chrome.runtime` messaging. No new manifest permissions.

**Spec:** `specs/2026-06-13-gate1-surface-exclusion-and-panel.md`

---

## File Structure

| File | Responsibility | Created/Modified |
|------|----------------|------------------|
| `lib/gates.js` | Gate 1 decision (`evaluatePage`) + `applyOverride` | Modify (fill stub) |
| `lib/status.js` | Pure panel helpers `formatStatus`, `nextOverrideAction` (IIFE on `window`, popup-only) | Create |
| `content.js` | Async gating in `init()`; override storage; `pageStatus` + `GET_STATUS` listener | Modify |
| `popup.html` / `popup.css` / `popup.js` | "This page" status section + override toggle | Modify |
| `manifest.json` | Add `lib/gates.js` to content scripts; `version` → 1.1.0 | Modify |
| `test/gates.test.js` | Flip `pending` cases; add list + heuristic assertions; `applyOverride` tests | Modify |
| `test/status.test.js` | Unit tests for `formatStatus` / `nextOverrideAction` | Create |
| `test/fixtures/pages/*.html` + `page-labels.json` | New Gate 1 fixtures; `url` field | Modify |
| `eval/decision-eval.mjs` | Pass `url` to JSDOM | Modify |
| `CLAUDE.md` | Allowlist 16→18; Gate 1 + panel docs | Modify |

**Gate 1 tuning constants** (top of `lib/gates.js`, all corpus-tuned):

| Const | Start | Meaning |
|---|---|---|
| `PROSE_RATIO_RUN` | `0.4` | region runs if ≥40% of its text is inside `<p>` blocks |
| `CONTROL_MIN` | `5` | need ≥ this many controls before "interface" can fire |
| `CONTROL_TO_PROSE` | `2` | controls outnumber `<p>` blocks by this factor → interface |
| `EDITABLE_MAX_PROSE_BLOCKS` | `2` | an editable region with ≤ this many `<p>` is an authoring surface |

---

## Task 1: Tier 3 harness — `url` support (prerequisite)

Gate 1's hostname list reads `document.location.hostname`, which jsdom only populates if the DOM was created with a `url`. Add an optional `url` per label and thread it through both harnesses. No gate behavior changes yet (stub still runs everything), so the suite stays green.

**Files:**
- Modify: `test/gates.test.js`
- Modify: `eval/decision-eval.mjs`
- Modify: `test/fixtures/page-labels.json`

- [ ] **Step 1: Make `loadFixture` honor a per-call url**

In `test/gates.test.js`, change `loadFixture` to accept an options bag and pass `url` to JSDOM. Replace the existing `loadFixture` function with:

```js
function loadFixture(file, { url } = {}) {
  const html = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
  const opts = { runScripts: 'outside-only' };
  if (url) opts.url = url;
  const dom = new JSDOM(html, opts);
  dom.window.eval(GATES_SRC);
  dom.window.eval(DETECTOR_SRC);
  return dom.window;
}
```

- [ ] **Step 2: Pass each label's url through the page-decision loop**

In `test/gates.test.js`, in the page-level loop, change the `loadFixture(c.file)` call to forward the label url:

```js
    const window = loadFixture(c.file, { url: c.url });
```

(Leave the number-level loop as `loadFixture(c.file)` — those fixtures don't need a host.)

- [ ] **Step 3: Thread url into the decision eval**

In `eval/decision-eval.mjs`, replace `evaluatePage(html)` with a version that takes the label's url. Change the function to:

```js
function evaluatePage(html, url) {
  const opts = { runScripts: 'outside-only' };
  if (url) opts.url = url;
  const dom = new JSDOM(html, opts);
  dom.window.eval(GATES_SRC);
  return dom.window.BallparkGates.evaluatePage(dom.window.document);
}
```

And at its call site in the loop, change `const result = evaluatePage(html);` to:

```js
    const result = evaluatePage(html, c.url);
```

- [ ] **Step 4: Run the suite + eval to confirm no regression**

Run: `npm test`
Expected: still `19 pass / 0 fail / 2 todo` (no labels have `url` yet, so behavior is unchanged).

Run: `npm run eval:decisions`
Expected: same 2-case report as before, exits cleanly.

- [ ] **Step 5: Commit**

```bash
git add test/gates.test.js eval/decision-eval.mjs
git commit -m "$(cat <<'EOF'
Tier 3: thread optional fixture url through harnesses

Gate 1's hostname list needs document.location; jsdom only sets it from
a url. No behavior change yet (no labels carry url).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Gate 1 — hardcoded hostname list

Implement the host list and a list-only `evaluatePage` (non-listed hosts still run, permissively — heuristics arrive in Task 3). Flip the two seed suppress fixtures to list-based by giving them real hosts and removing `pending`.

**Files:**
- Modify: `lib/gates.js`
- Modify: `test/fixtures/page-labels.json`
- Modify: `test/gates.test.js`

- [ ] **Step 1: Give the bank + webmail fixtures hosts and un-`pending` them**

In `test/fixtures/page-labels.json`, update the two suppress entries to add a `url` and drop `pending`:

```json
  {
    "file": "bank-dashboard.html",
    "tier": "hard",
    "url": "https://www.chase.com/personal/checking",
    "page": { "expected": "suppress", "gate": "gate1-sensitive" }
  },
  {
    "file": "webmail-inbox.html",
    "tier": "hard",
    "url": "https://mail.google.com/mail/u/0/",
    "page": { "expected": "suppress", "gate": "gate1-communication" }
  }
```

- [ ] **Step 2: Run the suite to verify these now FAIL (no longer todo)**

Run: `npm test`
Expected: 2 FAIL — `page decision: bank-dashboard.html` and `webmail-inbox.html` now fail for real (stub returns `run:true, gate:'none'`; labels expect suppress). This is the red of TDD; the `pending` flags are gone so they count as hard failures now.

- [ ] **Step 3: Implement the host list in `lib/gates.js`**

Replace the entire body of `lib/gates.js` with (this keeps the IIFE + `window.BallparkGates` shape, adds the list, and keeps non-listed hosts running for now):

```js
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
```

- [ ] **Step 4: Run the suite to verify the list cases pass**

Run: `npm test`
Expected: green again — `bank-dashboard` (matches `chase.com` → `gate1-sensitive`) and `webmail-inbox` (matches `mail.google.com` → `gate1-communication`) now pass; `article-prose` (no url → no list match → runs) still passes; contract + detector tests still pass. `0 fail, 0 todo`.

- [ ] **Step 5: Add an explicit list-behavior unit test**

In `test/gates.test.js`, after the existing contract test, add a focused test so the matcher is covered directly (not only via fixtures):

```js
test('hardcoded host list: suffix match and miss', () => {
  const listed = (host) => {
    const dom = new JSDOM('<!DOCTYPE html><body><p>hi</p></body>', {
      runScripts: 'outside-only', url: `https://${host}/`,
    });
    dom.window.eval(GATES_SRC);
    return dom.window.BallparkGates.evaluatePage(dom.window.document);
  };
  assert.equal(listed('mail.google.com').gate, 'gate1-communication');
  assert.equal(listed('secure.chase.com').gate, 'gate1-sensitive'); // subdomain
  assert.equal(listed('example.com').run, true); // not listed → runs (for now)
});
```

Run: `npm test`
Expected: PASS (the new test + everything else).

- [ ] **Step 6: Commit**

```bash
git add lib/gates.js test/gates.test.js test/fixtures/page-labels.json
git commit -m "$(cat <<'EOF'
Gate 1a: hardcoded hostname list (communication + sensitive)

evaluatePage now suppresses listed hosts by domain-suffix match. Bank +
webmail seed fixtures flip from todo to real gating tests. Non-listed
hosts still run; heuristics next.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Gate 1 — heuristics + combination funnel

Add the three heuristic signals and the funnel for non-listed hosts. Add fixtures (arbitrary hostnames) that exercise each signal, plus one informational-but-table-heavy article that must keep running.

**Files:**
- Modify: `lib/gates.js`
- Create: `test/fixtures/pages/app-editable.html`
- Create: `test/fixtures/pages/dashboard-controls.html`
- Create: `test/fixtures/pages/api-console.html`
- Create: `test/fixtures/pages/econ-article-tables.html`
- Modify: `test/fixtures/page-labels.json`

- [ ] **Step 1: Create the four heuristic fixtures**

`test/fixtures/pages/app-editable.html` (dominant editable region → `gate1-editable`):

```html
<!DOCTYPE html>
<!-- signal: authoring surface; dominant content region is contenteditable (Notion/Docs-like) -->
<html lang="en">
<head><meta charset="UTF-8" /><title>Untitled — Notes</title></head>
<body>
  <main>
    <div contenteditable="true">
      <h1>Q3 planning</h1>
      Budget is around $40,000 this quarter and headcount grows by 12.
    </div>
  </main>
</body>
</html>
```

`test/fixtures/pages/dashboard-controls.html` (controls dominate, little prose → `gate1-interface`):

```html
<!DOCTYPE html>
<!-- signal: admin/CRM dashboard; data text but control-dominated main region (Salesforce-like) -->
<html lang="en">
<head><meta charset="UTF-8" /><title>Opportunities — Console</title></head>
<body>
  <main>
    <h1>Opportunities</h1>
    <button>New</button><button>Import</button><button>Export</button>
    <select><option>All</option></select>
    <input type="search" placeholder="Filter" />
    <button>Apply</button><button>Reset</button>
    <table>
      <thead><tr><th>Name</th><th>Amount</th><th>Stage</th></tr></thead>
      <tbody>
        <tr><td>Acme</td><td>$45,000</td><td>Won</td></tr>
        <tr><td>Globex</td><td>$120,000</td><td>Prospecting</td></tr>
      </tbody>
    </table>
  </main>
</body>
</html>
```

`test/fixtures/pages/api-console.html` (form controls dominate → `gate1-interface`):

```html
<!DOCTYPE html>
<!-- signal: API console / internal tool; inputs + buttons dominate, minimal prose -->
<html lang="en">
<head><meta charset="UTF-8" /><title>API Console</title></head>
<body>
  <main>
    <h1>Send request</h1>
    <select><option>GET</option><option>POST</option></select>
    <input type="text" value="https://api.example.com/v1/users" />
    <input type="text" placeholder="Authorization" />
    <textarea>{ "limit": 50 }</textarea>
    <button>Send</button><button>Save</button><button>Copy</button>
  </main>
</body>
</html>
```

`test/fixtures/pages/econ-article-tables.html` (table-heavy but informational → **runs**):

```html
<!DOCTYPE html>
<!-- signal: informational article with a data table; must KEEP running despite the table -->
<html lang="en">
<head><meta charset="UTF-8" /><title>Inflation cooled in May</title></head>
<body>
  <main>
    <article>
      <h1>Inflation cooled in May</h1>
      <p>
        Consumer prices rose 3.1% over the year through May, down from 3.4% in
        April, as energy costs fell and goods prices flattened. Economists had
        expected a reading near 3.2%, so the figure landed broadly in line with
        forecasts and reinforced expectations of a rate cut later this year.
      </p>
      <p>
        Core inflation, which strips out food and energy, held at 3.6%. Shelter
        costs remained the largest single contributor, accounting for more than
        half of the monthly increase, while used-car prices continued to ease.
      </p>
      <table>
        <thead><tr><th>Category</th><th>YoY</th></tr></thead>
        <tbody>
          <tr><td>Energy</td><td>-2.1%</td></tr>
          <tr><td>Food</td><td>2.9%</td></tr>
          <tr><td>Shelter</td><td>5.4%</td></tr>
        </tbody>
      </table>
    </article>
  </main>
</body>
</html>
```

- [ ] **Step 2: Add labels for the four fixtures**

In `test/fixtures/page-labels.json`, add these four `hard` entries (mind the trailing comma on the prior last entry so the array stays valid):

```json
  {
    "file": "app-editable.html",
    "tier": "hard",
    "url": "https://notes.example.com/doc/123",
    "page": { "expected": "suppress", "gate": "gate1-editable" }
  },
  {
    "file": "dashboard-controls.html",
    "tier": "hard",
    "url": "https://crm.example.com/opportunities",
    "page": { "expected": "suppress", "gate": "gate1-interface" }
  },
  {
    "file": "api-console.html",
    "tier": "hard",
    "url": "https://tools.example.com/console",
    "page": { "expected": "suppress", "gate": "gate1-interface" }
  },
  {
    "file": "econ-article-tables.html",
    "tier": "hard",
    "url": "https://news.example.com/inflation-may",
    "page": { "expected": "run", "gate": "none" },
    "numbers": [
      { "text": "3.1%", "expected": "underline" }
    ]
  }
```

- [ ] **Step 3: Run the suite to verify the heuristic cases FAIL**

Run: `npm test`
Expected: the 3 suppress fixtures FAIL (stub still runs non-listed hosts) and `econ-article-tables` page-decision PASSES (stub runs, label expects run). The `econ` number-decision passes too (`3.1%` underlines today). The 3 failures are the TDD red for this task.

- [ ] **Step 4: Implement the heuristics + funnel in `lib/gates.js`**

In `lib/gates.js`, add the tuning constants and helper functions, and replace the `evaluatePage` body's "heuristics arrive next task" fallthrough. Insert the constants just after `'use strict';`:

```js
  // --- Gate 1b heuristic thresholds (tuned against the Tier 3 corpus) ---
  const PROSE_RATIO_RUN = 0.4;        // region runs if >= this share of text is in <p>
  const CONTROL_MIN = 5;              // need this many controls before "interface" fires
  const CONTROL_TO_PROSE = 2;         // controls outnumber <p> by this factor -> interface
  const EDITABLE_MAX_PROSE_BLOCKS = 2; // editable region with <= this many <p> = authoring
```

Add these helpers above `evaluatePage`:

```js
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
  // it holds an editable/textarea and almost no article prose (so a comment box
  // under a real article doesn't trip it).
  function hasDominantEditable(region) {
    if (isEditableEl(region)) return true;
    const editable = region.querySelector(
      '[contenteditable=""], [contenteditable="true"], textarea'
    );
    return !!editable && proseBlockCount(region) <= EDITABLE_MAX_PROSE_BLOCKS;
  }
```

Then replace the `evaluatePage` fallthrough so the full funnel reads:

```js
  function evaluatePage(doc) {
    const host = (doc.location && doc.location.hostname) || '';

    const listed = matchHostList(host);
    if (listed) return { run: false, gate: listed.gate, reason: listed.reason };

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
```

- [ ] **Step 5: Run the suite to verify all hard cases pass**

Run: `npm test`
Expected: green. `app-editable` → `gate1-editable`; `dashboard-controls` + `api-console` → `gate1-interface` (≥5 controls, ≤ a couple `<p>`); `econ-article-tables` → runs (prose ratio ≥0.4 from its two real paragraphs); `article-prose` still runs; bank/webmail still suppress via the list. `0 fail`.

> If a hard fixture lands on the wrong side, do NOT loosen a threshold to force it — hard cases must be unambiguous. Either make the fixture clearly cross the threshold (it's synthetic) or, if the case is genuinely borderline, move it to the soft corpus (`tier: "soft"`). Flag the call if unsure.

- [ ] **Step 6: Run the decision eval to see the new baseline**

Run: `npm run eval:decisions`
Expected: prints without throwing. Note: `real-estate-listing` may now flip from FP to `ok` — Gate 1's low-prose heuristic incidentally catches sparse commerce pages; Gate 2 (Spec 3) handles prose-rich product pages. Either way the report is informational here.

- [ ] **Step 7: Commit**

```bash
git add lib/gates.js test/fixtures
git commit -m "$(cat <<'EOF'
Gate 1b: editability + control-density + prose-density heuristics

Non-listed hosts now run through the funnel: dominant-region editability
(near-decisive), control density (Salesforce/dashboard/console), then
prose-density band with default-to-suppress. Adds 4 signal fixtures.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Override layer — `applyOverride`

Pure function in `gates.js` that lets a per-site override win over the gate verdict, both directions.

**Files:**
- Modify: `lib/gates.js`
- Modify: `test/gates.test.js`

- [ ] **Step 1: Write the failing test**

In `test/gates.test.js`, after the host-list test, add (load the IIFE once and exercise `applyOverride`):

```js
test('applyOverride: force-on/off win, undefined passes through', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(GATES_SRC);
  const { applyOverride } = dom.window.BallparkGates;

  const verdict = { run: false, gate: 'gate1-interface', reason: 'x' };

  const on = applyOverride(verdict, 'force-on');
  assert.equal(on.run, true);
  assert.equal(on.gate, 'override-on');

  const off = applyOverride({ run: true, gate: 'none', reason: '' }, 'force-off');
  assert.equal(off.run, false);
  assert.equal(off.gate, 'override-off');

  assert.deepEqual(applyOverride(verdict, undefined), verdict); // unchanged
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `applyOverride is not a function` (not exported yet).

- [ ] **Step 3: Implement `applyOverride`**

In `lib/gates.js`, add these reason entries to the `REASONS` object:

```js
    'override-on': 'You turned Ballpark on for this site',
    'override-off': 'You turned Ballpark off for this site',
```

Add the function above the `window.BallparkGates` assignment:

```js
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
```

And export it:

```js
  window.BallparkGates = { evaluatePage, applyOverride };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (the new test + all prior).

- [ ] **Step 5: Commit**

```bash
git add lib/gates.js test/gates.test.js
git commit -m "$(cat <<'EOF'
Add applyOverride: per-site override wins over gate verdict

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Panel pure helpers — `lib/status.js`

Two pure functions that turn a `pageStatus` into display text and decide which override button to show. Popup-only (loaded by `popup.html`, not a content script), tested via the jsdom `window.eval` trick.

**Files:**
- Create: `lib/status.js`
- Create: `test/status.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/status.test.js`:

```js
// Unit tests for lib/status.js (pure popup helpers), loaded as a classic IIFE
// into jsdom — same pattern as gates/detector.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const STATUS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'status.js'), 'utf8'
);

function load() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(STATUS_SRC);
  return dom.window.BallparkStatus;
}

test('formatStatus: ran shows count; suppressed shows reason', () => {
  const { formatStatus } = load();

  const ran = formatStatus({ run: true, gate: 'none', reason: '', count: 12 });
  assert.match(ran.line, /Ran/);
  assert.match(ran.line, /12/);

  const off = formatStatus({ run: false, gate: 'gate1-interface', reason: 'Looks like an app or dashboard, not an article', count: 0 });
  assert.match(off.line, /Didn't run/);
  assert.match(off.detail, /app or dashboard/);
});

test('formatStatus: inactive page', () => {
  const { formatStatus } = load();
  const none = formatStatus(null); // no content script responded
  assert.match(none.line, /isn't active/);
});

test('nextOverrideAction: contextual button + reset', () => {
  const { nextOverrideAction } = load();
  // running by gate -> offer to turn off
  assert.equal(nextOverrideAction({ run: true, gate: 'none', override: undefined }), 'force-off');
  // suppressed by gate -> offer to turn on
  assert.equal(nextOverrideAction({ run: false, gate: 'gate1-sensitive', override: undefined }), 'force-on');
  // already overridden -> offer reset
  assert.equal(nextOverrideAction({ run: true, gate: 'override-on', override: 'force-on' }), 'reset');
  // inactive page -> no action
  assert.equal(nextOverrideAction(null), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot read `lib/status.js` (doesn't exist).

- [ ] **Step 3: Implement `lib/status.js`**

Create `lib/status.js`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS (the 3 new status tests + all prior).

- [ ] **Step 5: Commit**

```bash
git add lib/status.js test/status.test.js
git commit -m "$(cat <<'EOF'
Add lib/status.js: pure panel helpers (formatStatus, nextOverrideAction)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: content.js — gating, override storage, status reporting

Wire the pure layers into the runtime: read the per-site override, combine with the gate verdict, gate scanning, and answer `GET_STATUS` for the panel.

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Add override storage helpers + status state**

In `content.js`, inside the IIFE near the top (after the `let rescanTimer` line), add:

```js
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
```

- [ ] **Step 2: Make `init` async and gate on the decision**

Replace the existing `init` function and the readyState bootstrap at the top with:

```js
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
```

- [ ] **Step 3: Keep `pageStatus.count` fresh on rescan**

In `content.js`, in the `rescan` function, update the count after a successful scan. Change the `try { scan(); }` block to:

```js
    try {
      scan();
      pageStatus.count = countUnderlines();
    } finally {
```

- [ ] **Step 4: Verify the suite still passes (no content.js unit tests; sanity only)**

Run: `npm test`
Expected: unchanged green — `content.js` isn't loaded by the test suite, so this confirms nothing else broke.

> `content.js` runtime behavior is verified manually in Task 8 (load unpacked). There is no jsdom harness for it because it depends on `chrome.*` APIs; the gate/override logic it calls is already unit-tested.

- [ ] **Step 5: Commit**

```bash
git add content.js
git commit -m "$(cat <<'EOF'
content.js: gate scanning on the page decision + report status

init() now evaluates the gate, applies the per-site override from
storage, skips scan/observe when suppressed, and answers GET_STATUS so
the popup panel can show run/suppress + why.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Panel UI in the popup + manifest wiring

Add the "This page" section to the popup, wire it to the active tab, and register `gates.js` in the manifest with a version bump.

**Files:**
- Modify: `manifest.json`
- Modify: `popup.html`
- Modify: `popup.css`
- Modify: `popup.js`

- [ ] **Step 1: Register gates.js + bump version in manifest**

In `manifest.json`, change the content-scripts `js` array to load `gates.js` before `content.js`:

```json
      "js": ["lib/detector.js", "lib/card.js", "lib/gates.js", "content.js"],
```

And bump the version:

```json
  "version": "1.1.0",
```

- [ ] **Step 2: Add the status section + status.js to popup.html**

In `popup.html`, add the status section as the first child of `.container` (above the API-key `<section>`), and load `status.js` before `popup.js`. Insert after `<div class="container">`:

```html
    <section class="section section--status" id="status-section">
      <p class="status-line" id="status-line">Checking this page…</p>
      <p class="hint status-detail" id="status-detail"></p>
      <button class="override-btn" id="override-btn" hidden></button>
    </section>
```

And change the script tag at the bottom from `<script src="popup.js"></script>` to:

```html
  <script src="lib/status.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 3: Style the status section in popup.css**

In `popup.css`, append:

```css
/* ---- This-page status ---- */

.section--status {
  border-bottom: 1px solid #eaecef;
  padding-bottom: 14px;
}

.status-line {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
}

.status-detail:empty {
  display: none;
}

.override-btn {
  align-self: flex-start;
  margin-top: 4px;
  padding: 5px 10px;
  background: #fff;
  color: #2c5f9e;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.override-btn:hover {
  background: #f3f6fb;
  border-color: #6b8cba;
}
```

- [ ] **Step 4: Wire the panel in popup.js**

In `popup.js`, append the status-panel logic (it reuses `window.BallparkStatus` loaded just before it):

```js
// ---- This-page status panel ----

const statusLine = document.getElementById('status-line');
const statusDetail = document.getElementById('status-detail');
const overrideBtn = document.getElementById('override-btn');

const OVERRIDE_LABELS = {
  'force-on': 'Run Ballpark on this site',
  'force-off': "Don't run on this site",
  'reset': 'Reset to automatic',
};

let activeTab = null;

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  activeTab = tab;
  if (!tab || !tab.id) return renderStatus(null);
  chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, (status) => {
    // lastError fires when no content script is present (chrome://, web store…).
    if (chrome.runtime.lastError) return renderStatus(null);
    renderStatus(status || null);
  });
});

function renderStatus(status) {
  const { line, detail } = BallparkStatus.formatStatus(status);
  statusLine.textContent = line;
  statusDetail.textContent = detail;

  const action = BallparkStatus.nextOverrideAction(status);
  if (!action) {
    overrideBtn.hidden = true;
    return;
  }
  overrideBtn.hidden = false;
  overrideBtn.textContent = OVERRIDE_LABELS[action];
  overrideBtn.onclick = () => applyOverrideAction(action);
}

function applyOverrideAction(action) {
  if (!activeTab || !activeTab.url) return;
  const host = new URL(activeTab.url).hostname;
  chrome.storage.local.get('siteOverrides', ({ siteOverrides }) => {
    const map = siteOverrides || {};
    if (action === 'reset') delete map[host];
    else map[host] = action; // 'force-on' | 'force-off'
    chrome.storage.local.set({ siteOverrides: map }, () => {
      chrome.tabs.reload(activeTab.id);
      window.close(); // popup closes; reopen shows the new state
    });
  });
}
```

> `popup.js` reading `activeTab.url` needs the tab URL. Reading `tab.url` from `chrome.tabs.query` requires either the `tabs` permission or host access. Verify in Step 5 whether `tab.url` is populated; if it comes back `undefined`, **stop and flag** — do not add the `tabs` permission without checking in (it changes the Web Store review lane). Fallback if needed: have the content script include `location.hostname` in its `GET_STATUS` reply and use that instead of `activeTab.url`.

- [ ] **Step 5: Manual verification (load unpacked)**

Run: `npm test` first (Expected: still green — popup files aren't in the suite).

Then load unpacked and verify by hand:
1. `chrome://extensions` → reload/Load unpacked at repo root.
2. **Article** (e.g. a news page): popup shows "✓ Ran — found N numbers" + "Don't run on this site". Numbers are underlined.
3. **Dashboard/app** (Gmail, or any internal tool): popup shows "⏸ Didn't run" + the reason + "Run Ballpark on this site". No underlines.
4. Click the override on the suppressed page → tab reloads → numbers appear; reopen popup → shows running + "Reset to automatic".
5. **`chrome://extensions`** (no content script): popup shows "Ballpark isn't active on this page", no button.
6. Confirm `tab.url`/host resolved (else apply the fallback from Step 4 and re-verify).

- [ ] **Step 6: Commit**

```bash
git add manifest.json popup.html popup.css popup.js
git commit -m "$(cat <<'EOF'
Add status/override panel to popup; wire gates.js into manifest (v1.1.0)

Popup shows whether Ballpark ran on the active tab and why, with a
per-site override toggle that persists and reloads the tab.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Packaging allowlist + docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the packaging allowlist**

In `CLAUDE.md` (the "Packaging for the Web Store" section), update the `zip` command to include the two new lib files and fix the count. Change the `lib/` line and the verify comment:

```bash
  lib/api.js lib/card.js lib/detector.js lib/gates.js lib/status.js \
```

and

```bash
unzip -l ballpark.zip   # verify: exactly these 18 files, no .DS_Store
```

Also update the prose "exactly these 16 files" reference in that section to **18**.

- [ ] **Step 2: Document Gate 1 + the panel**

In `CLAUDE.md`, under "Where to make changes", add a bullet:

```markdown
- **Whether Ballpark runs on a page at all (Gate 1):** `lib/gates.js` —
  `evaluatePage(document)` returns `{ run, gate, reason }` via a hardcoded
  hostname list + heuristics (scoped editability, interactive-control density,
  prose density), with thresholds as tuned constants at the top of the file. The
  per-site override (`applyOverride`) is layered in `content.js` from
  `chrome.storage.local`'s `siteOverrides`. The popup's "This page" panel
  (`lib/status.js` + `popup.js`) reports the decision and exposes the override.
  Decision accuracy is guarded by Tier 3 (`test/gates.test.js`).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Docs: packaging allowlist (16->18) + Gate 1 / panel pointers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done-when

- `npm test` green: Gate 1 host-list + heuristic fixtures all assert the right `run`+`gate`; `applyOverride` and `lib/status.js` unit-tested; no `todo` left from the seed suppress cases.
- `npm run eval:decisions` runs clean.
- Loaded unpacked: articles get underlines; Gmail / dashboards / the editable + control fixtures' real-world analogues do not; the override toggle persists per-site and flips behavior on reload; inactive pages report cleanly.
- `manifest.json` is `1.1.0` with `lib/gates.js` in content scripts; **no new permissions**; allowlist in `CLAUDE.md` lists 18 files.

## Out of scope (later specs)

- Gate 2 (commerce page-type detection) → Spec 3.
- Gate 3 (per-number triage) + graceful-failure message + number-level panel detail → Spec 4.
- Live override re-application without reload.
