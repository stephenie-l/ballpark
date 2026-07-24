# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ballpark is a Manifest V3 Chrome extension that helps readers calibrate unfamiliar numbers in place. It underlines numbers on a page; clicking one asks Claude (Haiku 4.5, with optional web search) whether the number is large/small/typical for its inferred reference class, then renders a small card next to it. The framing is **calibration, not verification** — the prompt and UI deliberately steer toward directional/relative answers, not fact-checking. See `README.md` for the product rationale.

The extension is published on the Chrome Web Store; end users install it from there with their own Anthropic API key. Release history: `version` 1.0.0 (first release) → 1.0.1 (live-bug fixes) → **1.1.0** (the first calibration-worthiness redesign release: Gates 1 & 2 + status/override panel + the Tier 3 test layer). As of **2026-06-13**, 1.1.0 is built (`ballpark.zip`, the hand-assembled allowlist of 18 files) and **pending Web Store submission**. The workflow below is for developing the source, not for using the shipped extension.

## Redesign status — Workstream B (calibration-worthiness)

Ballpark is mid-redesign to trigger on a number's **calibration-worthiness**, not its mere presence — via three coarse→fine gates plus a decision-accuracy test layer and a status/override panel. Refer to work by **topic** (e.g. "Gate 3"), not by position ("Spec N") — the build order has shifted, so positional numbers mislead. Canonical IDs are the date-prefixed topic-slug files in `specs/`. Status as of 2026-06-13:

- ✅ **Tier 3 test layer** (decision-accuracy corpus + harness). See `## Testing` below.
- ✅ **Gate 1** (surface exclusion): hostname list + editability / control-density / prose-density heuristics; per-site override; popup "This page" panel.
- ✅ **Gate 2** (commerce page-type): structured data + real-estate hostname net + article guard.
- ⏳ **Gate 3 — NOT BUILT; the next real work.** Per-number triage — the "graspability gap" (`number × scale-word × thing-counted`), cheap-and-local before the API, with a click-time graceful "insufficient context" failure (which also kills the old raw-JSON error). Seed notes (with the perf-eval `fail-003` hedge gap + the detector `$3,500 mixed` → `$3,500 m` bug folded in): `specs/gate3-per-number-triage-notes.md`.

Gates 1 & 2 shipped together as **v1.1.0** (pending Web Store submission). `evaluatePage` funnel order in `lib/gates.js`: Gate 1 hostname list → **Gate 2 commerce** → Gate 1 heuristics. Gates default to suppression when unsure; the override toggle is the safety valve.

**Descoped (2026-06-13): dedicated cost-reduction work.** Measured ~1.1¢/calibration all-in on a BYO-key model (tokens + web_search; the model self-gates search to ~40% of clicks), with most numbers never clicked + cached — reasonable, and never the product risk. The "Planned: local reference layer" section below stays a *parked* direction, not active work; revisit only if cost or latency becomes a felt complaint.

Tuning items (non-blocking): prose density is `<p>`-only (over-suppresses `<div>`-paragraph articles — first candidate); the 15-word verdict cap overshoots ~23% of the time (`prompts/calibration.md` tweak); several Tier 2 fixtures encode absolute-vs-peer reference classes the model reasonably differs on (fixture curation, not bugs).

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
  welcome.html welcome.css welcome.js \
  lib/providers/anthropic.js lib/providers/nano.js lib/providers/gemini.js lib/providers/index.js \
  lib/card.js lib/detector.js lib/gates.js lib/status.js \
  prompts/calibration.md prompts/calibration-nano.md prompts/calibration-gemini.md \
  icons/ballpark_16.png icons/ballpark_48.png icons/ballpark_128.png
unzip -l ballpark.zip   # verify: exactly these 24 files, no .DS_Store
```

Every resubmission needs a bumped `manifest.json` `version` or the Web Store rejects it. README screenshots live in tracked `assets/screenshots/` (so they render on GitHub) — these are separate from the store-listing screenshots, which are uploaded directly in the dashboard.

`manifest.json` `host_permissions` now includes `https://generativelanguage.googleapis.com/*` (piece ④, the Gemini free-cloud fallback) alongside `api.anthropic.com` — the next store submission must justify both in the listing's permission section.

## Testing

