# Spec 1 — Decision-accuracy test layer (Tier 3)

**Date:** 2026-06-12
**Status:** Draft for review
**Part of:** Workstream B (calibration-worthiness redesign)

## Context

Ballpark currently triggers on the *presence* of a number, not its
*calibration-worthiness*, and runs on surfaces where it shouldn't (inboxes, work
apps, shopping pages). Workstream B introduces three gates to fix this:

- **Gate 1** — surface/context exclusion (should Ballpark run on this page at all?)
- **Gate 2** — page-type detection (is this a commerce/transactional archetype?)
- **Gate 3** — per-number triage (is this specific number worth calibrating?)

Gates are heuristic systems that "degrade silently": a tweak that kills one false
positive can quietly create a false negative elsewhere. The existing two testing
tiers don't cover this:

1. **Tier 1** (`test/detector.test.js`) — deterministic detector logic; does the
   *mechanism* work?
2. **Tier 2** (`eval/calibration-eval.mjs`) — LLM eval; are the *calibrations*
   accurate?

Neither answers **"are the run/suppress decisions right?"** — a precision/recall
problem. This spec builds that third tier. It is the **regression guard the gate
work will be tuned against**, so it is built *first*, before the gates exist.

## Goals

- A labeled corpus of pages (and numbers within run-pages) tagged with the
  correct run/suppress / underline/suppress decision.
- A deterministic harness that runs the gate decisions against the corpus and
  reports correctness, weighting **false positives more heavily than false
  negatives** (per the asymmetry: running where we shouldn't erodes trust more
  than staying quiet).
- Define the **gate decision contract** the gates will be implemented against
  (TDD: the corpus is the failing test written first).

## Non-goals

- Implementing Gates 1/2/3 themselves (Specs 2 and 3).
- The status/override panel (Spec 2).
- The graceful-failure message for non-calibratable numbers (Spec 3).
- LLM-assisted labeling — v1 is hand-labeled; revisit only if the corpus grows
  past what's hand-trustable.

## Architecture

### Where the gates run (drives the harness design)

Gates 1 & 2 read whole-page DOM, and Gate 3 decides per candidate number — all
DOM work — so they live in **content-script land** (classic scripts, `window`
globals), the same execution world as `lib/detector.js`. The harness therefore
loads them into jsdom exactly as Tier 1 already loads the detector
(`window.eval` of the IIFE, then call the global). No new module system, no
network.

### Two decision surfaces under test

- **Page-level (Gates 1 & 2):** a new global
  `window.BallparkGates.evaluatePage(document)` returning
  `{ run: boolean, gate: string, reason: string }`. A **single** combined
  contract (not separate Gate 1 / Gate 2 calls).
  - `gate` is a **stable machine id** for the responsible gate
    (`gate1-communication`, `gate1-sensitive`, `gate2-commerce`, `none`, …).
    Tests assert against this.
  - `reason` is the **human-readable** text the Spec 2 status panel surfaces
    ("didn't run: webmail surface"), so the corpus and the user-facing panel
    validate the *same* output.
  - Asserting `gate` (not just `run`) is the defense against fixtures that
    "pass for the wrong reason" — see Sanitizing real snapshots below.
- **Number-level (Gate 3):** no new entry point. "Which numbers underline on
  this page" is already what `detector.test.js` asserts via `underlineAll`;
  Gate 3 adds suppressions to that existing behavior. Number-level cases are
  written in the existing `underline()` harness style.

> In Spec 1 the `BallparkGates` global does not exist yet, so Part 1's
> page-level assertions fail (red). That is intended TDD state; Spec 2 turns
> them green.

## The two corpora

The tier splits along the same line as Tiers 1 and 2 — a deterministic gating
test and a non-gating report:

### Part 1 — hard corpus (gating)

- **Lives in:** `test/gates.test.js` — runs on `npm test`.
- **Contains:** only **unambiguous** cases with an objectively-correct answer.
- **Behavior:** loads each snapshot into jsdom, runs `evaluatePage` (and, for
  run-pages, `underlineAll`), and asserts the exact expected outcome —
  **both `run` and the responsible `gate`**, so a page suppressed by the *wrong*
  gate fails even when `run` happens to be right. A flip turns the build red.
