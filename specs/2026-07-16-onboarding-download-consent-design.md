# Onboarding Rewrite + Nano Download-Consent UI (Ballpark 2.0, piece ④) — Design

**Status:** Approved 2026-07-16 (brainstorm). Next: implementation plan (writing-plans).
**Depends on:** piece ② (provider abstraction + Nano free default), merged in PR #9.
**Predecessors:** `specs/2026-07-10-provider-abstraction-design.md`, `specs/2026-07-16-provider-abstraction-plan.md`.

> **REVISION 2026-07-20 — Gemini scoped in as an ungrounded free FALLBACK to Nano.**
> The `unavailable` path is no longer Anthropic-only. Probe (real free-tier key) confirmed:
> free-tier Google Search grounding is genuinely unavailable, but **ungrounded** free Gemini
> works and measured *at or above* Nano on the calibration fixtures. So:
> - **Sequenced, not a choice.** Nano is tried first. Gemini is surfaced **only** when Nano is
>   **declined** (new light "Not now" line on the consent screen), **fails** (added to the amber
>   screen), or is **unavailable**. If Nano works, Gemini never appears.
> - **Gemini = free, ungrounded** (`searched:false`); web search stays the paid Anthropic upgrade.
> - **Popup stays a two-segment picker** `[ free | Claude ]`; the free segment renders Nano *or*
>   Gemini contextually (never both). Free-engine rule: **Nano if usable, else Gemini if a key is saved.**
> See `specs/piece4-flow-diagram.md` for the updated state machine, and the plan for task-level changes.

## What this is

Piece ② shipped the free on-device (Gemini Nano) default and the BYOK-Anthropic
upgrade, but two surfaces still reflect the *old* key-first world:

1. **`welcome.html`** — today's onboarding leads with "Step 1: Add your Anthropic API
   key" and never mentions the free on-device tier. It contradicts the shipped
   architecture.
2. **The Nano download** — `lib/providers/nano.js` exposes `download(onProgress)` but
   **nothing calls it**. A user whose device *can* run Nano but hasn't downloaded the
   model (`availability() === 'downloadable'`) has no in-product way to trigger the
   one-time download. The card's device-state notes already deep-link here
   (`OPEN_PAGE` → `welcome.html`), so this is the page that must close the loop.

Piece ④ rewrites the onboarding to the free-default story and wires the real
download-consent flow. **Audience-first constraint (load-bearing):** the target user
is the *least* technical audience. Every screen and every word must be clear and
un-intimidating — nothing that makes the tool feel "too technical/fancy for me."

## Guiding decisions (from the 2026-07-16 brainstorm)

- **The download runs in the welcome-page tab, not the worker.** An extension *page*
  tab is a durable context: unlike the popup (dies on blur) or the MV3 service worker
  (killed after ~30s idle), the tab lives as long as it's open. So the tab's lifetime
  *is* the download's lifetime, and "keep this tab open until the light turns green"
  is a true statement, not just copy. **Verified:** the Prompt API is reachable from
  extension page scripts (window contexts), not only the service worker, in Chrome
  138+ (Chromium `prompt-api-for-extension` docs).
- **Detect-before-prompt.** `availability()` returns `available` when the model is
  already downloaded and ready. The page reads state on load and only shows a download
  step to people who need one. Nobody already set up ever sees a download prompt.
- **Adaptive over static.** More per-state logic is worth it for clarity. The page
  renders exactly one of four state screens.
- **Full reframe, not a patch.** Free on-device is the default story; BYOK is the
  clearly-optional upgrade.

## The adaptive flow

On load, `welcome.js` calls `availability()` and shows exactly one screen:

