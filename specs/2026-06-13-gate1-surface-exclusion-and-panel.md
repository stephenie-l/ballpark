# Spec 2 — Gate 1 (surface exclusion) + status/override panel

**Date:** 2026-06-13
**Status:** Approved (design); ready to plan
**Part of:** Workstream B (calibration-worthiness redesign)
**Builds on:** Spec 1 (`specs/2026-06-12-decision-accuracy-test-layer.md`) — the Tier 3
corpus + the `evaluatePage` stub this spec fills in.

## Context

Ballpark currently underlines numbers on every page, including surfaces where it
has no business — webmail, your own banking/health/brokerage accounts, and
**app-like working surfaces**: Salesforce, internal company web tooling, admin
backends (OroCommerce), API dashboards. For an always-on extension, firing on a
user's daily working tools is the worst failure mode — they fight underlines all
day and learn to ignore the signal entirely.

This spec implements **Gate 1** — *"Should Ballpark run on this page at all?"* —
plus the **status/override panel** the redesign requires for legibility, and the
**runtime wiring** that makes `lib/gates.js` actually gate the extension. This is
the first Web Store submission of the redesign.

Gate 2 (public commerce archetypes) and Gate 3 (per-number triage) are separate
specs. The app-vs-document problem — Salesforce, dashboards, internal tooling —
is **Gate 1's job, handled here**, because those live on arbitrary hostnames and
must be caught by heuristics, not a list.

## Goals

- Fill in `evaluatePage(document) → { run, gate, reason }` with real Gate 1 logic.
- A per-site **override** layer (force-on / force-off), persistent, both directions.
- A **status/override panel** in the popup: shows whether Ballpark ran on the
  current page and why, and exposes the override toggle.
- Wire `lib/gates.js` into the runtime (manifest, `content.js`, packaging allowlist).
- Conservative defaults: **when unsure, suppress.**

## Non-goals

- Gate 2 (commerce page-type detection) → Spec 3.
- Gate 3 (per-number triage) + graceful-failure message → Spec 4.
- Number-level "suppressed these numbers and why" in the panel → arrives with Gate 3.
- Live re-application of an override without a page reload (v1 reloads the tab).

## Architecture: where things live

| Concern | Lives in | Why |
|---|---|---|
| Gate decision (pure) | `lib/gates.js` `evaluatePage(document)` | Synchronous, no storage → Tier-3 testable in jsdom |
| Override combine (pure) | `lib/gates.js` `applyOverride(verdict, override)` | Pure fn, unit-testable alongside the gate |
| Override storage (async) | `content.js` + a small storage helper | `chrome.storage` is async/runtime-only; kept out of the pure layer |
| Page decision + gating | `content.js` `init()` | Owns the scan/observe lifecycle |
| Status reporting | `content.js` message listener | Content script knows what happened on the page |
| Panel UI | `popup.html` / `popup.css` / `popup.js` | The toolbar popup is the "click into the extension" surface |

The key boundary: **`evaluatePage` is pure heuristics; overrides are a separate
layer applied in `content.js`.** This keeps the gate logic testable without
mocking `chrome.storage`, and isolates the async concern.

## Gate 1 — the decision

`evaluatePage(document)` returns `{ run, gate, reason }`. `gate` is a stable id
(asserted by Tier 3); `reason` is human text for the panel. The funnel, in order
(first match wins):

### 1. Hardcoded hostname list (safety net, checked first — cheap)

Read `document.location.hostname`; match by **domain suffix**. Deliberately
**short** — high-traffic, unambiguous, high-stakes only. Two clusters:

- **Communication** → `gate1-communication`: `mail.google.com`, `outlook.live.com`,
  `outlook.office.com` / `outlook.office365.com`, `mail.proton.me`,
  `app.slack.com` (+ `*.slack.com`), `teams.microsoft.com`, `discord.com`,
  `web.whatsapp.com`, `messenger.com`.
