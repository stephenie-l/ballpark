# Decision-Accuracy Test Layer (Tier 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the framework for Tier 3 — a labeled page corpus plus a deterministic harness that scores the gates' run/suppress and underline/suppress decisions — *before* the gates exist, so Gate work (Specs 2 & 3) can be tuned against it.

**Architecture:** Gate decisions live in content-script land (classic-script IIFEs on `window`), the same world as `lib/detector.js`. Spec 1 ships a permissive **stub** `lib/gates.js` exposing the page-level contract `window.BallparkGates.evaluatePage(document) → { run, gate, reason }`. Two harnesses consume a shared label file: a **gating** test (`test/gates.test.js`, hard corpus, `npm test`) and a **report-only** eval (`eval/decision-eval.mjs`, soft corpus, never throws). Cases whose gate isn't implemented yet are marked `todo`, so the suite stays green until Spec 2 fills the stub in.

**Tech Stack:** Vanilla JS, Node's built-in test runner (`node --test`), `jsdom` (existing dev dependency). No new dependencies. No changes to the shipped extension's runtime (manifest/`content.js` are untouched in Spec 1 — `lib/gates.js` is only loaded by the test harnesses, not by Chrome, until Spec 2 wires it in).

**Spec:** `specs/2026-06-12-decision-accuracy-test-layer.md`

---

## File Structure

| File | Responsibility | Created/Modified |
|------|----------------|------------------|
| `lib/gates.js` | Page-level decision contract; **stub** in Spec 1 | Create |
| `test/fixtures/pages/*.html` | Corpus pages (synthetic seed) | Create |
| `test/fixtures/page-labels.json` | Ground-truth labels keyed by filename | Create |
| `test/gates.test.js` | Part 1 — hard corpus, gating harness | Create |
| `eval/decision-eval.mjs` | Part 2 — soft corpus, report-only harness | Create |
| `package.json` | Add `eval:decisions` script | Modify |
| `CLAUDE.md` | Document Tier 3 in the Testing section | Modify |

**Label schema** (one entry per page; the contract every task shares):

```json
{
  "file": "bank-dashboard.html",
  "tier": "hard",                              // "hard" → Part 1, "soft" → Part 2
  "pending": "spec2",                          // optional: gate not implemented yet → test is `todo`
  "page":   { "expected": "suppress", "gate": "gate1-sensitive" },
  "numbers": [                                 // only when page.expected === "run"
    { "text": "$145B", "expected": "underline" }
  ]
}
```

