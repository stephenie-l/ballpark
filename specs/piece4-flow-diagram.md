# Piece ④ — living diagram (PROVISIONAL, updated 2026-07-20)

> Working memory, not documentation. Expect this to be wrong in places and to change
> at every wrap. Green = built & verified · amber = planned · red = blocked.

**2026-07-20 — the Gemini blocker is RESOLVED.** A real free-tier `AQ.` key (Google
migrated key format: `AIza` → `AQ.` "auth keys" — the July `AQ.` "confound" was a red
herring; that was already a normal key) proved: free-tier **grounding is genuinely
unavailable** (pricing page: "Not available" on every model; live call → `429` on the
`google_search` tool while plain calls 200). BUT **ungrounded** free Gemini works and, on
15 of the 22 calibration fixtures, **beat the Nano baseline** (structural 99% vs 97%,
directional 87% vs 82%). So Gemini stays IN ④ — as an **ungrounded free FALLBACK to Nano**,
not a flat peer, and not a searched tier. Web search remains the paid (Anthropic) upgrade.

## 1. What the user sees (sequenced onboarding — Nano first, Gemini only as fallback)

```mermaid
flowchart TD
    open([User opens welcome.html]) --> avail{"nano.availability()"}

    avail -->|available| ready["✅ ready · 'You're all set'<br/><b>only screen that says<br/>safe to close this tab</b>"]
    avail -->|downloadable| consent["consent · 'Turn on free calibrator'<br/>names Gemini Nano/Google · ~4 GB · 22 GB free<br/><i>+ light italic decline line under the button:</i><br/><i>'Not now — try the free cloud version instead'</i>"]
    avail -->|downloading| dl["downloading · progress bar<br/>'keep this tab open'"]
    avail -->|unavailable / unknown| goffer

    consent -->|Turn it on| dl
    consent -->|decline 'Not now'| goffer
    dl -->|success| reread{"re-read availability()<br/><i>never assume success</i>"}
    reread --> ready
    dl -->|catch| failed["failed 🟠 amber card<br/>'progress is saved'<br/>Try again · <i>or use free cloud</i>"]
    failed -->|Try again| dl
    failed -->|or use free cloud| goffer

    goffer["GEMINI OFFER · free FALLBACK<br/>warm caveats: no web search · daily limit<br/>still free — try before you pay<br/>get free key (aistudio) → save → using Gemini"]

    goffer -.upgrade anytime.-> upgrade
    ready -.optional upgrade.-> upgrade
    upgrade["ANTHROPIC KEY · paid upgrade<br/>web-searched, source-backed answers"]

    classDef done fill:#dafbe1,stroke:#1a7f37
    classDef warn fill:#fdf6e6,stroke:#bf8700
    class ready done
    class consent,dl,failed,goffer,upgrade warn
```

**Sequencing rule (load-bearing):** a user never sees Nano and Gemini as a *choice*. Nano is
tried first; Gemini is surfaced **only** when Nano is declined, fails, or is unavailable. If
Nano works, Gemini never appears. `failed` is still a *screen*, not an `availability()` state.

## 1b. Which free engine is "active" (contextual free slot)

```mermaid
flowchart LR
    r{"resolveProvider(config)<br/>config-only, no live availability"}
    r -->|activeProvider=anthropic + key| a2["anthropic (paid)"]
    r -->|activeProvider=gemini + key| gem2["gemini (free cloud)"]
    r -->|otherwise| nano2["nano (free default)"]
```

**activeProvider is the source of truth** (set at onboarding time — we only select `'gemini'`
for users who can't run Nano). `resolveProvider` is **config-only** (it's sync — it can't check
live `availability()`), and `engineState` mirrors it EXACTLY so the popup can never offer a
state the dispatcher won't honor. `engineState` adds `freeEngine` = which engine the single free
segment renders: it IS `active` when a free engine is active (never mislabel the lit segment),
and when Claude is active it's the dormant label (Gemini if a Gemini key is saved, else Nano).
*(Earlier drafts had a runtime "Nano wins via nanoState" override — dropped 2026-07-20 because
it can't be mirrored by a sync, config-only resolver.)*

## 2. Where the code lives (and what's actually built)

```mermaid
flowchart LR
    subgraph page["welcome.html (extension PAGE tab — durable context)"]
        wjs["welcome.js (module)<br/>🟠 Task 4 — states + decline + Gemini offer"]
    end
    subgraph popup["popup.html"]
        pjs["popup.js (classic)<br/>🟠 Task 5 — TWO-segment picker,<br/>free segment renders Nano OR Gemini"]
    end
    subgraph worker["background.js (MV3 worker, ESM)"]
        disp["dispatcher<br/>✅ GET_NANO_STATE (Task 3)"]
        reg["lib/providers/index.js<br/>resolveProvider (free slot + anthropic)"]
    end

    status["lib/status.js (classic, shared)<br/>✅ screenForState + nanoNudgeVisible (Task 2)<br/>🟠 engineState → contextual free slot (Task 2b)"]

    wjs --> status
    pjs --> status
    pjs -->|GET_NANO_STATE| disp
    wjs -->|"imports availability() + download()"| nano
    disp --> reg
    reg --> nano["lib/providers/nano.js ✅"]
    reg --> anth["lib/providers/anthropic.js ✅ (searched)"]
    reg --> gem["lib/providers/gemini.js<br/>🟠 Task 2c — UNGROUNDED (searched:false)"]

    classDef done fill:#dafbe1,stroke:#1a7f37
    classDef warn fill:#fdf6e6,stroke:#bf8700
    class gem warn
```

**Two-segment, not three (design call 2026-07-20).** Nano and Gemini are mutually exclusive
free engines by construction, so the popup keeps **two** segments — `[ free | Claude ]` — and
the free segment renders/controls contextually (On-device *or* Gemini, never both). The Claude
segment is unchanged. This is a net *simplification* of the previously-planned three-engine
control: the smarts move into the one free-slot resolver above, not the UI.

**Why the download runs in the page tab:** a tab lives as long as it's open. The popup dies
on blur; the MV3 worker is killed after ~30s idle. Neither survives a multi-minute download.
This is what makes "keep this tab open" load-bearing copy rather than decoration.

## 3. Resolved decisions + remaining engineering notes

- **Gemini is ungrounded.** No `google_search` tool (free tier 404s/429s it), `searched:false`
  always, `provider:'gemini'`. Model = a current flash (probe used `gemini-3-flash-preview` /
  `gemini-flash-latest`; pin the stable alias at build). Same JSON schema/prompt shape as the
  others so the card renders identically.
- **Free-tier operational friction (must handle in gemini.js):** transient `503` "high demand"
  → retry with backoff; a **daily request cap** → on `429`-after-retries, degrade to a neutral
  "free daily limit reached — try again tomorrow or add a paid key" note (not a red error).
  These are real: the eval hit both. This is the honest-failure rule applied to a flaky free tier.
- **Auth:** `x-goog-api-key` header (unchanged from plan); key format is now `AQ.`; endpoint
  `POST v1beta/models/<model>:generateContent`. Verify whether the host permission
  `https://generativelanguage.googleapis.com/*` must be added to `manifest.json` (Task 6).

**Superseded:** the old "open question blocking everything" diagram (does free-tier grounding
work?) — answered NO, and the fork resolved to "keep Gemini, ungrounded, as Nano's fallback."