- **Sensitive-account** → `gate1-sensitive`: major banks (`chase.com`,
  `bankofamerica.com`, `wellsfargo.com`, `citi.com`, `capitalone.com`,
  `usbank.com`, `pnc.com`), brokerages/retirement (`fidelity.com`,
  `vanguard.com`, `schwab.com`), health (`mychart.*` patterns,
  `myuhc.com`, `anthem.com`), government (`irs.gov`, `ssa.gov`, `uscis.gov`,
  state DMV `*.dmv.*` where feasible).

The list is a **safety net, not the primary mechanism.** It must not grow into a
maintenance treadmill — the heuristics carry everything it doesn't name. The list
lives as a const array in `gates.js`; adding an entry is a one-line change.

### 2. Heuristics (primary — carry the long tail, incl. arbitrary-hostname tooling)

Three complementary signals, evaluated on the **dominant content region** (the
largest text-bearing block, e.g. `<main>`/`<article>`/the biggest container),
not the whole document — so a peripheral comment box or a header search field
doesn't trip them.

- **Scoped editability (near-decisive).** If the dominant content region is (or
  contains, with almost no article prose) a `contenteditable` region → suppress
  `gate1-editable`. Catches composers, Google Docs/Notion, rich-text authoring.
  Explicitly ignores small/peripheral editables (a comment composer below an
  article). **`<textarea>` is deliberately *not* an editability signal** — it's
  usually a form control (API console, search), so it counts toward
  interactive-control density instead; a textarea-dominant page still suppresses
  via control/prose density, attributed to `gate1-interface`. (Decided in Spec 2
  impl: the original `textarea`-in-editability selector mis-routed an API console
  to `gate1-editable`.)
- **Interactive-control density (catches Salesforce / dashboards / admin tools /
  API consoles).** Count interactive controls — `button`, `[role=button]`,
  `input`, `select`, `textarea`, and filter/menu controls — within the dominant
  region, measured *relative to* the region's prose text (controls per unit of
  text, or controls' share of the region). When controls **dominate** the region
  → suppress `gate1-interface`. This is the signal for working surfaces that have
  *some* data text (so prose-density alone is borderline) but are driven by
  controls. The "dominant region" scoping is what keeps a news article with a few
  share buttons from tripping it.
- **Prose density (the app-vs-article band).** Ratio of text in prose-like blocks
  (flowing sentences in `<p>`/`<article>`/`<li>` with sentence-length content)
  vs. UI-chrome text (buttons, labels, table cells, nav, short list items).
  Clearly-high → run (`none`); clearly-low → suppress `gate1-interface`; the
  **messy middle defaults to suppress** (the bias), protecting a slightly
  table-heavy but genuinely informational article via the high-prose escape and
  the editability/control signals being absent.

### Combination logic (the funnel)

```
evaluatePage(document):
  1. host in hardcoded list      → { run:false, gate: <cluster>,        reason }
  2. dominant region editable    → { run:false, gate:'gate1-editable',  reason }
  3. control density dominates   → { run:false, gate:'gate1-interface', reason }
  4. prose density:
       clearly high              → { run:true,  gate:'none',            reason:'' }
       clearly low OR ambiguous  → { run:false, gate:'gate1-interface', reason }
  5. (unreached fallthrough)     → { run:true,  gate:'none' }
```

Scoped-editability is near-decisive; control-density is strong; prose-density
carries the band with the default-to-suppress bias. All thresholds
(`PROSE_RATIO_HIGH`, `PROSE_RATIO_LOW`, `CONTROL_DENSITY_THRESHOLD`, the
"dominant region" size cutoff) are **named constants at the top of `gates.js`,
tuned against the Tier 3 corpus** — not magic numbers buried in logic. The soft
eval's FP-weighted scoreboard is how we tune them empirically.

### gate ids and reason strings

