# Onboarding Rewrite + Nano Download-Consent UI (Ballpark 2.0, piece ④) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `welcome.html` to the free-on-device-default story and wire the real one-time Nano download-consent flow (the `download(onProgress)` hook that ships but is never called), plus a state-aware "Finish setup" nudge in the popup.

> **REVISION 2026-07-20 (Gemini blocker resolved → ungrounded free FALLBACK; two-segment popup).**
> A real free-tier key resolved Task 2c's block. Findings: Google migrated key format to `AQ.`
> "auth keys" (the July `AQ.` "confound" was a red herring — already a normal key); free-tier
> **Search grounding is genuinely unavailable** (pricing page "Not available"; `google_search` →
> `429`/`404` while plain calls 200); but **ungrounded** free Gemini works and, on 15/22
> calibration fixtures, **beat the Nano baseline** (structural 99% vs 97%, directional 87% vs 82%).
> **Decision (Stephenie): keep Gemini as an ungrounded free FALLBACK to Nano**, sequenced — Nano
> first; Gemini surfaced only on **decline / failed / unavailable**. Consequences vs the 07-19 plan:
> - **Task 2c UNBLOCKED**, but Gemini is **ungrounded** (`searched:false`, no grounding tool) + must
>   handle free-tier `503`/daily-cap `429` as graceful notes.
> - **Task 2b shrinks**: NOT a three-engine `engineState`. The popup stays a **two-segment picker**
>   `[ free | Claude ]` whose free segment renders Nano *or* Gemini contextually. Free-engine rule:
>   **Nano if usable, else Gemini if a key is saved.** Net simplification vs the three-engine control.
> - **Task 4/5 copy changes** (decline line, Gemini-offer surface, failed→Gemini fallback) → a
>   **UI re-gate** on the changed surfaces before build. See `specs/piece4-flow-diagram.md`.
>
> **REVISION 2026-07-19 (post-UI-gate).** Stephenie approved the Task 1 mock with edits, and one edit **broke the original scope fence**: the `unavailable` screen now points at *"free or paid models via API keys"*, which requires a **real Gemini provider** — previously deferred to v2.5. Gemini is therefore **pulled into ④**. Consequences: two new tasks (**2b** ~~three-engine~~ *(→ two-segment contextual, see 07-20)* `engineState`, **2c** the Gemini provider), and Task 5 grows a ~~**three-engine**~~ *two-segment contextual* popup control (a new UI surface → needs its own UI gate). Tasks 2 and 3 are **DONE** as of this revision (68/68 tests green, uncommitted, on branch `piece-4-onboarding-download`).
>
> ~~**Verified fact that drives the Gemini model choice:** Grounding with Google Search is **free up to 500 RPD on `gemini-2.5-flash`**...~~ **SUPERSEDED same day — see the 🛑 block in Task 2c.** The live probe found `gemini-2.5-flash` is closed to new keys and grounding 404s on every current model. Task 2c is **blocked** pending a re-probe with a real `AIza` key. Documentation said one thing; the API said another.