Run with `npm test` (Node's built-in runner — no Jest/Vitest, `jsdom` is the only dev dependency). Testing splits into three tiers; keep them separate.

**Tier 1 — deterministic logic (DONE).** `test/detector.test.js` covers `lib/detector.js`. These are **black-box** tests: load the real content-script IIFE into a jsdom DOM via `window.eval`, run `underlineAll`, and assert which numbers came out underlined. They never touch the IIFE's internals, so refactors are safe as long as observable behavior holds. Conventions worth preserving:
- A known bug is recorded as a **`todo` test asserting the *correct* behavior**, never as a passing test that bakes in the buggy output. Flip `todo` → real test when fixing (see the decimal-numbers fix in git history for the pattern).
- The detector is fiddly (regex + exclusion heuristics) and degrades silently, so any change there should run against these cases. Good follow-on coverage if extending: `lib/providers/anthropic.js`'s `parseResponse` is also pure and worth unit-testing the same way.

**Tier 2 — LLM calibration eval (BUILT).** Fixtures live at `test/fixtures/calibration-cases.json` (22 real cases + `_section` separators); the harness is `eval/calibration-eval.mjs`, run with `ANTHROPIC_API_KEY=sk-ant-... npm run eval`. It feeds each fixture's real `{url, number, context}` to the real `calibrate()` (real prompt + model + parser, so it also exercises the `insufficient_context` path) and checks **acceptance criteria**, not exact strings — *structural* (verdict < 15 words, `reference_class` present, 1–2 comparisons, `searched` is boolean) and *directional* (verdict's large/small/typical matches `expected_direction` via the fixture's `verdict_keywords`; `reference_class` mentions an expected-domain keyword). It **prints a report, never throws** — it's an eval, not a gate. It costs real API tokens and is non-deterministic, so it lives **outside `test/`** (so `npm test` never runs it) and is invoked manually when `prompts/calibration.md` or the model changes. To import the real ESM `lib/providers/anthropic.js` from Node, `lib/package.json` marks `lib/` as `type: module` (dev-only; Chrome ignores it, and it's excluded from the packaging allowlist). Known open items from the last run: the model overshoots the 15-word verdict cap ~18% of the time (prompt-tuning candidate), and several fixtures encode opinionated absolute-vs-peer reference classes the model reasonably differs on (fixture-review candidates, not prompt bugs); no fixture yet exercises the truly-nonsensical `insufficient_context` case.

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

Real Gate 1 & Gate 2 logic now lives in `lib/gates.js` (wired into
`manifest.json` + the packaging allowlist), so the corpus asserts the real
decisions: `gate1-*` for surfaces, `gate2-commerce` for commerce pages, `none`
for run-pages. Gate 3 (per-number triage) is **not built** — see the
"Redesign status" section above and `specs/`.

## Two JS execution contexts (the key architectural split)

The manifest loads scripts into two different worlds, and they use different module systems — this is the thing most likely to trip up an edit:

- **Content scripts** (`lib/detector.js`, `lib/card.js`, `content.js`): classic scripts, **no `import`/`export`**. They communicate by attaching globals to `window` (e.g. `window.BallparkDetector`, `window.BallparkCard`). Load order in `manifest.json` is load-bearing: the lib files must come before `content.js`, which consumes their globals.
- **Background** (`background.js`, `lib/providers/index.js`, `lib/providers/anthropic.js`, `lib/providers/nano.js`): ES modules (`"type": "module"` service worker). These use `import`/`export` normally. Content scripts cannot call the Anthropic API directly, so all network calls live here.

Do not add `import` to a content script or `window.` globals to the background — they won't resolve.

## Request flow (high level)

A click on an underlined number sends a message from the content script to the background worker, which checks a cache, then **resolves the active provider and calibrates** if needed, then returns the result for the card to render. Network/inference calls only happen in the background; the content script handles UI.

There is a session-scoped cache between the click handler and the provider call — if a calibration appears to skip work, look there first. Stable answers (real results + insufficient) are cached; transient device states are not.

## Provider architecture (Ballpark 2.0, piece ② — on branch `provider-abstraction` / PR #9)

Calibration is no longer a single hardcoded Anthropic path. It's a **registry of provider modules** under `lib/providers/`, each implementing `calibrate(payload, config) → Result | Insufficient | TypedStatus` and owning its own prompt:

- **`lib/providers/nano.js`** — free **on-device** tier (Gemini Nano, Chrome built-in Prompt API), runs in the MV3 service worker, no key/cost/extra permission. The zero-setup **default**. Surfaces typed `needs-download` / `unavailable` states (rendered as neutral, actionable notes, not errors). `searched:false` always; `provider:'nano'`.
- **`lib/providers/anthropic.js`** — the BYOK **upgrade** tier (Claude Haiku 4.5 + web_search). `provider:'anthropic'`, plus a `model` display label. In the browser it self-loads its prompt via `chrome.runtime.getURL`; Node callers (the eval) inject `config.systemPrompt` instead.
- **`lib/providers/gemini.js`** — the **ungrounded free-cloud fallback** for devices that can't run Nano (piece ④). Current flash model, **no Search grounding** (free tier lacks it → `searched:false` always), `provider:'gemini'` + `model` label. Retries transient `503`; on a persistent `429` daily-cap returns a neutral rate-limited note (honest failure, not a red error). Self-loads its own prompt (`prompts/calibration-gemini.md`); Node callers inject `config.systemPrompt`.
- **`lib/providers/index.js`** — the registry + `resolveProvider(config)`. **Config-only** three-way rule: `activeProvider==='anthropic' && apiKey` → anthropic; `activeProvider==='gemini' && geminiApiKey` → gemini; **else nano**. `lib/status.js`'s `engineState` mirrors this exactly so the popup can't offer a state the dispatcher won't honor. **Mode-selection, honest failure** — exactly one active provider, never a silent swap; the card's provenance line always names what actually answered.

`background.js` is a thin dispatcher (cache → `resolveProvider` → `calibrate` → cache stable answers → route device states; also an `OPEN_PAGE` handler that opens the setup guide, and a read-only `GET_NANO_STATE` handler the popup uses to read on-device availability — the popup is a classic script and can't import the ESM Nano provider). Config lives in `chrome.storage.local`: `activeProvider` (default `'nano'`) + `apiKey`. The **popup's "Calibration engine" toggle** (`popup.js` + `lib/status.js` `engineState`) sets `activeProvider` so a saved key is actually used and users can flip on-device ⇄ key. `lib/api.js` is retired. Adding a provider later = new module + one registry entry (OpenAI/Google/comparison chart are piece ③; onboarding rewrite is piece ④).

### In progress: piece ④ (onboarding rewrite + Nano download consent) — branch `piece-4-onboarding-download`

`nano.js` exposes `download(onProgress)` but **nothing calls it** — so a device that *could*
run Nano has no way to turn it on. Piece ④ makes `welcome.html` adaptive (four screens driven
by `availability()`, with the download running **in the welcome-page tab** because a tab is the
only context durable enough to outlive a multi-minute download — the popup dies on blur, the
MV3 worker after ~30s idle). The pure `state → screen` mapping is `screenForState` in
`lib/status.js`; the popup's "Finish setup" nudge is `nanoNudgeVisible` + `GET_NANO_STATE`.

Scope grew at the UI gate: the approved `unavailable` copy promises free-or-paid keys, which
pulled in a **third provider, Gemini** (previously v2.5). A real-key re-probe (2026-07-20)
settled it: free-tier Search grounding is genuinely unavailable, but **ungrounded** Gemini
works and beats the Nano baseline — so **Gemini ships ungrounded, as the free FALLBACK to
Nano**, surfaced only when Nano is declined / fails / unavailable (Nano first). Web search
stays the paid Anthropic upgrade. The popup is a **two-segment contextual picker** (free
segment = Nano *or* Gemini), and key entry moves entirely to the welcome page.

**Status:** the backend/plumbing (`engineState`, `gemini.js`, `GET_NANO_STATE` +
`geminiApiKey` wiring) is **built, tested (89/89), and committed** on
`piece-4-onboarding-download`. Remaining: **Task 4** (real `welcome.html`/`.js`/`.css` from
the approved v4 mock, incl. the download flow + Gemini-offer surface) and **Task 5** (popup
two-segment + remove key box). Plan, full probe evidence, and the living diagram:
`specs/2026-07-16-onboarding-download-consent-plan.md`, `specs/piece4-flow-diagram.md`;
rationale in `DECISIONS.md` (2026-07-20).

## Planned: local reference layer (NOT YET BUILT — direction)

Goal: add a **third tier between the cache and the API** so common, stable numbers can be calibrated from data we ship in the repo, with **no API call and no web search** — a much lower-cost path. The model/search tier stays the fallback for anything not covered.

Intended flow once built: click → session cache → **local reference lookup** → API (with optional search). Each layer is cheaper than the next; only fall through on a miss.

- **What it is:** a small reference file (e.g. `data/reference.json` or similar) keyed by common industries / number types (salaries, populations, prices, distances, file sizes, etc.) holding the reference class and typical ranges needed to produce a directional verdict locally. Keep it directional-not-specific, consistent with `prompts/calibration.md`.
- **Lookup mechanism:** a matcher that maps a `{number, context}` to a reference-class entry (likely lives alongside `lib/providers/anthropic.js` in the background, since that's where calibration is decided). On a confident match, return a locally-built result; otherwise fall through to the API. Mark the result's provenance so the card can distinguish local vs. API/searched (mirror the existing `searched` indicator pattern).
- **Two mechanisms this needs (open design questions):**
  1. **Updating mechanism** — how reference data is refreshed so it doesn't go stale (manual curation vs. a periodic job that re-derives ranges; versioning the data file; who/what triggers updates).
  2. **Fact-check mechanism** — how we trust an entry before serving it without a search (provenance/source per entry, a verification pass, and a confidence threshold below which we fall through to the API instead of answering locally).

Both are unsolved — treat them as the core of the design, not an afterthought. Tier 2 eval fixtures (`test/fixtures/calibration-cases.json`) are a natural source of regression cases for validating local answers against the API tier.

## Two things to know about the response

- **The `searched` flag is deterministic**, not model-reported. It's derived in `lib/providers/anthropic.js` from the API response's tool-use count. This drives the `✓ Searched` vs `~ From memory` indicator. Don't let the model self-report this — that path was tried and abandoned because the model's self-assessment didn't reliably correlate with whether search ran.
- **Model output is JSON**, parsed in `lib/providers/anthropic.js`. The parser strips markdown fences and `<cite>` tags that web_search injects. The expected schema is defined in `prompts/calibration.md` — keep them in sync when changing either.

## Where to make changes

- **Calibration behavior / answer quality:** `prompts/calibration.md` is the primary iteration surface — it's a plain text system prompt fetched at runtime by `background.js`. Changing it needs no code change, just an extension reload. The directional-not-specific constraint lives here and is intentional (see README "Known limitations").
- **What counts as a number:** `lib/detector.js` — regex patterns plus exclusion heuristics (years, versions, phone numbers, dates, ordinals) and skipped DOM tags (links, code, nav, etc.). This is a precision/recall balance; test against real articles when touching it.
- **Whether Ballpark runs on a page at all (Gate 1):** `lib/gates.js` — `evaluatePage(document)` returns `{ run, gate, reason }` via a hardcoded hostname list + heuristics (scoped editability, interactive-control density, prose density), with thresholds as tuned constants at the top of the file. The per-site override (`applyOverride`) is layered in `content.js` from `chrome.storage.local`'s `siteOverrides`. The popup's "This page" panel (`lib/status.js` + `popup.js`) reports the decision and exposes the override. Decision accuracy is guarded by Tier 3 (`test/gates.test.js`). **Gate 2** (also in `lib/gates.js`, `isCommercePage`) suppresses commerce/transactional page archetypes (retail, real-estate, travel, menus) via structured data (JSON-LD `@type`, microdata, `og:type`) plus a small real-estate-SPA hostname net, with an article guard so price-quoting news still runs; it sits in `evaluatePage` between Gate 1's hostname list and Gate 1's heuristics. Gate 3 (per-number triage) is not yet built — see `specs/`.
- **Card appearance/positioning:** `lib/card.js` + `content.css`.
- **API call shape (model, tools, tokens):** `lib/providers/anthropic.js` (Claude) / `lib/providers/gemini.js` (free cloud fallback).
- **Onboarding / device-state screens / Nano download consent:** `welcome.html` + `welcome.js` (+ `welcome.css`). The pure state→screen mapping is `screenForState` in `lib/status.js`; `failed` and `gemini-offer` are local UI screens `welcome.js` adds on top of the four availability states. Key entry (both providers) lives ONLY on the welcome page, handled by the shared `popup.js` — saving a key also sets `activeProvider`.
- **Popup engine picker / "Finish setup" nudge:** `popup.html` + `popup.js` — two segments `[ free | Claude ]`; the free segment renders Nano *or* Gemini contextually via `engineState().freeEngine` (`lib/status.js`). The nudge is `nanoNudgeVisible` + the worker's `GET_NANO_STATE`.