| gate id | reason (panel-facing) |
|---|---|
| `none` | _(ran; empty)_ |
| `gate1-communication` | "Looks like a messaging or email surface" |
| `gate1-sensitive` | "Looks like a private account (banking, health, etc.)" |
| `gate1-editable` | "You're composing or editing on this page" |
| `gate1-interface` | "Looks like an app or dashboard, not an article" |
| `override-on` | "You turned Ballpark on for this site" |
| `override-off` | "You turned Ballpark off for this site" |

## Override layer

A pure combine function in `gates.js`, applied **after** `evaluatePage` in
`content.js`:

```js
applyOverride(verdict, override):
  if override === 'force-on'  → { run:true,  gate:'override-on',  reason:'You turned Ballpark on for this site' }
  if override === 'force-off' → { run:false, gate:'override-off', reason:'You turned Ballpark off for this site' }
  else                        → verdict   // unchanged
```

Storage: `chrome.storage.local` key `siteOverrides` = `{ [hostname]: 'force-on' | 'force-off' }`.
Helpers (in `content.js` or a tiny storage module): `getOverride(host)`,
`setOverride(host, value)`, `clearOverride(host)`. Keyed by `location.hostname`
(per-site, persistent). The override **wins over the gate**, in both directions.

## Status/override panel

Lives in the popup, as a new section **above** the API-key block.

```
┌─ This page ─────────────────────────┐
│ ⏸  Didn't run — looks like an app    │
│     or dashboard                     │
│     [ Run Ballpark on this site ]    │
└──────────────────────────────────────┘

   (running state:)
┌─ This page ─────────────────────────┐
│ ✓  Ran — found 12 numbers            │
│     [ Don't run on this site ]       │
└──────────────────────────────────────┘

   (overridden state shows a reset:)
│ ✓  Ran — you turned Ballpark on here │
│     [ Reset to automatic ]           │
```

**Data flow.** The popup needs the *active tab's* status:

1. `content.js` computes its decision at `init()` and keeps it in a module
   variable `pageStatus = { run, gate, reason, count, override }` (`count` =
   number of `.bp-number` after scan; updated on rescan).
2. `content.js` registers a `chrome.runtime.onMessage` listener that replies to
   `{ type: 'GET_STATUS' }` with `pageStatus`. **It registers this even when
   gated off** (the content script still runs; it just skips scanning), so the
   panel can always report *why* it didn't run.
3. `popup.js` on open: `chrome.tabs.query({active, currentWindow})` →
   `chrome.tabs.sendMessage(tabId, { type:'GET_STATUS' })`. If sendMessage errors
   (no content script — `chrome://`, the Web Store, PDF viewer, etc.), the panel
   shows "Ballpark isn't active on this page."

**Override toggle.** Clicking the button writes the override to storage and
**reloads the tab** (`chrome.tabs.reload`) so the new decision applies cleanly
(v1 — avoids fiddly live unwrap/re-scan). Button is contextual:

- Currently running → "Don't run on this site" → sets `force-off`.
- Currently suppressed → "Run Ballpark on this site" → sets `force-on`.
- An override is active → also offer "Reset to automatic" → `clearOverride`.

**Testable seam.** The chrome messaging/reload is integration (manual
verification), but two pure helpers are extracted and unit-tested:
`formatStatus(status) → { line, detail }` (the display strings) and
`nextOverrideAction(status) → 'force-on' | 'force-off' | 'reset' | null` (which
button to show).

## Runtime wiring

- **`manifest.json`**: add `lib/gates.js` to `content_scripts[0].js`, ordered
  **before** `content.js` and alongside the other libs:
  `["lib/detector.js", "lib/card.js", "lib/gates.js", "content.js"]`. Bump
  `version` `1.0.1` → `1.1.0` (feature release; required for resubmission).