- **Uncertain cases:** recorded as `todo` asserting the *correct* behavior —
  reusing the Tier 1 convention — and flipped to a real test when settled.

### Part 2 — soft corpus (report-only)

- **Lives in:** `eval/decision-eval.mjs` — manual run, **never throws**
  (mirrors the Tier 2 eval's "report, don't gate" stance).
- **Contains:** the **messy middle** — borderline pages/numbers where two
  reasonable heuristics could legitimately disagree (a table-heavy-but-
  informational article; a `$180k` salary on a job listing; a forum post that
  quotes a real statistic among native engagement metrics).
- **Behavior:** computes false-positive and false-negative rates over the
  borderline set, **FP weighted ~3×**, prints a per-case + summary report. This
  is the *tuning scoreboard* — Part 1 catches regressions; Part 2 tells you
  whether a threshold change is net-positive on the fuzzy cases.

## File layout

```
specs/2026-06-12-decision-accuracy-test-layer.md   # this doc
test/fixtures/pages/                               # corpus pages
  <synthetic + sanitized-real>.html
test/fixtures/page-labels.json                     # ground-truth labels
test/gates.test.js                                 # Part 1 — hard, gating
eval/decision-eval.mjs                             # Part 2 — soft, report
```

Corpus pages are **hybrid**: small synthetic pages for systematic signal
coverage, plus a handful of **sanitized** real snapshots for the specific
surfaces the handoff doc names as real failures (e.g. an internal commerce
admin, a webmail inbox). Sanitized snapshots carry a `.sanitized.html` suffix
and must contain **no real personal/account data** before being committed to
this public repo.

## Sanitizing real snapshots (preserve structure, scrub content)

The gates key on **structural** signals — prose-vs-chrome block distribution,
whether the main region is `contenteditable`/an input, schema.org markup, ARIA
landmarks, form/cart elements — **not** on the words. So sanitization must
**scrub content while preserving structure**, or it deletes the very signal the
fixture exists to test, and the fixture passes for the wrong reason.

Rules:

- **Substitute, never delete.** Replace real prose with filler of *similar
  length and the same block placement* (so prose-density ratios survive);
  replace account numbers, balances, emails, names, and addresses with synthetic
  **same-shape** values (a 12-digit account → a fake 12-digit string). Do not
  strip elements or collapse whitespace.
- **Preserve, do not touch** (these ARE the signals): tag structure and nesting
  depth; `class` / `id` / `role` / `aria-*` attributes and landmarks;
  `contenteditable`, `<input>`, `<textarea>`, `<form>`; schema.org
  `itemscope`/`itemtype`/`itemprop`, JSON-LD
  `<script type="application/ld+json">`, OpenGraph/meta tags, and price/cart
  nodes.
- **Scrub:** visible PII, real account/order/tracking values (keep the shape),
  and real URLs (→ `example.com`).

**Two guards against "passes for the wrong reason":**

1. Part 1 asserts the responsible **`gate`**, not just `run` (see above) — a
   bank page suppressed by the commerce gate instead of the sensitive-account
   gate fails.
2. Each sanitized fixture opens with a one-line HTML comment naming the
   structural signal it exists to exercise (e.g.
   `<!-- signal: main region is contenteditable (composer) -->`), so a reviewer
   can confirm the scrub didn't destroy it.

## Label schema

`test/fixtures/page-labels.json` — one entry per page:

```json
{
  "file": "product-aritzia.sanitized.html",
  "tier": "hard",
  "page":   { "expected": "suppress", "gate": "gate2-commerce" },
  "numbers": [
    { "text": "$145",  "expected": "suppress" },
    { "text": "$145B", "expected": "underline" }
  ]
}
```

- `tier`: `"hard"` → exercised by Part 1; `"soft"` → exercised by Part 2.
- `page.expected`: `"run"` | `"suppress"`.
- `page.gate`: which gate *should* be responsible (e.g. `gate1-sensitive`,
  `gate1-communication`, `gate2-commerce`, `none`). Lets a failure report *which*
  gate misfired, and feeds the Spec 2 status-panel "why".
- `numbers`: present **only** when `page.expected === "run"`; each number's
  `expected` is `"underline"` | `"suppress"`.

## Scoring (Part 2)

For each case, the harness compares actual vs. expected and bins the outcome:

- **False positive (FP):** Ballpark *ran/underlined* where the label says
  *suppress*. (The costly error.)
- **False negative (FN):** Ballpark *suppressed* where the label says
  *run/underline*.

Report prints: per-case pass/miss, `FP-rate`, `FN-rate`, and a single
**weighted score** = `FP_count * 3 + FN_count` (lower is better; the 3× encodes
the asymmetry — tunable constant at the top of the file). No throw; the number
is the signal.

## Corpus sourcing (requirement, not a habit)

Cases are **derived deliberately**, not improvised:

1. **Primary source — the handoff doc.** It already enumerates the real surfaces
   and number-types: Gate 1 communication cluster (Gmail, Outlook, Slack, Teams,
   Discord, WhatsApp Web, Messenger) and sensitive-account cluster (banking,
   brokerages/retirement, insurance, health portals, government/legal); Gate 2
   commerce archetypes (retail/cart, travel booking, real estate, food/menus,
   maps/directions, sports stats, social feeds); Gate 3 keep/suppress contrasts
   (`$145` vs `$145B`; "50,000 deaths" vs "50,000 reward points"; star ratings,
   review counts, order/tracking numbers, dates, version numbers).
2. **Light research** only where the doc is thin (e.g. confirming the real DOM
   shape of a schema.org `Product` page, or what an OroCommerce admin's markup
   looks like) so synthetic fixtures reflect reality rather than assumption.

Take only the *relevant* parts of the doc for each case; do not transcribe it.

## Starting size

Seed roughly **10–12 hard cases** (the unambiguous surfaces above) and
**15–20 soft cases** (the borderline set), then grow. If authoring reveals gaps
that need more cases for honest coverage, **add them** rather than capping —
slightly more tests is the right trade.

For Spec 1 specifically, author:

- The **number-level** hard cases that exercise *existing* detector behavior
  (e.g. a `$145B` acquisition underlines) — these pass/red meaningfully now.
- A **small set of synthetic page-level fixtures** to prove the `evaluatePage`
  harness wiring (red-by-design until Spec 2 implements the gates).

Defer to the gate spec that *defines* their behavior:

- **Sanitized real snapshots** and **signal-specific synthetic fixtures**
  (schema.org `Product`, editable-main-region, prose-density band) → **Spec 2**.
  Their payoff is exercising Gate 1/2's structural read, which doesn't exist yet.
- **Borderline number-level fixtures** → **Spec 3**.

## Verification

- `npm test` runs and **fails on the new page-level assertions** (gates not yet
  implemented) while all existing Tier 1 tests still pass. Red here is success —
  it proves the harness wires up and the contract is exercised.
- The number-level hard cases that depend only on *existing* detector behavior
  (e.g. a `$145B` underline) pass immediately; ones needing Gate 3 suppression
  are `todo` until Spec 3.
- `node eval/decision-eval.mjs` runs end-to-end and prints a report without
  throwing. In Spec 1 the soft corpus is just a small **seed** (most borderline
  cases arrive with Specs 2/3), and with gates absent the report shows a baseline
  FP/FN distribution — the point at this stage is that the harness wires up and
  reports cleanly, not the numbers themselves.

## Decomposition (for context)

This is **Spec 1 of 3** in Workstream B; each is its own brainstorm → plan →
implement cycle, all sharing this one corpus as their regression guard:

- **Spec 1 (this doc)** — test-layer framework + unambiguous hard cases.
- **Spec 2** — Gates 1 & 2 + status/override panel; adds signal-specific
  fixtures.
- **Spec 3** — Gate 3 + graceful-failure backstop; adds borderline number-level
  cases.

The popup-won't-open bug in live v1.0.1 is tracked separately (debugging task,
pending reproduction evidence) and is not part of this spec.
