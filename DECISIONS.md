# Decision Log

Format: date · decision · whose call · rationale · failure mode it prevents

---

## 2026-07-10 — Ballpark 2.0: free-entry default + BYOK upgrade

**Direction (pre-session, user):** Ship a zero-setup free default (install → works, no
login, no key). BYOK (API key) becomes the *upgrade* path — better model + web-search
grounding — expanded beyond Anthropic to other providers, with a price-comparison chart
and setup links.
· *Rationale:* The BYOK-only model is the primary adoption barrier — creating an
Anthropic account + attaching a card is too much friction for non-technical users, who
never experience the tool's value. Cost isn't the barrier; setup is.
· *Prevents:* Zero-adoption from install-then-bounce at the API-key wall.

**No paid proxy (pre-session, user):** We will not host models behind our own metered
backend at our cost. WebLLM eliminated (multi-GB per-extension download, WebGPU
requirements, MV3 plumbing — strictly dominated by on-device Nano).
· *Prevents:* Unbounded hosting cost; a heavy first-run download that kills install.

**Cloudflare Workers AI reclassified — BYOK tier, not free-default (joint;
AI-proposed reframe, user approved):** A hosted inference API can only be (a) a metered
proxy we pay for — already ruled out — or (b) BYO-Cloudflare-key, which is the same
signup/key friction we're removing. So it belongs in the BYOK upgrade tier, not the
free-default slot.
· *General principle established:* In a Chrome extension, a zero-setup free default that
costs us nothing and needs no key has exactly one technical shape — **on-device**.
Everything else is either our money or the user's key.
· *Prevents:* Wasting the free-default slot on an option that reintroduces the barrier.

**Gemini Nano (Chrome built-in Prompt API) is the free default — GO (joint; validated
by spike):** Verified current facts — Prompt API stable for Chrome extensions since
Chrome 138; on-device, no key, no cost to us; gated by `LanguageModel.availability()`;
desktop-only, needs ~22GB free disk + 4GB VRAM/16GB RAM + one-time ~3GB model download.
· *Spike result (this machine, Chrome 149, 22 real calibration fixtures, no web search):*
  - **Nano: structural 97%, directional 82%, 15/22 clean, 0 errors.**
  - **Claude Haiku + web search (same fixtures/ruler): structural 95%, directional 67%,
    10/22 clean.**
  - Nano cleared both go/no-go bars (structural ≥85%, directional ≥70%) and scored *at
    least even with* Claude on direction. Much of the delta is scoring-keyword artifacts
    and opinionated fixtures both models miss identically (e.g. Coca-Cola CAGR).
· *Key insight:* The keyword-directional scorer measures *direction*, which Nano does
well; Claude's real edge — grounded named facts via web search — is exactly the
paid-upgrade value prop. Clean tier separation: free tier = directional job Nano is good
at; paid tier = grounding Nano structurally cannot do. This validates the two-tier
architecture. The "calibration not verification" framing is what makes the tiny on-device
model viable (it reasons "huge for its class" without needing the current figure).
· *Prevents:* Building the whole 2.0 stack around an unmeasured model that can't do the
directional job.

### Spike artifacts (this session)
- `eval/scoring.mjs` — extracted the shared scorer (`evaluateResult` + `DIRECTION_WORDS`)
  from `eval/calibration-eval.mjs` so Nano and Claude are judged by the same ruler.
- `eval/nano/{harness.html,harness.mjs,prompt-nano.md}` — throwaway browser harness that
  runs the fixtures through on-device Nano. Prompt is `calibration.md` with web-search
  stripped + one earned nudge: "compare to the reference class, not to other numbers in
  the context."
- Nano call shape that works in Chrome 149: `LanguageModel.create({ expectedOutputs:
  [{type:'text',languages:['en']}], initialPrompts:[{role:'system',...}] })` then
  `session.prompt(msg, { responseConstraint: <json-schema> })` — schema-constrained JSON
  works and carries structural quality.

### Follow-up found (not a decision — a bug ticket)
- `lib/api.js` `parseResponse` fails when the model wraps valid JSON in a prose preface
  (e.g. "Based on the search results, …\n```json…"). Surfaced on `news-001` (NIH budget):
  Claude produced a good verdict but it was scored as `insufficient_context`. Strip/scan
  for a JSON object anywhere in the text, not just a leading fence.

---

## 2026-07-10 — Piece ② provider-abstraction architecture (design decisions)

Design presented but **NOT yet approved** — user is reviewing, will react next session.
Full draft: `specs/2026-07-10-provider-abstraction-design.md`.

