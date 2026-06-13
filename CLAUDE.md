# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ballpark is a Manifest V3 Chrome extension that helps readers calibrate unfamiliar numbers in place. It underlines numbers on a page; clicking one asks Claude (Haiku 4.5, with optional web search) whether the number is large/small/typical for its inferred reference class, then renders a small card next to it. The framing is **calibration, not verification** — the prompt and UI deliberately steer toward directional/relative answers, not fact-checking. See `README.md` for the product rationale.

The extension is published on the Chrome Web Store; end users install it from there with their own Anthropic API key. Release history: `version` 1.0.0 (first release) → 1.0.1 (live-bug fixes) → **1.1.0** (the first calibration-worthiness redesign release: Gates 1 & 2 + status/override panel + the Tier 3 test layer). As of **2026-06-13**, 1.1.0 is built (`ballpark.zip`, the hand-assembled allowlist of 18 files) and **pending Web Store submission**. The workflow below is for developing the source, not for using the shipped extension.

## Redesign status — Workstream B (calibration-worthiness)

Ballpark is mid-redesign to trigger on a number's **calibration-worthiness**, not its mere presence — via three coarse→fine gates plus a decision-accuracy test layer and a status/override panel. Progress as of 2026-06-13 (specs + plans in `specs/`):

- ✅ **Spec 1 — Tier 3 test layer** (decision-accuracy corpus + harness). See `## Testing` below.
- ✅ **Spec 2 — Gate 1** (surface exclusion): hostname list + editability / control-density / prose-density heuristics; per-site override; popup "This page" panel.
- ✅ **Spec 3 — Gate 2** (commerce page-type): structured data + real-estate hostname net + article guard.
- ⏳ **Spec 4 — Gate 3 (NOT BUILT):** per-number triage — the "graspability gap" (`number × scale-word × thing-counted`), cheap-and-local before the API, with a click-time graceful "insufficient context" failure (which also kills the old raw-JSON error). The detector suffix-letter bug (`$3,500 mixed` → `$3,500 m`) folds in here.

`evaluatePage` funnel order in `lib/gates.js`: Gate 1 hostname list → **Gate 2 commerce** → Gate 1 heuristics. Gates default to suppression when unsure; the override toggle is the safety valve. Known tuning item: prose density is `<p>`-only (over-suppresses `<div>`-paragraph articles — first tuning candidate).

## Developer workflow

The **shipped extension** has no build step and no runtime dependencies — it's vanilla JS loaded directly into Chrome. There is now a **dev-only** test setup (`package.json` + `jsdom`); nothing from it is loaded into the extension.

- **Load for development:** `chrome://extensions` → enable Developer mode → Load unpacked → select the repo root.
- **Iterate:** after editing, click the reload icon on the extension card. Content-script changes also need a page reload; background changes take effect on extension reload.
- **API key:** click the toolbar icon and paste an Anthropic key. Stored in `chrome.storage.local`. Without it, every calibration errors.
- **Debug:** content-script logs appear in the page's DevTools console; background/service-worker logs appear via the "service worker" link on the extension card.

## Packaging for the Web Store

There is no build, so the upload zip is assembled by hand. Use an **allowlist** (zip only the files the extension loads) — never zip the whole repo, which would pull in dev-only dirs. `docs/` is gitignored and `assets/`, `test/`, `node_modules/`, `package*.json`, the `*.md` files, and the unused `icons/ballpark_highres.png` are all dev-only and must stay out.

```bash
rm -f ballpark.zip
zip -r ballpark.zip \
  manifest.json background.js content.js content.css \
  popup.html popup.css popup.js \
  welcome.html welcome.css \
  lib/api.js lib/card.js lib/detector.js lib/gates.js lib/status.js \
  prompts/calibration.md \
  icons/ballpark_16.png icons/ballpark_48.png icons/ballpark_128.png
unzip -l ballpark.zip   # verify: exactly these 18 files, no .DS_Store
```

Every resubmission needs a bumped `manifest.json` `version` or the Web Store rejects it. README screenshots live in tracked `assets/screenshots/` (so they render on GitHub) — these are separate from the store-listing screenshots, which are uploaded directly in the dashboard.

## Testing