- `page.expected`: `"run"` | `"suppress"`.
- `page.gate`: stable id the test asserts — `gate1-communication` | `gate1-sensitive` | `gate2-commerce` | `none`.
- `pending`: present until the responsible gate ships; makes the test `todo` (runs but can't fail the suite).
- `numbers[].expected`: `"underline"` | `"suppress"`.

---

## Task 1: Page-level contract stub (`lib/gates.js`)

**Files:**
- Create: `lib/gates.js`
- Test: `test/gates.test.js`

- [ ] **Step 1: Write the failing contract test**

Create `test/gates.test.js`:

```js
// Tier 3, Part 1 — decision-accuracy gating tests for the page-level gates.
//
// lib/gates.js is a classic content script (an IIFE that attaches
// window.BallparkGates). We can't import it, so we load it into jsdom via
// window.eval and call its one export — evaluatePage — exactly as the extension
// will. This file also drives the labeled page corpus (added in Task 2).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const LIB = path.join(__dirname, '..', 'lib');
const GATES_SRC = fs.readFileSync(path.join(LIB, 'gates.js'), 'utf8');

// Evaluate gates.js into a fresh window over the given HTML and return its
// BallparkGates global.
function loadGates(html = '<!DOCTYPE html><body></body>') {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.eval(GATES_SRC);
  return dom.window;
}

test('evaluatePage returns the { run, gate, reason } contract shape', () => {
  const window = loadGates();
  const result = window.BallparkGates.evaluatePage(window.document);
  assert.equal(typeof result.run, 'boolean', 'run must be boolean');
  assert.equal(typeof result.gate, 'string', 'gate must be a string id');
  assert.equal(typeof result.reason, 'string', 'reason must be a string');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot read properties of undefined (reading 'evaluatePage')` (no `lib/gates.js` yet, so `window.BallparkGates` is undefined). Existing `detector.test.js` tests still pass.

- [ ] **Step 3: Write the minimal stub**

Create `lib/gates.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the contract-shape test is green; `detector.test.js` still green.

- [ ] **Step 5: Commit**

```bash
git add lib/gates.js test/gates.test.js
git commit -m "$(cat <<'EOF'
Add page-level gate contract stub (Tier 3 Spec 1)

evaluatePage(document) -> { run, gate, reason }, permissive default.
Real Gate 1/2 logic lands in Spec 2.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Hard corpus + gating harness

Seed the corpus with three doc-sourced archetypes — a prose article (valid **run** target), a bank dashboard (sensitive-account **suppress**), a webmail inbox (communication **suppress**) — and the loop that asserts each. The two suppress pages carry `pending: "spec2"` so they run as `todo` (the stub can't suppress yet) and the suite stays green.

> Sourcing note (per spec): these archetypes come from the handoff doc's Gate 1 clusters, not improvised. Keep the HTML minimal but structurally honest. Each fixture opens with a `<!-- signal: … -->` comment naming what it exercises.

**Files:**
- Create: `test/fixtures/pages/article-prose.html`
- Create: `test/fixtures/pages/bank-dashboard.html`
- Create: `test/fixtures/pages/webmail-inbox.html`
- Create: `test/fixtures/page-labels.json`
- Modify: `test/gates.test.js`

- [ ] **Step 1: Create the run-page fixture**

Create `test/fixtures/pages/article-prose.html`:

```html
<!DOCTYPE html>
<!-- signal: prose reading surface; valid run target -->
<html lang="en">
<head><meta charset="UTF-8" /><title>MegaCorp acquires Initech</title></head>
<body>
  <main>
    <article>
      <h1>MegaCorp to acquire Initech for $145B</h1>
      <p>
        MegaCorp said on Thursday it would acquire Initech in a deal valued at
        $145B, among the largest software acquisitions on record. The combined
        company would employ roughly 40,000 people worldwide.
      </p>
      <p>Analysts said the price reflects a premium over Initech's last round.</p>
    </article>
  </main>
</body>
</html>
```

- [ ] **Step 2: Create the two suppress-page fixtures**

Create `test/fixtures/pages/bank-dashboard.html`:

```html
<!DOCTYPE html>
<!-- signal: authenticated bank account dashboard (sensitive-account cluster) -->
<html lang="en">
<head><meta charset="UTF-8" /><title>My Accounts — Northbank</title></head>
<body>
  <header><nav aria-label="Account navigation"><a href="#">Accounts</a> <a href="#">Transfer</a> <a href="#">Pay bills</a></nav></header>
  <main>
    <section aria-label="Account summary">
      <h1>Checking &bull;&bull;1234</h1>
      <p class="balance">Available balance: $4,210.55</p>
      <table>
        <thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead>
        <tbody>
          <tr><td>06/01</td><td>Direct deposit</td><td>$3,200.00</td></tr>
          <tr><td>06/03</td><td>Grocery</td><td>$84.20</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>
```

Create `test/fixtures/pages/webmail-inbox.html`:

```html
<!DOCTYPE html>
<!-- signal: webmail inbox (communication cluster) -->
<html lang="en">
<head><meta charset="UTF-8" /><title>Inbox (3) — Mail</title></head>
<body>
  <header><nav aria-label="Mail folders"><a href="#">Inbox</a> <a href="#">Sent</a> <a href="#">Drafts</a></nav></header>
  <div role="main" aria-label="Inbox">
    <ul>
      <li><span class="from">Acme Rewards</span> <span class="subj">Get $150 when you open a card</span> <span class="time">2:14 PM</span></li>
      <li><span class="from">Mom</span> <span class="subj">Re: dinner Saturday</span> <span class="time">11:02 AM</span></li>
    </ul>
  </div>
</body>
</html>
```

- [ ] **Step 3: Create the label file**

Create `test/fixtures/page-labels.json`:

```json
[
  {
    "file": "article-prose.html",
    "tier": "hard",
    "page": { "expected": "run", "gate": "none" },
    "numbers": [
      { "text": "$145B", "expected": "underline" },
      { "text": "40,000", "expected": "underline" }
    ]
  },
  {
    "file": "bank-dashboard.html",
    "tier": "hard",
    "pending": "spec2",
    "page": { "expected": "suppress", "gate": "gate1-sensitive" }
  },
  {
    "file": "webmail-inbox.html",
    "tier": "hard",
    "pending": "spec2",
    "page": { "expected": "suppress", "gate": "gate1-communication" }
  }
]
```

- [ ] **Step 4: Extend the harness with the corpus loop**

In `test/gates.test.js`, add the detector source + corpus loaders below the existing `GATES_SRC` line and after the contract test. Append:

```js
const DETECTOR_SRC = fs.readFileSync(path.join(LIB, 'detector.js'), 'utf8');
const PAGES_DIR = path.join(__dirname, 'fixtures', 'pages');
const LABELS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'page-labels.json'), 'utf8')
);

// Load a corpus fixture into a window with gates + detector evaluated, exactly
// as the extension loads them.
function loadFixture(file) {
  const html = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.eval(GATES_SRC);
  dom.window.eval(DETECTOR_SRC);
  return dom.window;
}

// Texts of every underlined number, in document order.
function underlinedNumbers(window) {
  window.BallparkDetector.underlineAll(window.document.body);
  return [...window.document.querySelectorAll('.bp-number')].map(
    (s) => s.textContent
  );
}

const hard = LABELS.filter((c) => c.tier === 'hard');

// --- Page-level decisions (Gates 1 & 2) ---
for (const c of hard) {
  // Pages whose gate isn't implemented yet run as `todo`: they execute (so a
  // premature pass is reported) but can't fail the suite.
  const opts = c.pending ? { todo: `awaiting ${c.pending}` } : {};
  test(`page decision: ${c.file}`, opts, () => {
    const window = loadFixture(c.file);
    const result = window.BallparkGates.evaluatePage(window.document);
    assert.equal(
      result.run,
      c.page.expected === 'run',
      `expected run=${c.page.expected === 'run'}, got run=${result.run}`
    );
    assert.equal(
      result.gate,
      c.page.gate,
      `expected gate="${c.page.gate}", got gate="${result.gate}"`
    );
  });
}

// --- Number-level decisions (Gate 3) on run-pages ---
// A number may carry `pending` once Gate 3 suppression exists (Spec 3); until
// then run-pages list only `underline` numbers, which exercise the existing
// detector and pass now.
for (const c of hard.filter((x) => x.page.expected === 'run' && x.numbers)) {
  test(`number decisions: ${c.file}`, () => {
    const underlined = new Set(underlinedNumbers(loadFixture(c.file)));
    for (const num of c.numbers) {
      if (num.expected === 'underline') {
        assert.ok(
          underlined.has(num.text),
          `expected "${num.text}" underlined; got [${[...underlined].join(', ')}]`
        );
      } else {
        assert.ok(
          !underlined.has(num.text),
          `expected "${num.text}" suppressed but it was underlined`
        );
      }
    }
  });
}
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS overall. Specifically:
- `page decision: article-prose.html` — PASS (stub runs; gate `none` matches).
- `number decisions: article-prose.html` — PASS (`$145B` and `40,000` underline today).
- `page decision: bank-dashboard.html` / `webmail-inbox.html` — reported as **todo** (stub returns `run:true`, which doesn't match `suppress`, but `todo` absorbs it). They are *not* failures.
- All `detector.test.js` tests still PASS.

> Sanity check the todo behavior: the run summary should show 2 todo, 0 fail. If either suppress page shows as a hard fail, the `{ todo }` option wasn't applied — re-check Step 4.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures lib/gates.js test/gates.test.js
git commit -m "$(cat <<'EOF'
Add hard-corpus gating harness (Tier 3 Spec 1)

Seed corpus: prose article (run), bank + webmail (suppress, todo until
Spec 2). Asserts page-level run+gate and number-level underline/suppress.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Soft corpus + report-only eval

The Part 2 scoreboard: scores page-level decisions over the *borderline* set, false positives weighted ~3×, prints a report, never throws. Seed two doc-sourced borderline pages — a job listing (salary is arguably calibration-worthy → **run**) and a real-estate listing (Gate 2 comparative-shopping numbers → **suppress**). Under the stub both run, so the real-estate case shows as a baseline false positive — exactly the baseline distribution the spec expects.

**Files:**
- Create: `test/fixtures/pages/job-listing.html`
- Create: `test/fixtures/pages/real-estate-listing.html`
- Modify: `test/fixtures/page-labels.json`
- Create: `eval/decision-eval.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the two soft fixtures**

Create `test/fixtures/pages/job-listing.html`:

```html
<!DOCTYPE html>
<!-- signal: job listing; salary is commerce-adjacent but arguably worth calibrating (borderline run) -->
<html lang="en">
<head><meta charset="UTF-8" /><title>Senior Engineer — Globex</title></head>
<body>
  <main>
    <article>
      <h1>Senior Software Engineer</h1>
      <p class="salary">$180,000 – $210,000 a year</p>
      <h2>About the role</h2>
      <p>
        You'll lead backend services handling 2 million requests per day across a
        distributed platform, partnering with product and design teams.
      </p>
    </article>
  </main>
</body>
</html>
```

Create `test/fixtures/pages/real-estate-listing.html`:

```html
<!DOCTYPE html>
<!-- signal: real-estate listing; price/sqft/bed-bath are comparative shopping numbers (borderline suppress, gate2) -->
<html lang="en">
<head><meta charset="UTF-8" /><title>123 Maple St — For Sale</title></head>
<body>
  <main>
    <section aria-label="Listing">
      <h1>123 Maple St</h1>
      <p class="price">$849,000</p>
      <ul class="facts">
        <li>3 beds</li><li>2 baths</li><li>1,840 sqft</li>
      </ul>
      <button>Request a tour</button>
    </section>
  </main>
</body>
</html>
```

- [ ] **Step 2: Append the soft labels**

In `test/fixtures/page-labels.json`, add these two objects to the array (after the existing three):

```json
  {
    "file": "job-listing.html",
    "tier": "soft",
    "page": { "expected": "run", "gate": "none" }
  },
  {
    "file": "real-estate-listing.html",
    "tier": "soft",
    "page": { "expected": "suppress", "gate": "gate2-commerce" }
  }
```

(Remember to add a comma after the third object's closing `}` so the array stays valid JSON.)

- [ ] **Step 3: Write the report harness**

Create `eval/decision-eval.mjs`:

```js
// Tier 3, Part 2 — decision-accuracy report. NOT a unit test.
//
// Scores the gates' page-level run/suppress decisions over the SOFT (borderline)
// corpus, weighting false positives more heavily than false negatives. Like the
// Tier 2 calibration eval, it prints a report and NEVER throws — the number is
// the signal, not a pass/fail. The HARD corpus is gated separately in
// test/gates.test.js. No API key needed (decisions are deterministic + local).
//
//   npm run eval:decisions

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Running where we shouldn't (FP) erodes trust more than staying quiet (FN).
const FP_WEIGHT = 3;

const GATES_SRC = await readFile(path.join(root, 'lib/gates.js'), 'utf8');

function evaluatePage(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.eval(GATES_SRC);
  return dom.window.BallparkGates.evaluatePage(dom.window.document);
}

const labels = JSON.parse(
  await readFile(path.join(root, 'test/fixtures/page-labels.json'), 'utf8')
);
const soft = labels.filter((c) => c.tier === 'soft');

let fp = 0;
let fn = 0;
const rows = [];

for (const c of soft) {
  const html = await readFile(
    path.join(root, 'test/fixtures/pages', c.file),
    'utf8'
  );
  const result = evaluatePage(html);
  const expectRun = c.page.expected === 'run';

  let outcome = 'ok';
  if (result.run && !expectRun) { fp++; outcome = 'FP'; }
  else if (!result.run && expectRun) { fn++; outcome = 'FN'; }

  rows.push({
    file: c.file,
    expected: c.page.expected,
    got: result.run ? 'run' : 'suppress',
    outcome,
  });
}

const n = soft.length;
const weighted = fp * FP_WEIGHT + fn;
const pct = (x) => (n ? ((x / n) * 100).toFixed(1) : '0.0');

console.log(`Decision-accuracy report (soft corpus): ${n} cases\n`);
for (const r of rows) {
  const mark = r.outcome === 'ok' ? '✓' : '✗';
  console.log(`${mark}  ${r.outcome.padEnd(2)}  ${r.file}  (expected ${r.expected}, got ${r.got})`);
}
console.log('\n──────── summary ────────');
console.log(`cases:      ${n}`);
console.log(`false pos:  ${fp}  (weighted ×${FP_WEIGHT})`);
console.log(`false neg:  ${fn}`);
console.log(`FP-rate:    ${pct(fp)}%`);
console.log(`FN-rate:    ${pct(fn)}%`);
console.log(`weighted:   ${weighted}   (lower is better)`);
console.log('\nNote: Spec 1 scores page-level only; number-level (Gate 3) scoring arrives with Spec 3.');
```

- [ ] **Step 4: Add the npm script**

In `package.json`, add to `"scripts"` (after the `"eval"` line — remember the trailing comma on `"eval"`):

```json
    "eval:decisions": "node eval/decision-eval.mjs"
```

- [ ] **Step 5: Run the report**

Run: `npm run eval:decisions`
Expected output (no throw):
```
Decision-accuracy report (soft corpus): 2 cases

✓  ok  job-listing.html  (expected run, got run)
✗  FP  real-estate-listing.html  (expected suppress, got run)

──────── summary ────────
cases:      2
false pos:  1  (weighted ×3)
false neg:  0
FP-rate:    50.0%
FN-rate:    0.0%
weighted:   3   (lower is better)
```
The single FP is the baseline — the stub runs everywhere, so the suppress case is "wrong" until Gate 2 ships in Spec 2. That is the point: the scoreboard exists and reads the corpus.

- [ ] **Step 6: Confirm `npm test` is unaffected**

Run: `npm test`
Expected: Still green (soft cases are not gated — only `tier === 'hard'` drives `gates.test.js`). 2 todo, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add eval/decision-eval.mjs test/fixtures package.json
git commit -m "$(cat <<'EOF'
Add soft-corpus decision report (Tier 3 Spec 1)

eval/decision-eval.mjs scores page-level run/suppress over borderline
cases, FP-weighted, prints a report and never throws. Seeds job-listing
(run) + real-estate (suppress).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Document Tier 3

**Files:**
- Modify: `CLAUDE.md` (the `## Testing` section)

- [ ] **Step 1: Add the Tier 3 description**

In `CLAUDE.md`, in the `## Testing` section, after the **Tier 2** paragraph, insert:

```markdown
**Tier 3 — decision-accuracy (FRAMEWORK BUILT, Spec 1).** Answers *"are the
run/suppress decisions right?"* — a precision/recall concern the other tiers
don't cover. A labeled page corpus (`test/fixtures/pages/` + `page-labels.json`)
drives two harnesses that load the real gate + detector IIFEs into jsdom:
- **Part 1 — `test/gates.test.js` (gating, `npm test`).** Unambiguous cases;
  asserts the page-level contract `BallparkGates.evaluatePage(document) →
  { run, gate, reason }` (both `run` *and* the responsible `gate`, so a page
  suppressed for the wrong reason fails) plus number-level underline/suppress.
  Cases whose gate isn't implemented yet carry `pending` in the label and run as
  `todo`.
- **Part 2 — `eval/decision-eval.mjs` (report-only, `npm run eval:decisions`).**
  Borderline cases scored as FP/FN with false positives weighted ~3×; prints a
  report, never throws. No API key needed — decisions are deterministic.

Spec 1 ships the framework with a permissive **stub** `lib/gates.js`; real Gate
1/2 logic and sanitized real fixtures arrive in Spec 2, Gate 3 in Spec 3. See
`specs/2026-06-12-decision-accuracy-test-layer.md`. `lib/gates.js` is **not yet
in `manifest.json` or the packaging allowlist** — it is test-only until Spec 2
wires it into `content.js`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Document Tier 3 decision-accuracy testing in CLAUDE.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done-when

- `npm test` is green: `detector.test.js` unchanged, `gates.test.js` shows the contract test + `article-prose` page/number tests passing, and the two suppress pages as `todo` (0 fail).
- `npm run eval:decisions` prints a 2-case report without throwing.
- `lib/gates.js`, `test/gates.test.js`, `eval/decision-eval.mjs`, the five fixtures, `page-labels.json`, and the `CLAUDE.md` Tier 3 note all exist and are committed.
- No changes to `manifest.json`, `content.js`, or any shipped runtime code — Spec 1 is purely additive test infrastructure plus a test-only stub.

## Out of scope (later specs)

- Real Gate 1/2 logic, the status/override panel, sanitized real snapshots, signal-specific synthetic fixtures (schema.org `Product`, editable-main-region, prose-density band) → **Spec 2**. Wiring `lib/gates.js` into `content.js` + the packaging allowlist also lands in Spec 2.
- Gate 3 per-number triage, the graceful-failure message, borderline number-level fixtures, number-level soft scoring → **Spec 3**.
```
