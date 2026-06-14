# Gate 3 — per-number triage + graceful failure (seed notes)

**Status:** NOT brainstormed yet — direction + seeds only. When picked up, run the
normal brainstorm → spec → plan → build cycle.
**Part of:** Workstream B (calibration-worthiness redesign). The last of the three
gates: Gate 1 (surface exclusion) ✅, Gate 2 (commerce page-type) ✅, **Gate 3**.

> Naming note: refer to work by **topic** (this is "Gate 3"), not by position.
> The build order changed (cost-reduction is now prioritized *before* Gate 3), so
> "Spec 4"-style numbers are misleading. Date-prefixed topic-slug filenames are the
> canonical IDs.

## Direction (from the original handoff doc)

Decide whether a *specific number* on an otherwise-valid page is worth calibrating.
Two lines of defense:
1. **Local underline decision (cheap, in-browser, runs on every number).** Kills
   visual clutter pre-API. The "graspability gap" keep-rule: **number × scale-word
   × the-thing-being-counted** — the noun is the crux ("50,000 deaths" keep vs
   "50,000 reward points" suppress). Cheap-and-local signals: scale-word scan,
   magnitude parsing, currency/units, mechanical suppressions (dates/SKUs/etc.).
2. **Click-time graceful failure (backstop).** When a number that leaks through
   isn't calibratable, fail with a clean human message — **this is the old
   raw-JSON bug; it's structurally Gate 3's backstop, not a separate fix.**

The v1 fork (unsettled): how hard to attack the noun-context problem locally —
(a) keyword noun-sense list (brittle), (b) lean on scale-words/units/magnitude +
let the click-time graceful failure clean up misses (shippable), (c) on-device
classifier (likely overkill). Lean (b), but it's a judgment call. Magnitude
threshold and the small-direction gap ("0.0001 grams") are tune/park items.

## Folded in from the 2026-06-13 Tier 2 perf eval (`npm run eval`)

- **The graceful-failure gap is real and measured.** Case `fail-003` (a number that
  "defies easy classification") returned a confident verdict — *"Extraordinarily
  large — roughly 1,600× the Earth-Sun distance"* — instead of bowing out. The
  prompt's `insufficient_context` steering is too weak; Gate 3's second line must
  cover this. **Two concrete tasks:** (1) tune `prompts/calibration.md` to steer
  toward `insufficient_context` on truly-uncalibratable numbers; (2) add a Tier 2
  fixture for the nonsensical case — CLAUDE.md noted none existed, and `fail-003`
  is now exactly it, so it's a ready-made regression target (flip it from a miss to
  a pass once the prompt is tuned).

- **Detector precision bug to fix here.** `$3,500 mixed-reality` underlines as
  `"$3,500 m"` (the detector eats a following k/m/b/t word-letter as a magnitude
  suffix); `$X <word>` also carries a trailing space. It's a `lib/detector.js`
  regex bug squarely in Gate 3 / detector-precision territory. See
  [[project-detector-suffix-letter-bleed]]. A Tier 1 `todo` test asserting the
  clean token would lock the fix.

## NOT Gate 3 (separate small follow-ups, captured so they're not lost)

- **15-word verdict overshoot** (5/22 in the eval, 15–17 words vs the <15 cap): a
  one-line `prompts/calibration.md` tweak. Standalone prompt fix, do anytime.
- **Absolute-vs-peer fixture review** (eval Bucket B: `news-001`, `ai-001`,
  `edge-002`, `fail-002`, `growth-001`): the model picks a *peer* reference class
  and says "typical" where fixtures encode *absolute* "large". Per the
  calibration-not-verification philosophy the model is arguably right — these are
  **Tier 2 fixture-curation** decisions, not prompt bugs.