| Device state | Screen |
|---|---|
| `available` (already set up) | **"You're all set."** Free, private to your device. Open any article and click an underlined number. No download step. |
| `downloadable` (can run it, not downloaded) | **Consent screen:** "Turn on Ballpark's free calibrator — a one-time setup so numbers can be checked right on your device, no account or payment needed." → **[Turn it on]** → progress bar → 🟢 **"Done! You can close this tab now."** |
| `downloading` (already in progress) | Straight to the progress bar + "Setting up… keep this tab open until the light turns green." |
| `unavailable` (hardware can't) | Non-blaming: "Your device can't run the free on-device version." → the **Gemini free fallback** (ungrounded, warm caveats: no web search, daily limit), with the Anthropic key as the paid upgrade. *(Revised 2026-07-20: was Anthropic-only; free Gemini is now IN scope.)* |

The 🟢 completion panel is the **only** element that says "safe to close" — it is the
explicit green light the user asked for.

## Architecture

- **New file `welcome.js`, loaded as `<script type="module">`.** It imports
  `{ availability, download }` directly from `lib/providers/nano.js` — single source of
  truth; the onboarding reuses the *exact* on-device logic the calibrator uses, no
  duplicated `LanguageModel` code, no drift. `welcome.js` owns **only** the on-device
  state block.
- **`welcome.html` keeps loading `popup.js`.** `popup.js` is already shared with the
  popup and its engine/status blocks are guarded (`if (segOndevice)` / `if (statusLine)`),
  so it safely no-ops on the welcome page while still powering the BYOK **key-save**
  section (`#api-key` / `#save-btn` / `#save-status`). Reusing it keeps key-save DRY; ④
  does not re-implement it in `welcome.js`. Load order in `welcome.html`:
  `lib/status.js` (classic) → `popup.js` (classic) → `welcome.js` (module).
- **Download call:** the `downloadable` screen's [Turn it on] button calls
  `download(fraction => renderProgress(fraction))`. On resolve, re-call `availability()`;
  on `available`, show the green panel. `nano.js`'s `download(onProgress)` is unchanged —
  ④ is simply its first caller.
- **State → screen is a pure function.** Add `screenForState(state) → screenId` to
  `lib/status.js` (`window.BallparkStatus`), unit-tested by the existing
  `test/status.test.js` (jsdom, no browser). `welcome.js` reads it via
  `window.BallparkStatus.screenForState` (status.js loads first); the DOM show/hide is a
  thin wrapper over it.
- **Popup nudge:** when On-device is the active engine but Nano isn't `available`, the
  popup shows a one-line **"Finish setup →"** that opens `welcome.html`. The popup is a
  classic script and can't `import` `nano.js`, so it reads state via a tiny
  **`GET_NANO_STATE`** message to the background worker (which owns `nano.js` and calls
  `availability()`), keeping `nano.js` authoritative. Closes the dead-end where a user
  selects On-device and nothing visibly happens because the model isn't downloaded.

## Page structure (full reframe)

1. **Hero** — leads with free / private / on-device (today it leads with the API key).
2. **Adaptive state block** — the four screens above; one visible at a time.
3. **"Pin Ballpark to your toolbar"** — kept from the current page; still useful.
4. **Optional BYOK upgrade section** — always visible below, reframed from "Step 1: add
   a key" → "Want web-searched, source-backed answers? Add a key." Reuses the existing
   key input + save logic.

## Edge & error handling

- **Download fails** (network drop, disk full, hardware error) → a plain
  "Setup didn't finish — [Try again]" panel that re-calls `download()`. Not a red error.
- **Progress event semantics** — `downloadprogress` reports `e.loaded` as a 0–1
  fraction; render as a percentage. If the event never fires (some builds), fall back to
  an indeterminate "Setting up…" state rather than a stuck 0%.
- **Re-entry** — state is always re-read from `availability()`, never remembered:
  return mid-download → progress; return when done → green "all set."

## Testing

- **Unit (Node):** `screenForState(state)` for all four states + unknown/undefined →
  safe default. The popup nudge's show/hide predicate (active engine + state) as a pure
  helper alongside the existing `engineState` in `lib/status.js`.
- **Manual (load-unpacked):** each state screen; the full `downloadable` → progress →
  green happy path; the retry path.
- **Honest caveat (logged):** on a dev machine where Nano is already `available`, the
  `downloadable` / `downloading` screens can't be exercised naturally — cover them by
  temporarily stubbing `availability()` and/or a mock, plus manual review of the copy.
- **UI gate:** per the standing UI-gate rule, a disposable mock of the four state
  screens (esp. the consent + progress + green-light sequence) is shown and approved
  **before** any production HTML/CSS is built.

## Scope fences (explicitly NOT in ④)

- ~~The **v2.5 free-Gemini-key** path for `unavailable` users~~ — **pulled INTO ④** as an
  ungrounded free fallback to Nano (revised 2026-07-20; see the revision banner above).
- The **provider comparison chart** and additional providers beyond nano/gemini/anthropic — piece ③.
- **Search-grounded Gemini** — free-tier grounding is unavailable; Gemini ships ungrounded. A
  paid/grounded Gemini tier, if ever wanted, is out of ④.
- Any **popup redesign** beyond the one-line state-aware nudge.
- Changing `nano.js`'s `download(onProgress)` shape — it is consumed as-is.

## Open items to confirm during implementation

- Exact `downloadprogress` event shape in the current Chrome channel (fraction vs.
  loaded/total) — verify against a live download before finalizing the progress render.
- Whether `download()` should pass any `expectedInputs`/model params for our use — today
  it creates a bare session; confirm that produces the same model `calibrate()` uses.
