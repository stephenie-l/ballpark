# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ballpark is a Manifest V3 Chrome extension that helps readers calibrate unfamiliar numbers in place. It underlines numbers on a page; clicking one asks Claude (Haiku 4.5, with optional web search) whether the number is large/small/typical for its inferred reference class, then renders a small card next to it. The framing is **calibration, not verification** — the prompt and UI deliberately steer toward directional/relative answers, not fact-checking. See `README.md` for the product rationale.

The extension is published on the Chrome Web Store; end users install it from there with their own Anthropic API key. The workflow below is for developing the source, not for using the shipped extension.

## Developer workflow

There is **no build step, no package manager, and no automated tests** — it's vanilla JS loaded directly into Chrome.

- **Load for development:** `chrome://extensions` → enable Developer mode → Load unpacked → select the repo root.
- **Iterate:** after editing, click the reload icon on the extension card. Content-script changes also need a page reload; background changes take effect on extension reload.
- **API key:** click the toolbar icon and paste an Anthropic key. Stored in `chrome.storage.local`. Without it, every calibration errors.
- **Debug:** content-script logs appear in the page's DevTools console; background/service-worker logs appear via the "service worker" link on the extension card.

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