- **`content.js` `init()`** becomes async:
  ```
  async function init():
    const verdict   = BallparkGates.evaluatePage(document)
    const override  = await getOverride(location.hostname)
    const decision  = BallparkGates.applyOverride(verdict, override)
    pageStatus = { ...decision, count: 0, override }
    registerStatusListener()              // always — so the panel can report
    if (!decision.run) return             // gated off: no scan, no observer
    scan(); pageStatus.count = countUnderlines()
    observeMutations()
    document.addEventListener('click', handleClick)
    document.addEventListener('keydown', escToHide)
  ```
  (rescan updates `pageStatus.count`.)
- **Packaging allowlist** (`CLAUDE.md`): add `lib/gates.js`; **16 → 17 files**;
  update the `zip` command and the `unzip -l` verification comment.
- **No new permissions** (important — new scopes push Web Store review into a
  slower lane). `storage` is already granted. The panel's `chrome.tabs.query`
  (active tab → `tabId` only, no `tabs` permission needed), `chrome.tabs.sendMessage`
  (to our own content script, already injected via `<all_urls>`), and
  `chrome.tabs.reload` all work without adding `tabs` or host permissions. If any
  of these turns out to require a new scope during implementation, **stop and
  flag it** rather than silently expanding the manifest.

## Testing

- **Tier 3 hard corpus:** remove `pending` from the `bank-dashboard` and
  `webmail-inbox` labels — they flip from `todo` to real gating tests and must go
  green once the hardcoded list + heuristics land.
- **New signal-specific fixtures** (the ones Spec 1 deferred here), each with an
  accurate `<!-- signal: -->` comment:
  - `app-editable.html` — dominant `contenteditable` region → `gate1-editable`.
  - `dashboard-controls.html` — Salesforce/admin-style: data text but
    control-dominated main region → `gate1-interface` (the control-density case).
  - `api-console.html` — forms/inputs/buttons dominate → `gate1-interface`.
  - `econ-article-tables.html` — table-heavy but genuinely informational → **runs**
    (`none`); guards against over-suppression.
  - Optionally a **sanitized real** OroCommerce admin snapshot (per Spec 1's
    sanitization protocol) if available; else the synthetic `dashboard-controls`
    stands in until one is contributed.
- **Harness extension:** Gate 1's hardcoded list needs a hostname, so the Tier 3
  corpus gains an optional `url` per label; `loadFixture`/the eval pass it to
  `new JSDOM(html, { url })`. Update `page-labels.json` entries that need a host
  (e.g. a `mail.google.com` URL for a webmail case to exercise the list path vs.
  the heuristic path).
- **Pure-function unit tests:** `applyOverride` (all three branches), and the
  panel helpers `formatStatus` / `nextOverrideAction`.
- **Soft eval:** the `real-estate` baseline FP stays (that's Gate 2); add a few
  borderline app/article cases to watch the FP-weighted score as thresholds tune.
- **Manual verification (no jsdom path):** load unpacked, confirm the panel
  reports correctly on an article, a dashboard, and a `chrome://` page; confirm
  the override toggle persists across reloads and flips behavior.

## Tuning note

Gate 1's thresholds are deliberately set conservative (bias to suppress) and are
expected to be tuned against real run results. The panel's override is the safety
valve that makes aggressive defaults livable; the Tier 3 soft scoreboard is how
we measure whether a threshold change is net-positive (FP weighted 3×).

## Decomposition (for context)

- **Spec 1 (done)** — Tier 3 test layer + `evaluatePage` stub.
- **Spec 2 (this doc)** — Gate 1 + panel + overrides + runtime wiring. First
  redesign Web Store submission (`version` 1.1.0).
- **Spec 3** — Gate 2 (public commerce page-type detection); reuses this panel +
  wiring.
- **Spec 4** — Gate 3 (per-number triage) + graceful-failure backstop.

The live-v1.0.1 popup-won't-open bug remains a separate debugging task (pending
reproduction evidence) and is not part of this spec.