Run with `npm test` (Node's built-in runner — no Jest/Vitest, `jsdom` is the only dev dependency). Testing splits into three tiers; keep them separate.

**Tier 1 — deterministic logic (DONE).** `test/detector.test.js` covers `lib/detector.js`. These are **black-box** tests: load the real content-script IIFE into a jsdom DOM via `window.eval`, run `underlineAll`, and assert which numbers came out underlined. They never touch the IIFE's internals, so refactors are safe as long as observable behavior holds. Conventions worth preserving:
- A known bug is recorded as a **`todo` test asserting the *correct* behavior**, never as a passing test that bakes in the buggy output. Flip `todo` → real test when fixing (see the decimal-numbers fix in git history for the pattern).
- The detector is fiddly (regex + exclusion heuristics) and degrades silently, so any change there should run against these cases. Good follow-on coverage if extending: `api.js`'s `parseResponse` is also pure and worth unit-testing the same way.

**Tier 2 — LLM calibration eval (BUILT).** Fixtures live at `test/fixtures/calibration-cases.json` (22 real cases + `_section` separators); the harness is `eval/calibration-eval.mjs`, run with `ANTHROPIC_API_KEY=sk-ant-... npm run eval`. It feeds each fixture's real `{url, number, context}` to the real `calibrate()` (real prompt + model + parser, so it also exercises the `insufficient_context` path) and checks **acceptance criteria**, not exact strings — *structural* (verdict < 15 words, `reference_class` present, 1–2 comparisons, `searched` is boolean) and *directional* (verdict's large/small/typical matches `expected_direction` via the fixture's `verdict_keywords`; `reference_class` mentions an expected-domain keyword). It **prints a report, never throws** — it's an eval, not a gate. It costs real API tokens and is non-deterministic, so it lives **outside `test/`** (so `npm test` never runs it) and is invoked manually when `prompts/calibration.md` or the model changes. To import the real ESM `api.js` from Node, `lib/package.json` marks `lib/` as `type: module` (dev-only; Chrome ignores it, and it's excluded from the packaging allowlist). Known open items from the last run: the model overshoots the 15-word verdict cap ~18% of the time (prompt-tuning candidate), and several fixtures encode opinionated absolute-vs-peer reference classes the model reasonably differs on (fixture-review candidates, not prompt bugs); no fixture yet exercises the truly-nonsensical `insufficient_context` case.

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

## Two JS execution contexts (the key architectural split)

The manifest loads scripts into two different worlds, and they use different module systems — this is the thing most likely to trip up an edit:

- **Content scripts** (`lib/detector.js`, `lib/card.js`, `content.js`): classic scripts, **no `import`/`export`**. They communicate by attaching globals to `window` (e.g. `window.BallparkDetector`, `window.BallparkCard`). Load order in `manifest.json` is load-bearing: the lib files must come before `content.js`, which consumes their globals.
- **Background** (`background.js`, `lib/api.js`): ES modules (`"type": "module"` service worker). These use `import`/`export` normally. Content scripts cannot call the Anthropic API directly, so all network calls live here.

Do not add `import` to a content script or `window.` globals to the background — they won't resolve.

## Request flow (high level)

A click on an underlined number sends a message from the content script to the background worker, which checks a cache, then calls the Anthropic API if needed, then returns the result for the card to render. Network calls only happen in the background; the content script handles UI.

There is a session-scoped cache between the click handler and the API call — if a calibration appears to skip the API, look there first.

## Planned: local reference layer (NOT YET BUILT — direction)

Goal: add a **third tier between the cache and the API** so common, stable numbers can be calibrated from data we ship in the repo, with **no API call and no web search** — a much lower-cost path. The model/search tier stays the fallback for anything not covered.

Intended flow once built: click → session cache → **local reference lookup** → API (with optional search). Each layer is cheaper than the next; only fall through on a miss.

- **What it is:** a small reference file (e.g. `data/reference.json` or similar) keyed by common industries / number types (salaries, populations, prices, distances, file sizes, etc.) holding the reference class and typical ranges needed to produce a directional verdict locally. Keep it directional-not-specific, consistent with `prompts/calibration.md`.
- **Lookup mechanism:** a matcher that maps a `{number, context}` to a reference-class entry (likely lives alongside `lib/api.js` in the background, since that's where calibration is decided). On a confident match, return a locally-built result; otherwise fall through to the API. Mark the result's provenance so the card can distinguish local vs. API/searched (mirror the existing `searched` indicator pattern).
- **Two mechanisms this needs (open design questions):**
  1. **Updating mechanism** — how reference data is refreshed so it doesn't go stale (manual curation vs. a periodic job that re-derives ranges; versioning the data file; who/what triggers updates).
  2. **Fact-check mechanism** — how we trust an entry before serving it without a search (provenance/source per entry, a verification pass, and a confidence threshold below which we fall through to the API instead of answering locally).

Both are unsolved — treat them as the core of the design, not an afterthought. Tier 2 eval fixtures (`test/fixtures/calibration-cases.json`) are a natural source of regression cases for validating local answers against the API tier.

## Two things to know about the response

- **The `searched` flag is deterministic**, not model-reported. It's derived in `api.js` from the API response's tool-use count. This drives the `✓ Searched` vs `~ From memory` indicator. Don't let the model self-report this — that path was tried and abandoned because the model's self-assessment didn't reliably correlate with whether search ran.
- **Model output is JSON**, parsed in `api.js`. The parser strips markdown fences and `<cite>` tags that web_search injects. The expected schema is defined in `prompts/calibration.md` — keep them in sync when changing either.

## Where to make changes

- **Calibration behavior / answer quality:** `prompts/calibration.md` is the primary iteration surface — it's a plain text system prompt fetched at runtime by `background.js`. Changing it needs no code change, just an extension reload. The directional-not-specific constraint lives here and is intentional (see README "Known limitations").
- **What counts as a number:** `lib/detector.js` — regex patterns plus exclusion heuristics (years, versions, phone numbers, dates, ordinals) and skipped DOM tags (links, code, nav, etc.). This is a precision/recall balance; test against real articles when touching it.
- **Whether Ballpark runs on a page at all (Gate 1):** `lib/gates.js` — `evaluatePage(document)` returns `{ run, gate, reason }` via a hardcoded hostname list + heuristics (scoped editability, interactive-control density, prose density), with thresholds as tuned constants at the top of the file. The per-site override (`applyOverride`) is layered in `content.js` from `chrome.storage.local`'s `siteOverrides`. The popup's "This page" panel (`lib/status.js` + `popup.js`) reports the decision and exposes the override. Decision accuracy is guarded by Tier 3 (`test/gates.test.js`). **Gate 2** (also in `lib/gates.js`, `isCommercePage`) suppresses commerce/transactional page archetypes (retail, real-estate, travel, menus) via structured data (JSON-LD `@type`, microdata, `og:type`) plus a small real-estate-SPA hostname net, with an article guard so price-quoting news still runs; it sits in `evaluatePage` between Gate 1's hostname list and Gate 1's heuristics. Gate 3 (per-number triage) is not yet built — see `specs/`.
- **Card appearance/positioning:** `lib/card.js` + `content.css`.
- **API call shape (model, tools, tokens):** `lib/api.js`.