**Linchpin verified (joint):** `LanguageModel` runs directly in the MV3 **service
worker** (also popup/side panel), no offscreen document, no extra manifest permission.
· *So:* the free Nano tier lives in `background.js`/`lib/` alongside the Anthropic path
— one unified context, no split-context plumbing.
· *Prevents:* Building an unnecessary offscreen-document / content-script message-relay layer.

**Tier relationship — mode-selection, honest failure (joint; AI-recommended, user
approved):** Config picks exactly ONE active tier. If it can't serve, show a clear
message + CTA — never silently swap providers. Free user w/o Nano hardware → "add a
key"; BYOK API error → show the real error.
· *Rationale:* Provenance stays truthful — the user always knows which model answered.
· *Prevents:* A user thinking they got Claude when they silently got Nano (or vice
versa); the complexity of chaining providers.

**Provider abstraction shape + scope (joint):** A **registry of self-contained
provider modules**, each implementing `calibrate(payload, config) → Result |
TypedStatus`; a thin dispatcher in `background.js` resolves the active provider from
config. Scope for ② = **Nano + Anthropic only** (the two validated this session);
OpenAI/Google/Cloudflare + comparison chart are piece ③.
· *Rationale:* Adding a provider later = new module + registry entry, no dispatcher
change. Ships a working free default fastest.
· *Prevents:* A `switch`-statement sprawl and shipping 5 unvalidated provider parsers at once.

**Nano download — explicit one-time consent (joint; AI-recommended, user approved):**
On `availability()==='downloadable'` (the common first-run state), do NOT auto-fetch the
~3 GB model. Surface a typed `needs-download` state; download only on an informed click,
with progress. Provider exposes `download(onProgress)`; the consent UI itself is piece ④.
· *Rationale:* Consistent with honest-failure — no surprise multi-GB download; still zero
account/key/card.
· *Prevents:* A silent 3 GB download on first click, slow first result, and failures on
disk-tight machines.

**Note (AI-proposed, deferred):** lowest-friction BYOK key for non-technical users is
likely **Google AI Studio / Gemini API** (free tier, often no card) vs. Anthropic
(prepaid balance). Flag for the piece-③ comparison chart.

---

## 2026-07-16 — Backup path for `unavailable` (Nano can't run) users → v2.5

**Decision (joint; user raised, AI-shaped, user approved):** For users whose hardware
can't run Nano (`availability()==='unavailable'`), the backup is the **lowest-friction
*free-tier* BYOK key — Google's Gemini API free tier** (Google account, often no card),
surfaced as a friendly CTA ("get a free Gemini key, ~2 min, no card" + setup link)
instead of a bare "add a key." User holds their own key. **Deferred to v2.5** — it's a
③ (add Gemini provider + comparison chart) / ④ (onboarding CTA per `availability()`)
concern; **explicitly NOT in piece ②** (scope stays Nano + Anthropic).
· *Rejected alternative (user proposed, AI talked through):* ship an extension-embedded
key giving limited per-session free usage. Rejected on two grounds — (1) it's the
**paid proxy already ruled out** in disguise (inference we pay for, cost grows unbounded
with adoption); (2) an embedded key in a distributed extension is **trivially
extractable** (store copy is just files on disk) and a client-side per-session cap is
trivially reset — real rate-limiting requires a server we run, which *is* the metered
backend we ruled out. The build effort isn't the blocker; the strategic cost commitment
and the security floor are.
· *Prevents:* Reopening the no-paid-proxy decision by the back door; shipping an
extractable secret; leaving `unavailable` users at a bare key-wall with no guided path.
· *Accepted consequence (named honestly):* `unavailable` users still have **no
zero-key free tier** — the free-tier Gemini key is near-frictionless but is still a key.
That's the price of the on-device-only free-default decision, not a patchable gap.

---

## 2026-07-16 — Piece ② UI-gate decisions (card provenance + device-state notes)

Decided at the disposable-mock UI gate (Task 4 of the ② plan), before any card code was built.