**Architecture:** The welcome page becomes adaptive: on load it reads `availability()` and shows exactly one of four state screens (ready / consent / downloading / unavailable). The download runs **in the welcome-page tab** (a durable context — unlike the popup or the MV3 worker, a tab lives as long as it's open), via a new `welcome.js` ES module that imports the real `{ availability, download }` from `lib/providers/nano.js` (single source of truth). The pure `state → screen` mapping lives in `lib/status.js` and is unit-tested; the popup nudge reads on-device state through a tiny `GET_NANO_STATE` message to the background worker.

**Tech Stack:** Vanilla JS, no build, no new runtime deps, no new manifest permissions. `welcome.js` + `lib/providers/*` + `background.js` are ES modules; `popup.js` + `lib/status.js` are classic scripts. Tests: Node's built-in runner (`node --test`); `jsdom` only dev dep.

## Global Constraints

- **Audience-first (load-bearing):** the target user is the *least* technical audience. Every screen and word must be clear and un-intimidating — nothing that reads as "too technical/fancy for me." No jargon ("model", "inference", "GB", "service worker") in user-facing copy.
- **The green "ready" screen is the ONLY element that says "safe to close this tab."** It is the explicit green light the user asked for. No other screen tells the user it's safe to close.
- **Detect-before-prompt:** `availability()` returns `'available'` when the model is already downloaded; anyone already set up never sees a download step.
- **`availability()` states (exact):** `'available'` | `'downloadable'` | `'downloading'` | `'unavailable'`. Unknown/undefined → treat as `'unavailable'` (honest fallback).
- **Two execution contexts.** `welcome.js` is an ES **module** on an extension *page* (may `import` + use `chrome`/`document`/`window`). `popup.js` and `lib/status.js` are **classic** scripts (`window.` globals, no `import`). `background.js` + `lib/providers/*` are ES modules. Do not cross these.
- **`welcome.html` load order (load-bearing):** `lib/status.js` (classic, sets `window.BallparkStatus`) → `popup.js` (classic, shared key-save) → `welcome.js` (module, reads `window.BallparkStatus`). Modules are deferred, so `welcome.js` runs after both classic scripts and after DOM parse.
- **Reuse, don't duplicate:** the BYOK key-save on the welcome page stays in the shared `popup.js` (its engine/status blocks are already guarded to no-op there). `welcome.js` owns only the on-device state block. `nano.js`'s `download(onProgress)` is consumed **as-is** — do not change its shape.
- **No new runtime dependencies. No new `manifest.json` permissions.**
- **Tests must stay green:** `test/detector.test.js`, `test/gates.test.js`, `test/status.test.js`, `test/providers.test.mjs`.
- **Commits:** each task ends with a commit step, but **do not commit until Stephenie explicitly approves** (her hard rule), and **stop after each task** so she can test. Keep each logical change in its own commit; never bundle. Piece ④ work happens on a **fresh branch off `main`** (`provider-abstraction` is already merged) — create it before Task 2's commit.
- **Transparency on the consent screen (added at the UI gate, load-bearing):** State 2 must name **Gemini Nano / Google**, say plainly that a **model is downloaded to the user's computer**, give the **size (~4 GB)** and Chrome's **22 GB free-space requirement**, and promise **we check the device first** (many machines already have it — Chrome has shipped it since 2024). This is the one screen where concrete numbers beat the no-jargon rule; Stephenie asked for it explicitly. Do not soften it back into vagueness.
- **Chrome deletes the model if free space later drops below 10 GB.** Deliberately **not** mentioned in the copy (decided at the gate) — if it happens, the user simply sees State 2 again, which is self-explanatory.
- **Scope fence — explicitly NOT in ④:** the provider comparison chart (piece ③); providers beyond nano/anthropic/gemini; any popup redesign beyond the nudge + the three-engine control; changing `download(onProgress)`. ~~the v2.5 free-Gemini-key path~~ — **pulled INTO ④** at the UI gate (see the revision note above).

## File Structure

- **Create `welcome.js`** — ES module; the welcome page's on-device state machine + download orchestration. Imports `availability`, `download` from `lib/providers/nano.js`; reads `window.BallparkStatus.screenForState`.
- **Modify `welcome.html`** — full reframe: free-default hero, four state-screen sections, kept "pin to toolbar" tip, reframed BYOK upgrade section; new script tags.
- **Modify `welcome.css`** — styles for the four screens, progress bar, green ready panel, retry.
- **Modify `lib/status.js`** — add pure `screenForState(state)` and `nanoNudgeVisible({...})`; extend `engineState` to the contextual free slot (`freeEngine` + `enabled`) for the two-segment popup (Task 2b).
- **Modify `test/status.test.js`** — unit tests for the new helpers.
- **Create `lib/providers/gemini.js`** — third provider: a current flash model, **ungrounded** (`searched:false` always, no grounding tool), with free-tier `503`/daily-cap `429` handled as neutral notes (Task 2c).
- **Create `prompts/calibration-gemini.md`** — Gemini's own prompt (each provider owns its prompt, per the ② architecture).
- **Modify `lib/providers/index.js`** — register `gemini`; extend `resolveProvider` to a three-way rule with a second key.
- **Modify `test/providers.test.mjs`** — resolveProvider + Gemini parser coverage.
- **Modify `background.js`** — add the `GET_NANO_STATE` message handler.
- **Modify `popup.html`** — add the hidden nudge element.
- **Modify `popup.js`** — query `GET_NANO_STATE`, show/hide the nudge via `nanoNudgeVisible`.
- **Modify `popup.css`** — nudge link style.
- **Modify `CLAUDE.md` + `AGENTS.md`** — packaging allowlist (+`welcome.js`), file count, "Where to make changes".

---

### Task 1: UI GATE — mock the four state screens + popup nudge (no production code) — ✅ DONE (approved 2026-07-19)

> **APPROVED WITH EDITS.** Mock preserved at `docs/piece4-mock/welcome-states-mock.html` (gitignored). The **approved copy is transcribed into Task 4 Step 1 below** — that HTML, not the original draft copy in this task, is the source of truth. Stephenie's edits were:
> 1. **State 2** — must name Gemini Nano/Google, disclose the download + ~4 GB size + 22 GB requirement, and lead with "we check your device first / no re-download."
> 2. **State 3b** — the failure variant read as still-in-progress. Now a distinct **amber card** (`--failed`) with a `!` badge, the failure stated in the `<h2>`, an amber bar, and a "progress is saved" reassurance.
> 3. **State 4** — no explicit Anthropic mention: *"Ballpark also works with free or paid models via API keys. See how to add one below (~2 min)."*
> 4. **Key section** — split into two labelled options, **Gemini (Free tier)** and **Anthropic (Pay per use)**. This is what pulled Gemini into ④.

Per Stephenie's UI gate, before building any welcome-page surface she hasn't seen, show a disposable mock and get approval. This task produces a throwaway HTML mock and **stops** for her review. Nothing here ships.

**Files:**
- Create (throwaway, scratchpad): `<scratchpad>/welcome-states-mock.html`

- [ ] **Step 1: Build a static mock of the four state screens + the popup nudge**

In the scratchpad, reuse `welcome.css` + `popup.css` for fidelity and render, stacked on one page (all visible at once, labelled), mock versions of:
1. **`ready`** (green light) — a green ✓ panel: "**You're all set.** Ballpark is working right now — free, and private to your device. **You can close this tab.**" Below: "Open any article and click an underlined number."
2. **`consent`** — headline "**Turn on Ballpark's free calibrator**", body "A one-time setup so numbers can be checked right on your device — no account, no payment, nothing to sign up for.", a **[Turn it on]** primary button, and a small "Keep this tab open once it starts — it only takes a minute" hint.
3. **`downloading`** — "**Setting up Ballpark…**", a progress bar at ~45%, "45%", and the line "**Keep this tab open until the green checkmark appears.**" Include the hidden→shown retry variant beside it: "Setup didn't finish. **[Try again]**".
4. **`unavailable`** — "**This device can't run the free on-device version**", body "No problem — Ballpark still works with an Anthropic API key (you'll add one just below).", pointing down to the BYOK section.
5. **Popup nudge** (render a 300px-wide popup slice) — the on-device segment selected, with a one-line "**Finish setup →**" link beneath the engine toggle.

Use plain, warm copy — no "model", "inference", "GB", or "service worker".

- [ ] **Step 2: Screenshot the mock and present it to Stephenie for approval**

Present all five states in one batch with a one-line caption each (desktop; the welcome page is desktop-only). **STOP.** Do not proceed to Task 2 until she approves the copy, the green-light treatment, and the nudge. If she gives edits, apply them to the mock and re-confirm first. The approved copy/structure is the source of truth for Tasks 4–5.

---

### Task 2: Pure helpers `screenForState` + `nanoNudgeVisible` (`lib/status.js`) — ✅ DONE 2026-07-19 (uncommitted)

The two pure functions the UI hangs on: the state→screen mapper (welcome page) and the nudge-visibility predicate (popup). Both are pure and unit-tested in Node — no browser needed. This is backend-shaped work; no UI gate.

**Files:**
- Modify: `lib/status.js`
- Modify: `test/status.test.js`

**Interfaces:**
- Produces: `screenForState(state: string) → 'ready'|'consent'|'downloading'|'unavailable'`; `nanoNudgeVisible({ apiKey?, activeProvider?, nanoState? }) → boolean`. Both hang off `window.BallparkStatus`.
- Consumes: the existing `engineState` (same file) for the nudge's active-provider check.

- [ ] **Step 1: Write the failing tests**

Append to `test/status.test.js`:

```js
test('screenForState: maps each availability state to its screen', () => {
  const { screenForState } = load();
  assert.equal(screenForState('available'), 'ready');
  assert.equal(screenForState('downloadable'), 'consent');
  assert.equal(screenForState('downloading'), 'downloading');
  assert.equal(screenForState('unavailable'), 'unavailable');
});

test('screenForState: unknown/undefined → unavailable (honest fallback)', () => {
  const { screenForState } = load();
  assert.equal(screenForState('wat'), 'unavailable');
  assert.equal(screenForState(undefined), 'unavailable');
});

test('nanoNudgeVisible: on-device active + model not ready → show', () => {
  const { nanoNudgeVisible } = load();
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: 'downloadable' }), true);
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: 'downloading' }), true);
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: 'unavailable' }), true);
});

test('nanoNudgeVisible: model ready → hide (nothing to finish)', () => {
  const { nanoNudgeVisible } = load();
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: 'available' }), false);
});

test('nanoNudgeVisible: on the Anthropic engine → hide', () => {
  const { nanoNudgeVisible } = load();
  // anthropic active (key present) → not a Nano concern
  assert.equal(nanoNudgeVisible({ activeProvider: 'anthropic', apiKey: 'sk-x', nanoState: 'downloadable' }), false);
});

test('nanoNudgeVisible: unknown Nano state → hide (no false alarm)', () => {
  const { nanoNudgeVisible } = load();
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: null }), false);
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano' }), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `screenForState`/`nanoNudgeVisible` are `undefined` (not exported yet).

- [ ] **Step 3: Implement the helpers in `lib/status.js`**

Insert both functions inside the IIFE, after `engineState` (before the `window.BallparkStatus = …` line):

```js
  // Which onboarding screen a Nano availability() state maps to. Pure, so the
  // welcome page's render dispatch is unit-testable without a browser. Unknown
  // states fall back to the honest 'unavailable' screen.
  function screenForState(state) {
    switch (state) {
      case 'available': return 'ready';
      case 'downloadable': return 'consent';
      case 'downloading': return 'downloading';
      case 'unavailable': return 'unavailable';
      default: return 'unavailable';
    }
  }

  // Whether the popup's "Finish setup →" nudge should show: only when the free
  // on-device engine is the active one AND the model isn't ready yet. If the
  // user is on the Anthropic engine, or Nano is already 'available', or its
  // state is unknown, there's nothing to nudge about. nanoState is
  // availability()'s string, or null/undefined if we couldn't read it.
  function nanoNudgeVisible({ apiKey, activeProvider, nanoState } = {}) {
    const { active } = engineState({ apiKey, activeProvider });
    return active === 'nano' && nanoState != null && nanoState !== 'available';
  }
```

Update the export line:

```js
  window.BallparkStatus = { formatStatus, nextOverrideAction, engineState, screenForState, nanoNudgeVisible };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the new cases plus all existing status/detector/gates/providers suites green.

- [ ] **Step 5: Create the piece-④ branch, then commit** (after Stephenie's OK)

```bash
git checkout main && git pull
git checkout -b piece-4-onboarding-download
git add lib/status.js test/status.test.js
git commit -m "feat: add screenForState + nanoNudgeVisible pure helpers for piece ④"
```

---

### Task 2b: `engineState` → contextual free slot (`lib/status.js`)

> **REVISED 2026-07-20.** NOT a three-engine widening. Under the hood there are three
> resolvable providers (nano/gemini/anthropic), but the **popup renders two segments**
> `[ free | Claude ]` — Nano and Gemini are mutually exclusive free engines, so the *free*
> segment is contextual (renders Nano *or* Gemini, never both). `engineState` therefore must
> expose **which free engine is active** in addition to the active provider, so Task 5 can
> render one free segment correctly. Pure logic, TDD, no UI gate. Still mirrors
> `resolveProvider` exactly — the popup must never offer a state the dispatcher won't honor.

**Free-engine rule (load-bearing, SETTLED at build 2026-07-20):** **config-only** —
`activeProvider` is the source of truth, mirroring `resolveProvider` exactly (a sync resolver
can't check live `availability()`, so `engineState` must not either). `active` = Anthropic if
selected+keyed, else Gemini if selected+keyed, else Nano. `freeEngine` = `active` when a free
engine is active (never mislabel the lit segment); when Claude is active, the dormant label —
Gemini if a Gemini key is saved, else Nano. *(The earlier "Nano wins via `nanoState`" idea was
dropped — it can't be mirrored by the sync resolver. `nanoState` stays only in `nanoNudgeVisible`,
for the model-not-ready check.)*

**Files:** Modify `lib/status.js`, `test/status.test.js` — ✅ DONE (89/89 green, uncommitted).

**Interfaces (as shipped):**
- `engineState({ apiKey, geminiApiKey, activeProvider }) → { active: 'nano'|'gemini'|'anthropic', freeEngine: 'nano'|'gemini', enabled: { anthropic: boolean, gemini: boolean } }`
  - `freeEngine` = what the single free segment renders/labels; `active` = the resolved provider.
  - Free segment is `.on` when `active ∈ {nano, gemini}`; the Claude segment is `.on` when `active === 'anthropic'`.
- **Breaking:** the old `keyEnabled` field is replaced by `enabled.anthropic`. `popup.js` is the only consumer — update it in Task 5. Grep for `keyEnabled` before finishing.
- `nanoNudgeVisible` keeps working unchanged (it only reads `active === 'nano'`), but its tests must gain a Gemini case.

> The test snippets below still exercise the resolver (gemini can be `active`; `enabled.gemini`),
> but ADD cases for `freeEngine` and the "Nano wins when `nanoState==='available'` even with a
> Gemini key" rule. Reframe as needed — the popup is two-segment, not three.

- [ ] **Step 1: Write the failing tests** (append to `test/status.test.js`)

```js
test('engineState: gemini selected + gemini key → gemini active', () => {
  const { engineState } = load();
  const r = engineState({ geminiApiKey: 'AIza-x', activeProvider: 'gemini' });
  assert.equal(r.active, 'gemini');
  assert.equal(r.enabled.gemini, true);
});

test('engineState: gemini selected but no gemini key → nano (mirrors resolveProvider)', () => {
  const { engineState } = load();
  const r = engineState({ activeProvider: 'gemini' });
  assert.equal(r.active, 'nano');
  assert.equal(r.enabled.gemini, false);
});

test('engineState: an anthropic key does NOT enable the gemini segment (keys are independent)', () => {
  const { engineState } = load();
  const r = engineState({ apiKey: 'sk-x', activeProvider: 'gemini' });
  assert.equal(r.active, 'nano');       // wrong key for the selected engine
  assert.equal(r.enabled.anthropic, true);
  assert.equal(r.enabled.gemini, false);
});

test('engineState: both keys present, gemini selected → gemini active', () => {
  const { engineState } = load();
  const r = engineState({ apiKey: 'sk-x', geminiApiKey: 'AIza-x', activeProvider: 'gemini' });
  assert.equal(r.active, 'gemini');
});

test('nanoNudgeVisible: on the Gemini engine → hide', () => {
  const { nanoNudgeVisible } = load();
  assert.equal(nanoNudgeVisible({ activeProvider: 'gemini', geminiApiKey: 'AIza-x', nanoState: 'downloadable' }), false);
});
```

Also **update the four existing `engineState` tests** to assert `enabled.anthropic` instead of `keyEnabled`.

- [ ] **Step 2: Run and verify RED.** `npm test` → FAIL (`r.enabled` undefined).

- [ ] **Step 3: Implement.** Replace `engineState`; `nanoNudgeVisible` must forward `geminiApiKey` through to it.

- [ ] **Step 4: Verify GREEN.** `npm test` → all pass. Then `grep -rn "keyEnabled" .` — expect hits only in `popup.js` (fixed in Task 5).

- [ ] **Step 5: Commit** (after Stephenie's OK)

```bash
git add lib/status.js test/status.test.js
git commit -m "feat: widen engineState to three calibration engines"
```

---

### Task 2c: Gemini provider (`lib/providers/gemini.js` + registry)

The third provider, and the one that makes the `unavailable` screen's promise real: a **free-tier** cloud model **with web grounding**. Implements the same `calibrate(payload, config)` contract as the other two, owns its own prompt, and sets `searched` deterministically.

> ✅ **UNBLOCKED — 2026-07-20 (real free-tier key). Gemini ships UNGROUNDED.**
>
> Probe findings (full evidence in `specs/piece4-flow-diagram.md` and DECISIONS.md 2026-07-20):
> 1. **Key format changed:** Google migrated `AIza` → `AQ.` "auth keys". The July `AQ.` "confound"
>    was a red herring — that was already a valid key. Auth is unchanged (`x-goog-api-key` header).
> 2. **Free-tier grounding is genuinely unavailable.** Pricing page: "Not available" on every model.
>    Live: the `google_search` tool → `429 RESOURCE_EXHAUSTED` (a *quota-zero* wall, not the old 404),
>    while plain `generateContent` returns 200. `gemini-2.5-flash` still 404s for new keys.
> 3. **Ungrounded free Gemini works and is good.** Same 22 fixtures / same scorer / same no-search
>    prompt as the Nano spike: on the 15 that ran before the daily cap, **structural 99%, directional
>    87%** — above the Nano baseline (97% / 82%). Both clear the go bars comfortably.
>
> **Decision (Stephenie): keep Gemini as an ungrounded free FALLBACK to Nano.** No grounding tool;
> `searched:false` always. Web search stays the paid Anthropic upgrade. This is a clean fit — the
> product is "calibration, not verification," and the free tier (Nano) never searched anyway.

**Files:** Create `lib/providers/gemini.js`, `prompts/calibration-gemini.md`; modify `lib/providers/index.js`, `test/providers.test.mjs`

**Interfaces:**
- Produces: `calibrate(payload, config) → Result | Insufficient | TypedStatus`, with `provider: 'gemini'` and a `model` display label (mirrors `anthropic.js`).
- Consumes: `config.geminiApiKey`; `config.systemPrompt` when injected by Node callers (browser self-loads via `chrome.runtime.getURL`).
- `resolveProvider` gains the free-slot rule: `activeProvider === 'anthropic' && apiKey → anthropic`; else **free engine = Nano if usable, else Gemini if `geminiApiKey`** (mirrors `engineState`, Task 2b). Gemini is reached as the free fallback, not a co-equal selection.

**Pinned decisions (revised 2026-07-20 — ungrounded):**
- **Model: a current flash.** NOT `gemini-2.5-flash` (404s for new keys). The probe ran on
  `gemini-3-flash-preview` / `gemini-flash-latest`; **pin the stable alias at build** (prefer a
  non-preview id). Confirm it answers a plain call on a fresh free key first.
- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`, key in the `x-goog-api-key` header (not the query string — keeps it out of logs/history).
- **NO grounding tool.** Do not send `tools: [{ google_search: {} }]` — free tier 429s it. JSON via `generationConfig.responseMimeType: 'application/json'`.
- **`searched: false` always** (the ② deterministic rule, trivially satisfied — Gemini free never searches). `provider: 'gemini'` + a `model` display label, mirroring `anthropic.js`.
- **Free-tier flakiness handling (required):** retry `503` "high demand" with backoff; on `429`-after-retries (the daily cap), return a **neutral TypedStatus note** ("free daily limit reached — try tomorrow or add a paid key"), NOT a red error. The eval hit both; this is honest-failure for a flaky free tier.
- **Host permission?** — VERIFY: `manifest.json` may need `https://generativelanguage.googleapis.com/*`. Check before Task 6; the "no new permissions" constraint is **waived** if required, but flag it to Stephenie (changes the Web Store review surface).

- [x] **Step 0: Probe free-tier grounding + ungrounded quality** — ✅ DONE 2026-07-20.
  Throwaway probes (`<scratchpad>/gemini-probe*.mjs`, `gemini-eval.mjs`) confirmed: grounding
  unavailable (429), ungrounded quality ≥ Nano (99%/87% on 15/22). Evidence in the flow diagram
  + DECISIONS.md. Delete scratchpad probes at wrap.

- [ ] **Step 1: Write `prompts/calibration-gemini.md`** — start from `prompts/calibration.md`; keep the same JSON schema so the card renders identically.

- [ ] **Step 2: Write failing parser tests** in `test/providers.test.mjs` — `parseResponse` is pure (same treatment as Anthropic's): valid JSON, fenced JSON, prose-prefaced JSON, malformed → neutral degrade, `insufficient_context`. Plus `resolveProvider` three-way tests.

- [ ] **Step 3: Verify RED**, then implement `gemini.js` + the registry entry, then **verify GREEN** (`npm test`).

- [ ] **Step 4: Live check** — one real calibration through the provider with the free key; confirm `searched: true` on a fact-needing number and that the card's provenance line names Gemini.

- [ ] **Step 5: Commit** (after Stephenie's OK)

```bash
git add lib/providers/gemini.js lib/providers/index.js prompts/calibration-gemini.md test/providers.test.mjs
git commit -m "feat: add Gemini free-tier provider with search grounding"
```

---

### Task 3: `GET_NANO_STATE` handler (`background.js`) — ✅ DONE 2026-07-19 (uncommitted)

The popup is a classic script and can't `import` the ESM Nano provider, so it asks the worker for the current on-device state. The worker owns `nano.js`, keeping it authoritative.

**Files:**
- Modify: `background.js`

**Interfaces:**
- Produces: a message handler for `{ type: 'GET_NANO_STATE' }` that responds `{ state }` where `state` is `availability()`'s string (or `'unavailable'` on error).
- Consumes: `providers.nano.availability()` from `lib/providers/index.js`.

- [ ] **Step 1: Widen the providers import**

Change the top import in `background.js`:

```js
import { resolveProvider, providers } from './lib/providers/index.js';
```

- [ ] **Step 2: Add the handler (below the `OPEN_PAGE` listener)**

```js
// The popup can't import the ESM Nano provider (it's a classic script), so it
// asks the worker for the current on-device availability to decide whether to
// show its "Finish setup" nudge. Read-only; never throws to the caller.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'GET_NANO_STATE') return false;
  providers.nano.availability()
    .then((state) => sendResponse({ state }))
    .catch(() => sendResponse({ state: 'unavailable' }));
  return true; // async response — keep the channel open
});
```

- [ ] **Step 3: Syntax-check + tests**

Run: `node --check background.js && npm test`
Expected: `node --check` prints nothing (valid syntax); `npm test` PASS (unchanged — background.js isn't loaded by the suite).

- [ ] **Step 4: Commit** (after Stephenie's OK)

```bash
git add background.js
git commit -m "feat: add GET_NANO_STATE message handler for the popup nudge"
```

---

### Task 4: Reframe `welcome.html` + `welcome.css`; build `welcome.js` (adaptive states + download)

> **REVISED 2026-07-20 — builds against the Task 1b RE-MOCK, not the original Task 1 mock.**
> The HTML/copy blocks below predate the Gemini-fallback decision and are now a **starting point,
> not the source of truth**. The re-gate (Task 1b) settles the final copy for the changed surfaces:
> - **Consent screen** gains a light, small **italic decline line under `[Turn it on]`**:
>   *"Not now — try the free cloud version instead."* → routes to the Gemini offer.
> - **New shared "Gemini offer" surface** (reached from decline / `unavailable` / failed): warm
>   caveats — **no web search, a daily limit** — but still free; walks the user to a free
>   `aistudio.google.com/apikey` key (`AIza`/`AQ.`) and saves it via the Gemini key handler (Task 5).
> - **Failed-download amber screen** gains an "or use the free cloud version" fallback to that offer.
> - **`unavailable` screen** points at the Gemini offer (not a bare "add a key").
> - The flat two-option key section (Gemini/Anthropic as peers) is **replaced** by this sequenced
>   model: Gemini is the free fallback surfaced by state; Anthropic is the always-available upgrade.
> New `welcome.js` screens/IDs: add `screen-gemini-offer`; the decline + "use free cloud" buttons
> route to it. `screenForState` is unchanged (Gemini-offer, like `failed`, is a local UI screen).

The centerpiece. Builds against the **Task 1b re-mock** — the copy and visual details below mirror the *original* mock; adjust to match the re-gate. Full reframe from key-first to free-on-device-default, with the live download flow.

**Files:**
- Create: `welcome.js`
- Modify: `welcome.html`
- Modify: `welcome.css`

**Interfaces:**
- Consumes: `screenForState` (Task 2, via `window.BallparkStatus`); `availability`, `download` from `lib/providers/nano.js`.
- Element IDs `welcome.js` depends on (must exist in `welcome.html`): `screen-ready`, `screen-consent`, `screen-downloading`, `screen-failed`, `screen-unavailable`, `turn-on-btn`, `progress-fill`, `progress-pct`, `retry-btn`.
- **Note:** `failed` is a **screen**, not a state — `availability()` never returns it. It's a local UI state the download's `catch` sets, so `screenForState` (Task 2) is unchanged and its tests stay valid.

- [ ] **Step 1: Rewrite `welcome.html`**

Replace the `<ol class="steps">…</ol>` block and the closing `<script>` with the reframed structure. New `<body>`:

```html
<body>
  <main class="page">
    <header class="hero">
      <img src="icons/ballpark_128.png" alt="" class="logo" width="56" height="56" />
      <h1>Start using <span class="brand">Ballpark</span></h1>
      <p class="tagline">
        Calibrate unfamiliar numbers as you read. Ballpark underlines figures on
        any page — click one to see whether it's <em>large</em>, <em>small</em>,
        or <em>typical</em> for its context. <strong>Free, and private to your device.</strong>
      </p>
    </header>

    <!-- On-device state block — welcome.js shows exactly one of these. -->
    <section class="state-block">
      <div class="state-card state-card--ready" id="screen-ready" hidden>
        <div class="state-badge state-badge--ok">✓</div>
        <h2>You're all set</h2>
        <p>Ballpark is working right now — free, and private to your device. <strong>You can close this tab.</strong></p>
        <p class="state-sub">Open any article and click an <span class="demo-underline">underlined number</span> to calibrate it.</p>
      </div>

      <div class="state-card" id="screen-consent" hidden>
        <h2>Turn on Ballpark's free calibrator</h2>
        <p>Ballpark's free tier runs <strong>Gemini Nano</strong>, a small Google AI model built into Chrome that runs <strong>entirely on your computer</strong> — no account, no payment, and nothing you read is sent anywhere.</p>
        <ul class="facts">
          <li><strong>We check your device first.</strong> Chrome ships this model to many computers already — if yours has it, nothing downloads and you're set in seconds.</li>
          <li>If it isn't there yet, turning it on downloads it once — <strong>about 4&nbsp;GB</strong>. Chrome needs <strong>22&nbsp;GB free</strong> to store it, and won't start otherwise.</li>
          <li>It's downloaded once, not per use. Chrome handles updates from then on.</li>
        </ul>
        <button type="button" class="primary-btn" id="turn-on-btn">Turn it on</button>
        <p class="state-sub">Keep this tab open while it downloads — usually a minute or two on a fast connection.</p>
      </div>

      <div class="state-card" id="screen-downloading" hidden>
        <h2>Setting up Ballpark…</h2>
        <div class="progress" id="progress"><div class="progress-fill" id="progress-fill"></div></div>
        <p class="progress-pct" id="progress-pct">Setting up…</p>
        <p class="state-sub">Keep this tab open until the green checkmark appears.</p>
      </div>

      <!-- Failure is its own AMBER card, not a red line inside the progress card:
           at the gate the old inline variant read as "still in progress". -->
      <div class="state-card state-card--failed" id="screen-failed" hidden>
        <div class="state-badge state-badge--warn">!</div>
        <h2>Setup didn't finish</h2>
        <div class="progress"><div class="progress-fill progress-fill--stalled" id="failed-fill"></div></div>
        <p class="state-sub">The download stopped partway. Your progress is saved — trying again picks up where it left off.</p>
        <div class="download-retry">
          <button type="button" class="primary-btn" id="retry-btn">Try again</button>
        </div>
      </div>

      <div class="state-card" id="screen-unavailable" hidden>
        <h2>This device can't run the free on-device version</h2>
        <p>Ballpark also works with free or paid models via API keys. See how to add one below (~2&nbsp;min).</p>
      </div>
    </section>

    <!-- API-key options — optional for everyone, essential for `unavailable`.
         Anthropic key-save is handled by the shared popup.js; the Gemini field
         is wired in Task 2c/5. -->
    <section class="upgrade">
      <h2>Use a model via API key</h2>
      <p class="upgrade-text">
        An API key connects Ballpark to a cloud model with <strong>live web search</strong>
        — better for numbers that need a looked-up fact. Either option works; you
        can change it later.
      </p>

      <div class="keyopt">
        <div class="keyopt-head"><span class="pill pill--free">Free tier</span><h3>Google Gemini</h3></div>
        <p class="keyopt-text">Google's free API tier — a Google account, usually no credit card. Good starting point if this device can't run the on-device version.</p>
        <div class="input-row">
          <input type="password" id="gemini-key" placeholder="AIza..." autocomplete="off" spellcheck="false" />
          <button id="save-gemini-btn">Save key</button>
        </div>
        <p class="hint" id="save-gemini-status"></p>
        <p class="hint">
          Don't have one?
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get a free Gemini key →</a>
          It starts with <code>AIza</code>.
        </p>
      </div>

      <div class="keyopt">
        <div class="keyopt-head"><span class="pill pill--paid">Pay per use</span><h3>Anthropic Claude</h3></div>
        <p class="keyopt-text">Claude Haiku 4.5 with web search. Requires a card; you pay Anthropic only for what you use — typically a fraction of a cent per calibration.</p>
        <div class="input-row">
          <input type="password" id="api-key" placeholder="sk-ant-..." autocomplete="off" spellcheck="false" />
          <button id="save-btn">Save key</button>
        </div>
        <p class="hint" id="save-status"></p>
        <p class="hint">
          Don't have one?
          <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Create an Anthropic key →</a>
          (sign in, then <em>Create Key</em>). It starts with <code>sk-ant-</code>.
        </p>
      </div>
    </section>

    <!-- Kept from the old page — still useful. -->
    <section class="pin-tip">
      <h2>Pin Ballpark to your toolbar</h2>
      <p>So you can reopen these settings anytime: click the <strong>puzzle-piece icon</strong>
      (Extensions) at Chrome's top-right, then the <strong>pin</strong> next to Ballpark.</p>
    </section>
  </main>

  <script src="lib/status.js"></script>
  <script src="popup.js"></script>
  <script type="module" src="welcome.js"></script>
</body>
```

- [ ] **Step 2: Create `welcome.js`**

```js
// welcome.js — on-device (Gemini Nano) onboarding for the welcome page.
// ES module so it can import the real Nano provider — the same
// availability()/download() the calibrator uses (single source of truth). The
// BYOK key-save section is handled by the shared popup.js; the pure
// screenForState() mapper comes from lib/status.js (a classic script loaded
// before this module, so window.BallparkStatus is set).

import { availability, download } from './lib/providers/nano.js';

// 'failed' is a local UI screen, not an availability() state — the download's
// catch shows it. Kept separate from the progress screen because an inline
// error read as "still downloading" at the UI gate.
const SCREENS = ['ready', 'consent', 'downloading', 'failed', 'unavailable'];

function show(screenId) {
  for (const id of SCREENS) {
    const el = document.getElementById('screen-' + id);
    if (el) el.hidden = id !== screenId;
  }
}

// Progress: fraction in [0,1], or null for an indeterminate "setting up…" bar.
function setProgress(fraction) {
  const fill = document.getElementById('progress-fill');
  const pct = document.getElementById('progress-pct');
  if (!fill) return;
  if (fraction == null) {
    fill.style.width = '35%';
    if (pct) pct.textContent = 'Setting up…';
  } else {
    const p = Math.round(fraction * 100);
    fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  }
}

// Carry the progress reached into the amber card's bar, so "your progress is
// saved" is visibly true rather than just a claim.
function showFailed() {
  const fill = document.getElementById('progress-fill');
  const failedFill = document.getElementById('failed-fill');
  if (failedFill && fill) failedFill.style.width = fill.style.width || '35%';
  show('failed');
}

// Start (or attach to) the one-time model download, then re-read the REAL state
// — never assume success — and show the matching screen.
async function runDownload() {
  show('downloading');
  setProgress(null);
  try {
    await download((fraction) => setProgress(fraction));
    show(window.BallparkStatus.screenForState(await availability()));
  } catch (err) {
    console.warn('[Ballpark] Nano download failed:', err);
    showFailed();
  }
}

async function render() {
  const screen = window.BallparkStatus.screenForState(await availability());
  // 'downloading' on load = a download already running (another tab / prior
  // visit): attach and watch it to completion. Otherwise just show the screen.
  if (screen === 'downloading') runDownload();
  else show(screen);
}

document.getElementById('turn-on-btn')?.addEventListener('click', runDownload);
document.getElementById('retry-btn')?.addEventListener('click', runDownload);

render();
```

- [ ] **Step 3: Add `welcome.css` rules**

Append to `welcome.css` (the old `.steps`/`.step*` rules can stay — harmless — or be removed since the reframe drops the `<ol class="steps">`; removing them is cleaner but optional):

```css
/* ---- On-device state cards ---- */

.state-block { margin-bottom: 20px; }

.state-card {
  background: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  padding: 22px 24px;
}

.state-card h2 { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
.state-card p { font-size: 14px; color: #57606a; }
.state-card .state-sub { font-size: 13px; margin-top: 10px; }
.state-card p strong { color: #1a1a1a; }

.state-card--ready {
  border-color: #b7e0c1;
  background: #f2fbf5;
}

/* Amber, not red: setup didn't finish is recoverable, not an error state. The
   distinct background is what stops it reading as "still in progress". */
.state-card--failed {
  border-color: #f0c36d;
  background: #fdf6e6;
}

.state-badge {
  width: 32px; height: 32px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 10px;
}
.state-badge--ok { background: #1a7f37; }
.state-badge--warn { background: #bf8700; }

/* Consent-screen disclosure list (size / free-space / check-first). */
.facts { list-style: none; margin: 12px 0 16px; padding: 0; }
.facts li {
  position: relative;
  font-size: 13.5px; color: #57606a;
  padding-left: 18px; margin-bottom: 7px;
}
.facts li::before { content: "•"; position: absolute; left: 4px; color: #8c959f; }
.facts strong { color: #1a1a1a; }

.primary-btn {
  margin-top: 6px;
  padding: 10px 20px;
  font-size: 15px;
}

/* ---- Download progress ---- */

.progress {
  height: 10px;
  background: #eaecef;
  border-radius: 999px;
  overflow: hidden;
  margin: 14px 0 6px;
}
.progress-fill {
  height: 100%;
  width: 0;
  background: #2c5f9e;
  border-radius: 999px;
  transition: width 0.3s ease;
}
.progress-fill--stalled { background: #d4a72c; transition: none; }
.progress-pct { font-size: 13px; font-weight: 600; color: #1a1a1a; }

.download-retry { margin-top: 14px; }

/* ---- API-key options (Gemini free / Anthropic paid) ---- */

.keyopt { border-top: 1px solid #e6eaee; padding-top: 16px; margin-top: 16px; }
.keyopt-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.keyopt-head h3 { font-size: 14.5px; font-weight: 600; }
.pill {
  font-size: 10.5px; font-weight: 700;
  letter-spacing: .03em; text-transform: uppercase;
  padding: 2px 7px; border-radius: 999px;
}
.pill--free { background: #dafbe1; color: #1a7f37; }
.pill--paid { background: #f0f3f6; color: #57606a; }
.keyopt-text { font-size: 13px; color: #57606a; margin-bottom: 10px; }
.keyopt-text strong { color: #1a1a1a; }

/* ---- Upgrade + pin-tip sections (reframed cards) ---- */

.upgrade, .pin-tip {
  background: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 10px;
  padding: 20px 24px;
  margin-top: 16px;
}
.upgrade h2, .pin-tip h2 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.upgrade-text, .pin-tip p { font-size: 13.5px; color: #57606a; margin-bottom: 12px; }
.pin-tip p { margin-bottom: 0; }
.pin-tip p strong, .upgrade-text strong { color: #1a1a1a; }
```

- [ ] **Step 4: Syntax-check + tests**

Run: `node --check welcome.js && npm test`
Expected: `node --check` prints nothing; `npm test` PASS (unchanged — welcome.js isn't in the suite; it imports browser-only Nano, covered manually below).

- [ ] **Step 5: Manual runtime verification (load unpacked) + screenshots**

Load unpacked at `chrome://extensions`, reload the card. Then, in the extension's **service worker** console you can't reach the page, so verify on the page itself:
- On this machine Nano is likely `available` → opening `welcome.html` (reload the extension to re-fire `onInstalled`, or open it from the popup's "full setup guide" link) shows the **green "You're all set"** screen. Screenshot it.
- To exercise the other screens without changing hardware, temporarily force the state: in `welcome.js`'s `render()`, hard-code `const screen = window.BallparkStatus.screenForState('downloadable')` (then `'downloading'`, `'unavailable'`) and reload the page; screenshot each. **Revert the hard-code before committing.**
- On the `consent` screen, click **[Turn it on]** on a machine where Nano is genuinely `downloadable` to confirm the real progress → green path (or note it's covered by the mock if unavailable to test here).

Present the four screenshots (ready / consent / downloading / unavailable) to Stephenie in one batch, captioned, alongside the Task 1 mock for parity.

- [ ] **Step 6: Commit** (after Stephenie's OK)

```bash
git add welcome.html welcome.js welcome.css
git commit -m "feat: reframe onboarding to free on-device default + wire Nano download consent"
```

---

### Task 5: Popup — two-segment contextual free control + "Finish setup →" nudge (`popup.html` + `popup.js` + `popup.css`)

Two jobs now. **(a)** The nudge: closes the dead-end where a user selects On-device but nothing visibly happens because the model isn't downloaded. **(b)** The engine control stays **two segments** `[ free | Claude ]`, but the **free segment renders contextually** — "On-device" for a Nano user, "Gemini (free)" for a Gemini user, never both (they're mutually exclusive by the onboarding flow). Also adds the **Gemini key-save handler** that the welcome page's Gemini-offer surface depends on (shared `popup.js` serves both).

> **REVISED 2026-07-20 — two-segment contextual, NOT three-engine.** Nano and Gemini are never a
> live choice, so a third segment would offer a state that can't exist. `engineState` (Task 2b)
> exposes `freeEngine` so this one segment renders correctly. Net simplification vs the 07-19 plan.
>
> **ALSO REVISED (v4 gate) — the popup loses its API-key text box entirely.** Key entry now lives
> **only on the welcome/setup page**; the popup becomes engine-picker + status + nudge. So: (a)
> remove the `#api-key`/`#save-btn`/`#save-status` block from `popup.html`; (b) the shared
> `popup.js` key-save serves the welcome page **exclusively** (its popup-context guards now just
> no-op there); (c) do NOT add a Gemini key box to the popup — instead the disabled/free states
> show a setup-page link (mock: variant B's "Add a Claude key →", variant A's "Finish setup →").
> This *shrinks* Task 5's HTML rather than growing it. The Gemini key-save handler still gets
> added, but it lives on the welcome page (Task 4), not the popup.

> ⚠️ **UI GATE (Task 1b) — the contextual free segment is a surface Stephenie hasn't seen.** Before building (b), mock the popup at 300px with the free segment in **both** its Nano and Gemini renderings (× active/inactive, and the Claude segment enabled/disabled), show it, and get approval. Cheap-and-throwaway first. The nudge (a) was already approved in the Task 1 mock and needs no second gate.

**Also in this task:** `popup.js` still reads the removed `keyEnabled` field — update it to `enabled.anthropic` / `enabled.gemini` (Task 2b's breaking change), and add the Gemini key-save handler that `welcome.html`'s new `#gemini-key` field depends on (shared `popup.js` serves both surfaces).

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `popup.css`

**Interfaces:**
- Consumes: `BallparkStatus.nanoNudgeVisible` (Task 2); `BallparkStatus.engineState` contextual-free-slot shape (`freeEngine` + `enabled`, Task 2b); `{ type: 'GET_NANO_STATE' }` → `{ state }` (Task 3).
- Storage: reads/writes `geminiApiKey` alongside the existing `apiKey` + `activeProvider`.

- [ ] **Step 1: Add the nudge element to `popup.html`**

Inside the engine `<section>`, after the `<p class="hint engine-hint" id="engine-hint"></p>` line:

```html
      <a class="engine-nudge" id="engine-nudge" href="welcome.html" target="_blank" rel="noopener noreferrer" hidden>Finish setup →</a>
```

- [ ] **Step 2: Wire the nudge in `popup.js`**

In `renderEngine`, after the existing `engineHint.textContent = …` assignment, refresh the nudge:

```js
  refreshNudge({ apiKey, activeProvider });
```

Add near the other engine helpers:

```js
const engineNudge = document.getElementById('engine-nudge');

// Show "Finish setup →" only when On-device is active but the model isn't ready.
// availability() lives in the worker (ESM), so ask it for the current state.
function refreshNudge({ apiKey, activeProvider }) {
  if (!engineNudge) return;
  chrome.runtime.sendMessage({ type: 'GET_NANO_STATE' }, (resp) => {
    const nanoState = chrome.runtime.lastError ? null : resp && resp.state;
    engineNudge.hidden = !BallparkStatus.nanoNudgeVisible({ apiKey, activeProvider, nanoState });
  });
}
```

- [ ] **Step 3: Style the nudge in `popup.css`**

After the `.engine-seg-wrap …` rules:

```css
.engine-nudge {
  display: inline-block;
  margin-top: 2px;
  font-size: 12px;
  font-weight: 600;
  color: #8250df; /* on-device accent, matches the segment */
  text-decoration: none;
}
.engine-nudge:hover { text-decoration: underline; }
.engine-nudge[hidden] { display: none; }
```

- [ ] **Step 4: Manual runtime verification**

Load unpacked, reload. Open the popup:
- With On-device selected and Nano `available` (this machine) → **no** nudge.
- Temporarily stub the worker's `GET_NANO_STATE` to reply `{ state: 'downloadable' }` (or hard-code `nanoState = 'downloadable'` in `refreshNudge` and reload) → nudge shows; click it → opens the reframed welcome page. **Revert the stub before committing.**
- Switch to the Haiku (key) engine → nudge hidden.

Screenshot the popup with the nudge visible; present to Stephenie.

- [ ] **Step 5: Commit** (after Stephenie's OK)

```bash
git add popup.html popup.js popup.css
git commit -m "feat: popup 'Finish setup' nudge when on-device model isn't ready"
```

---

### Task 6: Packaging allowlist + docs (`CLAUDE.md`, `AGENTS.md`)

`welcome.js` is a new file the extension loads, so it must be in the Web Store zip allowlist, and the docs should point future work at the onboarding surface.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the new files to both packaging allowlists**

In the `zip -r ballpark.zip …` block in `CLAUDE.md` (and the equivalent in `AGENTS.md`), add **`welcome.js`**, **`lib/providers/gemini.js`**, and **`prompts/calibration-gemini.md`**; bump the stated file count (`21` → **`24`**) and the `unzip -l` verify comment. Missing any of these ships a broken extension — the zip is hand-assembled with no build step to catch it.

- [ ] **Step 1b: Host permission check (from Task 2c)**

If the Gemini provider required adding `https://generativelanguage.googleapis.com/*` to `manifest.json`, note it here and in the docs — it widens the Web Store review surface and must be mentioned in the store listing's permission justification.

- [ ] **Step 2: Update "Where to make changes"**

In `CLAUDE.md`'s "Where to make changes" section, add a line: onboarding / device-state screens / Nano download consent → `welcome.html` + `welcome.js` (+ `welcome.css`); the state→screen mapping is `screenForState` in `lib/status.js`; the popup nudge is `nanoNudgeVisible` + `GET_NANO_STATE`.

- [ ] **Step 3: Verify the allowlist is accurate**

Run (dry, from repo root — do not upload):
```bash
for f in welcome.js welcome.html welcome.css lib/providers/nano.js lib/status.js; do test -f "$f" && echo "ok $f" || echo "MISSING $f"; done
```
Expected: `ok` for every line.

- [ ] **Step 4: Commit** (after Stephenie's OK)

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: add welcome.js to packaging allowlist; note onboarding surfaces"
```

---

## Self-Review

**Spec coverage** (against `specs/2026-07-16-onboarding-download-consent-design.md`):
- Adaptive four-state flow (ready/consent/downloading/unavailable) — Task 4 (screens) + Task 2 (`screenForState`). ✓
- Download runs in the welcome-page tab, reuses `nano.js` `download`/`availability` — Task 4 (`welcome.js`). ✓
- Detect-before-prompt (already-`available` skips download) — `screenForState('available') → ready`, Tasks 2 + 4. ✓
- Full reframe (free-default hero, BYOK as optional upgrade, kept pin tip) — Task 4 (`welcome.html`). ✓
- Green "safe to close" is the only such signal — Task 4 `screen-ready` copy; no other screen says it. ✓

**Revision coverage (2026-07-19 UI gate):**
- Consent-screen transparency (Nano/Google named, download disclosed, 4 GB + 22 GB, check-first) — Task 4 Step 1 `screen-consent` + Global Constraints. ✓
- Failure no longer reads as in-progress — Task 4 `screen-failed` (amber card, own screen, `showFailed()`). ✓
- `unavailable` copy without an Anthropic mention — Task 4 `screen-unavailable`. ✓
- Free key path is real, not aspirational — Task 2c (current flash, **ungrounded**) + Task 4's Gemini-offer fallback surface + Task 5's contextual free segment. ✓ *(Revised 2026-07-20: ungrounded fallback, not searched peer.)*

**Known risks carried by this revision:**
1. **Gemini response shape is unverified** — the `searched` field path is assumed, not confirmed. Task 2c Step 0's probe exists to kill this risk *before* the provider is written.
2. **Possible new host permission** — may break the "no new permissions" constraint; flagged in Tasks 2c + 6 rather than discovered at packaging.
3. **`keyEnabled` is a breaking rename** — `popup.js` is the only consumer, but it isn't fixed until Task 5, so the tree is briefly inconsistent between 2b and 5. Grep before declaring done.
4. **Task 3 has no automated test** — a `chrome.runtime` listener with no harness in this repo; syntax-checked and manually verified only.
- `welcome.html` keeps shared `popup.js` for key-save; adds `welcome.js` + load order — Task 4 Step 1 script tags + Global Constraints. ✓
- Error/retry on failed download; indeterminate fallback when no progress event — Task 4 (`showFailed`, `setProgress(null)`). ✓
- Re-entry re-reads `availability()`, never remembers — Task 4 (`render` + post-download re-read). ✓
- Popup nudge (`nanoNudgeVisible` + `GET_NANO_STATE`) — Tasks 2 + 3 + 5. ✓
- Testing: pure helpers unit-tested in Node; browser-only download covered manually — Tasks 2 + 4/5 Step verifications. ✓
- UI gate before building — Task 1. ✓
- Packaging allowlist + docs — Task 6. ✓
- Scope fences (no v2.5 Gemini, no chart, no popup redesign, no `download()` change) — respected. ✓

**Placeholder scan:** no TBD/TODO. The one deliberate temporary edits (hard-coding a state for manual verification) are explicitly flagged "revert before committing," not shipped code.

**Type consistency:** `screenForState(state) → 'ready'|'consent'|'downloading'|'unavailable'` and `nanoNudgeVisible({ apiKey, activeProvider, nanoState }) → boolean` are used identically across Tasks 2/4/5. Element IDs (`screen-ready`/`-consent`/`-downloading`/`-unavailable`, `turn-on-btn`, `progress`/`progress-fill`/`progress-pct`, `download-retry`, `retry-btn`, `engine-nudge`) match between `welcome.html`/`popup.html` and their scripts. `GET_NANO_STATE` → `{ state }` is consistent between `background.js` (Task 3) and `popup.js` (Task 5).
