# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ballpark is a Manifest V3 Chrome extension that helps readers calibrate unfamiliar numbers in place. It underlines numbers on a page; clicking one asks Claude (Haiku 4.5, with optional web search) whether the number is large/small/typical for its inferred reference class, then renders a small card next to it. The framing is **calibration, not verification** — the prompt and UI deliberately steer toward directional/relative answers, not fact-checking. See `README.md` for the product rationale.

The extension is published on the Chrome Web Store; end users install it from there with their own Anthropic API key. The workflow below is for developing the source, not for using the shipped extension.

## Developer workflow

The **shipped extension** has no build step and no runtime dependencies — it's vanilla JS loaded directly into Chrome. There is now a **dev-only** test setup (`package.json` + `jsdom`); nothing from it is loaded into the extension.

- **Load for development:** `chrome://extensions` → enable Developer mode → Load unpacked → select the repo root.
- **Iterate:** after editing, click the reload icon on the extension card. Content-script changes also need a page reload; background changes take effect on extension reload.
- **API key:** click the toolbar icon and paste an Anthropic key. Stored in `chrome.storage.local`. Without it, every calibration errors.
- **Debug:** content-script logs appear in the page's DevTools console; background/service-worker logs appear via the "service worker" link on the extension card.

## Testing

Run with `npm test` (Node's built-in runner — no Jest/Vitest, `jsdom` is the only dev dependency). Testing splits into two tiers with opposite economics; keep them separate.

**Tier 1 — deterministic logic (DONE).** `test/detector.test.js` covers `lib/detector.js`. These are **black-box** tests: load the real content-script IIFE into a jsdom DOM via `window.eval`, run `underlineAll`, and assert which numbers came out underlined. They never touch the IIFE's internals, so refactors are safe as long as observable behavior holds. Conventions worth preserving:
- A known bug is recorded as a **`todo` test asserting the *correct* behavior**, never as a passing test that bakes in the buggy output. Flip `todo` → real test when fixing (see the decimal-numbers fix in git history for the pattern).
- The detector is fiddly (regex + exclusion heuristics) and degrades silently, so any change there should run against these cases. Good follow-on coverage if extending: `api.js`'s `parseResponse` is also pure and worth unit-testing the same way.

**Tier 2 — LLM calibration eval (NOT YET BUILT — pick up here).** The plan: feed real `{url, number, context}` fixtures (a separate test-data file the user will provide) to the real `calibrate()` and check **acceptance criteria**, not exact strings — *structural* (valid JSON, verdict < 15 words, `reference_class` present, 1–2 comparisons, `searched` is boolean) and *directional* (verdict's large/small/typical matches expected; reference class mentions the expected domain). This is an **eval, not a unit test**: it costs real API tokens and is non-deterministic, so it runs manually when `prompts/calibration.md` or the model changes — not on every commit. Use loose assertions (keyword/regex or LLM-as-judge), not `assert.equal`.

## Two JS execution contexts (the key architectural split)

The manifest loads scripts into two different worlds, and they use different module systems — this is the thing most likely to trip up an edit:

- **Content scripts** (`lib/detector.js`, `lib/card.js`, `content.js`): classic scripts, **no `import`/`export`**. They communicate by attaching globals to `window` (e.g. `window.BallparkDetector`, `window.BallparkCard`). Load order in `manifest.json` is load-bearing: the lib files must come before `content.js`, which consumes their globals.
- **Background** (`background.js`, `lib/api.js`): ES modules (`"type": "module"` service worker). These use `import`/`export` normally. Content scripts cannot call the Anthropic API directly, so all network calls live here.

Do not add `import` to a content script or `window.` globals to the background — they won't resolve.

## Request flow (high level)

A click on an underlined number sends a message from the content script to the background worker, which checks a cache, then calls the Anthropic API if needed, then returns the result for the card to render. Network calls only happen in the background; the content script handles UI.

There is a session-scoped cache between the click handler and the API call — if a calibration appears to skip the API, look there first.

## Two things to know about the response

- **The `searched` flag is deterministic**, not model-reported. It's derived in `api.js` from the API response's tool-use count. This drives the `✓ Searched` vs `~ From memory` indicator. Don't let the model self-report this — that path was tried and abandoned because the model's self-assessment didn't reliably correlate with whether search ran.
- **Model output is JSON**, parsed in `api.js`. The parser strips markdown fences and `<cite>` tags that web_search injects. The expected schema is defined in `prompts/calibration.md` — keep them in sync when changing either.

## Where to make changes

- **Calibration behavior / answer quality:** `prompts/calibration.md` is the primary iteration surface — it's a plain text system prompt fetched at runtime by `background.js`. Changing it needs no code change, just an extension reload. The directional-not-specific constraint lives here and is intentional (see README "Known limitations").
- **What counts as a number:** `lib/detector.js` — regex patterns plus exclusion heuristics (years, versions, phone numbers, dates, ordinals) and skipped DOM tags (links, code, nav, etc.). This is a precision/recall balance; test against real articles when touching it.
- **Card appearance/positioning:** `lib/card.js` + `content.css`.
- **API call shape (model, tools, tokens):** `lib/api.js`.