**Model-named provenance line (user-directed; user proposed, AI-shaped/approved):** The card's
provenance line now names the model that answered, then the method: `Haiku 4.5 · ✓ Searched` /
`Haiku 4.5 · ~ From memory` for the paid tier; `⚡ On-device` (accent #8250df) for the free Nano
tier. Adds a `model` display label to the Anthropic Result.
· *Rationale:* Provenance should honestly answer "what actually answered this?" — and this pattern
pays off in piece ③, where each BYOK provider names its own model on the same line, so a user always
knows whether Haiku, GPT, or Gemini produced the answer.
· *Prevents:* Ambiguous provenance once multiple providers exist; a user not knowing which model/key
was used.
· *On-device naming:* kept "⚡ On-device" rather than "Gemini Nano" — for a free-tier user, "on-device"
communicates the meaningful properties (private, local, free) better than the model codename.

**Actionable device-state notes (user-directed):** The two Nano typed states (needs-download,
unavailable) render as neutral notes AND carry an actionable link — "Set up the free model →" and
"Add an API key →" — that opens the setup guide (`welcome.html`, the page piece ④ turns into the real
device-check/onboarding flow). Implemented via an `action: { label, page }` field on the TypedStatus
and an `OPEN_PAGE` message to the background worker (a content script can't open the extension popup).
· *Rationale:* A dead-end "can't run" note isn't actionable; a guided link is. Forward-compatible with
piece ④'s onboarding rewrite.
· *Prevents:* Users hitting a device-state note with no next step.

**Scope note (joint):** Both additions slightly exceed ②'s original "minimal provenance, no polished
chip" fence. Accepted as user-directed at the gate; logged so the fence's later relaxation is traceable.

**Nano output hardening (AI-flagged in Task 2 review, folded in):** Nano's happy path now degrades to a
neutral `insufficient` note on malformed/missing-field on-device output (mirroring Anthropic's
parseResponse), instead of throwing a raw SyntaxError. Own commit (Task 8).
· *Prevents:* A red error card when the on-device model (esp. on the no-`responseConstraint` fallback
path) returns unusable output.

---

## 2026-07-16 — Popup "Calibration engine" toggle (the activeProvider UI)

**Decision (user-directed, AI-shaped/approved at UI gate):** Add a segmented "Calibration
engine" control to the popup that sets `activeProvider` — the piece ②'s config resolution
needed but had no UI for. Without it, a saved key was never used (activeProvider stayed
'nano'), leaving the paid tier unreachable. Surfaced by user testing.
· Segmented control (not a plain on/off switch) so it names *both* engines + the model,
  matching the card's provenance line and setting up piece ③'s multi-provider naming.
· The API-key side enables only when a key exists; a pure `engineState()` helper in
  lib/status.js mirrors `resolveProvider` (unit-tested) so the popup can't show a state the
  dispatcher won't honor.
· Switching engines clears the session cache (cache is keyed by number+url, not provider)
  so a re-click re-runs on the newly-selected engine.
· *Verified:* 62/62 tests + a real-popup render (Playwright over the actual popup.html/css/js,
  not the mock) confirming the segmented control survives the generic `button` cascade
  (segments tint, don't paint solid blue) in both no-key and key-saved states.
· *Prevents:* A dead upgrade path — add a key, nothing happens, no way to switch.

**Scope note:** This nudges popup UX (piece ③ territory) into ②, but it's the minimum that
makes ②'s two-tier design actually usable. Full multi-provider selection stays ③.

---

## 2026-07-16 — Piece ④ (onboarding rewrite + Nano download-consent UI) design

Piece ② merged (PR #9). Piece ④ brainstormed → design spec approved → plan written this
session. Currently at the **UI gate** (Task 1 mock shown; user has UI comments to make next
session before the real build). Specs: `specs/2026-07-16-onboarding-download-consent-{design,plan}.md`.

**Download runs in the welcome-PAGE tab, not the worker/popup (joint; AI-verified):** An
extension *page* tab is a durable context — unlike the popup (dies on blur) or the MV3 service
worker (killed after ~30s idle), the tab lives as long as it's open. So "keep this tab open until
the green checkmark" is literally true: the tab's lifetime *is* the download's lifetime. Verified
the Prompt API is reachable from extension page scripts (window contexts), not just the SW, in
Chrome 138+.
· *Prevents:* A multi-GB download torn down mid-flight by SW idle-eviction or a closed popup.

**Adaptive four-state onboarding via `availability()` (user-directed; "more logic is fine if it's
clearer"):** The welcome page reads `availability()` on load and shows exactly one of four screens
— `available`→"You're all set" (no download), `downloadable`→consent+[Turn it on], `downloading`→
progress, `unavailable`→"add a key". Detect-before-prompt: anyone already set up never sees a
download step.
· *Rationale:* Audience is the *least* technical users; per-state clarity beats a blunt static page.
· *Prevents:* Prompting an already-set-up user to "download"; a dead-end for `unavailable` hardware.

**Audience-first copy is load-bearing (user-directed):** No jargon — no "model", "inference", "GB",
"service worker" in user-facing text. Nothing that makes the tool feel "too technical/fancy for me."
· *Prevents:* The non-technical target user bouncing because the tool reads as not-for-them.

**Green "ready" screen is the ONLY "safe to close" signal (user-directed — the green light):** Only
the green ✓ screen tells the user it's safe to close the tab. Serves both already-set-up and
just-finished-downloading.
· *Prevents:* A user closing the tab mid-download and killing it.

**Full reframe of `welcome.html` (user call):** From today's key-first "Step 1: add your API key" to
free-on-device-default, with BYOK reframed as the clearly-*optional* upgrade ("Want web-searched,
source-backed answers?").
· *Prevents:* Onboarding that contradicts the shipped Nano-default architecture.

**`welcome.html` keeps the shared `popup.js` (AI-discovered spec correction):** The original ④ spec
said drop `popup.js` from the welcome page. Reading the code showed `popup.js` is already shared and
guarded (engine/status blocks no-op there) and owns the BYOK key-save. So the welcome page KEEPS
`popup.js` (DRY key-save) and ADDS `welcome.js` (ES module) only for the Nano state/download logic.
Load order: `lib/status.js` → `popup.js` → `welcome.js`. Spec updated to match.
· *Prevents:* Re-implementing (and drifting) the key-save logic.

**Popup "Finish setup →" nudge folded into ④ (user-directed):** When On-device is the active engine
but Nano isn't `available`, the popup shows a one-line link to the welcome page. Popup is a classic
script (can't import the ESM provider), so it reads state via a `GET_NANO_STATE` message to the
worker; visibility is the pure `nanoNudgeVisible()` helper in `lib/status.js`.
· *Prevents:* The dead-end where a user picks On-device and nothing visibly happens (model not
downloaded), with no next step.

**Execution approach (joint):** Subagent-driven development (writing-plans → subagent-driven-dev),
6 tasks. Task 1 = UI-gate mock (done, awaiting user comments). Piece ④ builds on a fresh branch
`piece-4-onboarding-download` off `main` (cut at plan Task 2). Spec + plan currently UNCOMMITTED
(user's hard rule — commit only when she asks).

---

## 2026-07-19 — Piece ④ UI gate approved (with edits); Gemini pulled into scope

**UI gate cleared (user-directed).** The Task 1 mock was re-opened and approved with four
edits. Copy is transcribed into the plan's Task 4 Step 1, which is now the source of truth.

**1. Consent screen must be concretely transparent (Stephenie's call).** State 2 now names
**Gemini Nano / Google** outright, states plainly that a **model downloads to the user's
computer**, gives **~4 GB** and Chrome's **22 GB free-space requirement**, and leads with
**"we check your device first — many machines already have it."**
*Rationale:* a silent multi-gigabyte download is the kind of thing that destroys trust when
discovered later (Chrome itself took a news-cycle hit for exactly this in May 2026). This is
a deliberate, scoped exception to the audience-first no-jargon rule — concrete numbers beat
vagueness *on the consent screen specifically*.
*Prevents:* a user finding 4 GB on their disk they never agreed to, and a user on a small
SSD clicking "Turn it on" only to hit an unexplained failure.

**2. Storage figures verified against Chrome docs, not assumed (AI-proposed, user approved).**
The mock's first draft carried a red-flagged guess. Verified: model ~4 GB (`weights.bin`),
22 GB free required, and Chrome **deletes the model if free space later falls below 10 GB**.
*Prevents:* shipping a fabricated number in consent copy — the one place a wrong figure is
not a cosmetic bug.

**3. The 10 GB auto-deletion is deliberately NOT in the copy (user's call).** If it happens,
the user simply sees State 2 again, which is self-explanatory.
*Prevents:* a fourth bullet on an already-dense consent screen, for an edge case the UI
already handles gracefully.

**4. Download failure became its own amber screen, not an inline error (user's call).** The
mock's inline "Setup didn't finish" under a still-blue progress bar read as *still running*.
Now a distinct amber card (`--failed`), `!` badge, failure stated in the `<h2>`, amber bar,
plus "your progress is saved."
*Prevents:* a user staring at a dead progress bar waiting for a download that already failed.
*Design consequence:* `failed` is a **screen, not an availability() state** — set locally by
the download's `catch`. So `screenForState` and its six tests were untouched by this change.

**5. `unavailable` copy drops the Anthropic name (user's call):** *"Ballpark also works with
free or paid models via API keys. See how to add one below (~2 min)."*

**6. Gemini pulled INTO piece ④ (user's call; AI raised the conflict, user chose scope-in).**
Edit 5 promises "free or paid" keys, but `lib/providers/` had only nano + anthropic — the
mock's Gemini field would have saved a key nothing could use. Options presented: scope it in /
Anthropic-only / "coming soon" placeholder. Stephenie chose scope-in.
*Rationale:* the `unavailable` screen exists precisely for users who get no free tier from
Nano; leaving them a paid-only path defeats the purpose. For those users Gemini **is** the
product, not a fallback.
*Prevents:* a dead control on the onboarding page, and a free-tier promise with no free path.
*Cost:* +2 tasks (2b three-engine `engineState`, 2c the provider), a three-engine popup
control (new UI surface → its own UI gate), and a possible new host permission.
*Supersedes* the 2026-07-16 decision deferring the free-Gemini path to v2.5.

## 2026-07-19 — Gemini free-tier grounding probe: docs contradicted by the API (BLOCKING)

**Decision (joint): verify the provider API before building against it, not during.** Task 2c
was written with a **probe as Step 0** rather than starting from code. It paid for itself
immediately.

**What the docs said:** Grounding with Google Search is free (500 RPD) on `gemini-2.5-flash`;
"Not available" on Gemini 3 Flash Preview. This was recorded in the plan as a *non-negotiable
model pin* with an explicit warning not to "upgrade" to a newer model.

**What the API said:** `gemini-2.5-flash` returns *"no longer available to new users."* On
every currently-available model, a `googleSearch`/`google_search` tool returns **HTTP 404
(empty body)**, both casings — while a generic `functionDeclarations` tool on the same
key/model returns **200**. So tool use works; **search grounding specifically does not.**

**Status: BLOCKED, not resolved.** The probe credential began `AQ.` (ephemeral/Live-API shape)
rather than `AIza`, which may itself lack the grounding entitlement. Must re-probe with a real
API key before deciding between: re-pin a working model · re-split the copy into "free, no
search" vs "paid, searched" · drop Gemini back out of ④.

*Prevents:* building a whole provider, prompt, three-engine popup control and onboarding copy
around a capability that doesn't exist for the users we'd be sending there — discovered at
manual-testing time instead of before line one.
*Transferable lesson:* provider pricing/capability pages describe the catalogue, not your
entitlement. A capability that gates a **product promise** needs a live call from a
representative account before it's load-bearing in a plan.

**Process note (user-directed, standing):** an API key was pasted directly into the session
transcript. Correct handling is `! export GEMINI_API_KEY='...'` so the secret stays out of the
conversation, and any key that does land in a transcript gets revoked and reissued.

---

## 2026-07-20 — Gemini blocker resolved; Gemini ships as ungrounded free FALLBACK to Nano

**Re-probe with a real free-tier key (joint; verify-before-building paid off again).** The July
`AQ.` "confound" was a red herring — Google migrated key format `AIza`→`AQ.` "auth keys" (standard
now; same `x-goog-api-key` auth). Findings on a real free key: free-tier **Search grounding is
genuinely unavailable** (pricing page "Not available"; `google_search` tool → `429`, plain calls
200); but **ungrounded** free Gemini works and, on 15/22 calibration fixtures (same scorer/prompt
as the Nano spike), scored **structural 99% / directional 87%** — *above* the Nano baseline (97/82).
· *Prevents:* building a searched-Gemini path around a capability that doesn't exist for free users.
· *Transferable:* a capability gating a product promise needs a live call from a representative
account before it's load-bearing. (Second time this exact lesson paid off on this provider.)

**Decision (Stephenie): keep Gemini, ungrounded, as the free FALLBACK to Nano — sequenced.**
Nano is tried first; Gemini is surfaced only when Nano is **declined / fails / unavailable**. Web
search stays the paid (Anthropic) upgrade. · *Rationale:* the product is "calibration, not
verification" — the free tier (Nano) never searched anyway, so a bigger ungrounded model is
strictly more of the same free job, and it preserves a free path for `unavailable`-hardware users
(the whole reason Gemini was scoped into ④). · *Prevents:* a dead free-tier control / a paid-only
wall for users who can't run Nano.

**Two-segment contextual popup, NOT three-engine (AI-recommended, user approved).** Nano and Gemini
are mutually exclusive free engines, so a third segment would offer a state that can't exist. The
popup stays `[ free | Claude ]`; the free segment renders Nano *or* Gemini contextually. · *Prevents:*
UI clutter + an impossible selection for the least-technical audience.

**engineState/resolveProvider are config-only; activeProvider is the source of truth (AI-flagged
mid-build, corrected).** Writing `resolveProvider` exposed that it's synchronous and can't check live
Nano availability, so an earlier "Nano wins via nanoState" rule in `engineState` couldn't be mirrored.
Both are now config-only — activeProvider (set at onboarding) decides. · *Prevents:* the popup showing
a state the dispatcher won't honor (the invariant the helper exists to guarantee).

**Free-tier flakiness handled as honest failure (AI-proposed, folded in).** `gemini.js` retries
transient `503`; on a persistent `429` daily-cap it returns a neutral "add a paid key" note, not a red
error. · *Prevents:* a scary error card for an expected free-tier limit.

**Positioning shift: free is a taste, Anthropic is recommended (user-directed).** The onboarding now
actively recommends the paid Anthropic key for the "full experience" (RECOMMENDED badge, cost made
concrete: ~1¢/calibration, ~80–100 searches per $1), and the free tiers name their limits honestly
(Nano: "no web search, slower than a paid key"; Gemini: "no web search, daily limit"). · *Softens* the
original "free zero-setup default is the whole pitch" framing — logged so the shift is traceable. ·
*Prevents:* users stalling on a limited free tier thinking it's the full product.

**Popup loses its API-key text box (user-directed).** Key entry lives only on the welcome/setup page;
the popup becomes engine-picker + status + nudge, with links to setup. · *Prevents:* two places to
manage keys drifting apart; a cluttered popup.

**Build status at wrap:** Tasks 2 + 2b + 2c + 3 (the backend/plumbing layer) **built, tested (89/89),
and committed** on `piece-4-onboarding-download` (3 commits). Tasks **4 (welcome page) + 5 (popup)**
remain — the v4 mock (`docs/piece4-mock/welcome-states-remock.html`) is the approved source of truth.
Live Gemini smoke-test (confirm the pinned `gemini-flash-latest` alias serves a plain free call) is
the one thing unverified — deferred to the start of Task 4. Exposed probe key still to be revoked.

---

## 2026-07-24 — Piece ④ UI built: welcome page + popup picker; all plan tasks closed

**Saving a key also activates that engine (AI-caught gap, Stephenie approved).** Key-save
previously only wrote the key; `activeProvider` was set separately by the popup toggle. With key
entry moved to the welcome page and the dispatcher config-only, a user who saved a Gemini key on
the offer screen would have stayed on Nano — a dead end that looks like success. Now saving either
key sets `activeProvider` (+ session-cache clear); the popup toggle remains the way back.
· *Prevents:* the Gemini offer silently not taking effect; "I added my key, nothing changed."

**Consent screen names Gemini Nano despite the re-mock's trim (AI-flagged, kept).** The v4 re-mock
compressed the consent body to "runs privately on your computer," dropping the Nano/Google naming
the 07-19 gate made load-bearing. Built copy reinstates it minimally. Stephenie then edited the
frame (user-directed): FREE pill, headline "Try Ballpark for free," button "Enable Nano" — the
button name accepts mild jargon because the body directly above names the model.
· *Prevents:* softening the transparency disclosure back into vagueness.

**`generativelanguage.googleapis.com` host permission added (plan-flagged risk, confirmed real).**
The MV3 worker's fetch would otherwise be CORS-blocked — every Gemini calibration would fail.
Waives the "no new permissions" constraint as the plan allowed; the next store submission must
justify both host permissions in the listing. · *Prevents:* shipping a free tier that errors on
first use; a rejected store review for an unexplained permission.

**Verification notes:** `gemini-flash-latest` smoke test passed on a fresh free key (HTTP 200,
currently serving `gemini-3.6-flash`). Full page + popup verified by rendering the real files over
localhost (all six welcome screens, popup variants A/B/C vs the mock; real render dispatch and
gemini-offer routing exercised). Tests 89/89 throughout.

**Process note:** the fresh probe key was again pasted into the session transcript — rotate it.

**Build status at wrap:** piece ④ COMPLETE. Five commits on `piece-4-onboarding-download`
(welcome page · popup picker · consent copy tweak · manifest host-permission fix · docs/allowlist
24 files), pushed. Remaining before release: Stephenie's manual end-to-end test in Chrome, PR to
main, version bump 1.1.0 → 1.2.0, hand-assembled zip, store submission with updated listing.
