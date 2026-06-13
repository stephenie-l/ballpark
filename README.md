# Ballpark

> A Chrome extension that helps you calibrate unfamiliar numbers as you read — built for people working at the edge of what they know.

You're reading that a cybersecurity startup raised a $28M Series B, a biotech's Phase II trial enrolled 180 patients, or a hardware brand runs 34% gross margins. Is that big? Small? Normal for that field? If you don't live in the industry you have no reference frame — and your existing intuition often misleads you (a 34% margin is alarming for SaaS but healthy for physical goods). Ballpark gives you a quick directional sense, in place, without leaving the page.

![Ballpark calibration card on a news article — "is $444 million a lot?"](assets/screenshots/demo.png)

## What it does

Numbers on the page get a subtle dotted underline. Click one and a small card appears with:

- **A one-line verdict** — is this number large, small, or typical for its context?
- **The reference class** — *what* it's being compared against (e.g. "for a Series B in security software" or "for a Phase II oncology trial")
- **One or two grounded comparisons** to anchor your intuition
- **A source indicator** — `✓ Searched` (green) if the answer was checked against a live web search, or `~ From memory` (gray) if it came from the model's prior knowledge

![Anatomy of a card: the number clicked, the verdict, the reference class, the comparisons, and the source indicator](assets/screenshots/anatomy.png)

## Where it runs (and where it stays quiet)

An always-on tool that underlined every number on every page would be noise — and if it cried wolf on every price and order total, you'd learn to ignore the underlines entirely. So before Ballpark underlines anything, it decides whether the page is even worth calibrating:

- **It stays off app-like and private surfaces** — your email, your bank and brokerage accounts, dashboards, admin consoles, and other working tools (including ones it's never heard of). Numbers there are personal or transactional, not the kind you read to form a view.
- **It stays off commerce pages** — product and cart pages, travel booking, real-estate listings, menus — where prices and ratings aren't worth calibrating.
- **It runs on articles and other reading surfaces**, where calibrating an unfamiliar figure actually helps.

These decisions are made locally in your browser — no API call, no key required, nothing sent anywhere. When it's unsure, it stays quiet (a missed underline is cheaper than an intrusive one).

Click the Ballpark toolbar icon to see what it decided on the current page — *"Ran — found N numbers"* or *"Didn't run — looks like an app"* — and to **override it per-site**: turn Ballpark on for a page it skipped, or off for one it ran on. Your choice sticks for that site.

## Who it's for

Ballpark is for people who read to understand and form a view, in territory where their numerical intuition isn't calibrated yet:

- **Frontier readers** keeping up with new tech and markets — AI, security, biotech, climate hardware — where the numbers are too new for anyone to have a settled sense of scale.
- **Domain crossers** moving into an unfamiliar industry (SaaS to physical consumer goods, or making sense of the pharma scene), where insiders carry intuitions you don't and your old ones can lead you astray.
- **Analysts and investors** — market researchers, financial analysts, solo traders — digesting unfamiliar numbers all day and needing a fast first read before they dig in.

It's deliberately *not* for everyday numbers you already have a feel for. It earns its place when the territory is unfamiliar.

## Calibration, not verification

Ballpark is built to give you a **rough directional sense**, not to fact-check. The distinction matters:

- A *verification* tool says "this number is correct/incorrect" and you'd be right to trust it.
- A *calibration* tool says "this is on the high side for this kind of thing" and helps your intuition without asking you to outsource your judgment.

When the source indicator reads `~ From memory`, treat the specifics loosely — the *direction* (big/small/typical) is the signal, not the exact comparison figure. And if you're producing analysis someone will rely on, treat Ballpark as the fast first read that tells you where to look closer — not the number you put in the report. This is an intentional design constraint, not a limitation the tool is trying to hide.

## How it works

**On page load**, Ballpark runs its gates locally (see *Where it runs*) to decide whether the page is worth calibrating — no API call, no key needed — and only underlines numbers if it does. **On click:**

```
You click a number
   → content script grabs the number + ~200 chars of surrounding context + page title/URL
   → background service worker checks the session cache (number + page)
       → hit:  returns the stored verdict instantly, no API call
       → miss: calls the Anthropic API with your key
   → Claude returns a short calibration verdict (optionally using one web search)
   → result is cached, then the card renders inline next to the number
```

No data passes through any server but Anthropic's, and that call is made with *your* API key.

## Install

**From the Chrome Web Store** (recommended): _add listing URL_. After installing, a setup guide opens automatically — paste your Anthropic API key and you're going in under a minute.

**As an unpacked extension (development):**

1. Clone this repo
2. Go to `chrome://extensions`, enable **Developer mode** (top right)
3. Click **Load unpacked** and select the cloned repo's root folder
4. Click the Ballpark icon in your toolbar and paste your Anthropic API key

## Bring your own API key

Ballpark is free and has no backend. You supply your own [Anthropic API key](https://console.anthropic.com/), and you pay only for what you use — the calls go directly from your browser to Anthropic.

Why this model:

- **No cost to run** for the developer, so the tool can stay free and open
- **No middleman** sees your data — there's no Ballpark server to route through
- **Full transparency** on usage and spend, since it's your own account

The honest tradeoff: each *new* calibration is a real API call, and calls that trigger a web search cost more (search results are re-fed to the model and counted as input tokens). In practice we measured **roughly 1¢ per number you look up** (about 80–100 per dollar) — and because most underlined numbers are never clicked, typical reading sessions cost far less. You can track real spend on your Anthropic Platform dashboard.

Repeats are free, though: re-clicking a number you've already checked on the same page is served instantly from a local cache with no API call. The cache lives in `chrome.storage.session`, so it survives the frequent MV3 service-worker restarts but clears when you fully quit the browser or reload the extension — meaning the first click on a given number in a new session pays again.

The model used is Claude Haiku 4.5 — chosen for speed and low cost, with web search capped at a single use per call.

## Privacy

Ballpark collects **nothing**. There is no analytics, no telemetry, and no server operated by this project.

- **Read locally (never leaves your browser):** scanning the page to decide whether to run (the gates) and to underline numbers — all on your machine, no key required.
- **Sent to Anthropic (only when you click a number):** that number plus ~200 characters of surrounding text, and the page title and URL, using your API key, to generate the calibration. [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).
- **Stored:** only your API key and any per-site on/off overrides you set, kept locally in `chrome.storage.local` on your own machine. Removing the extension removes them.

Full details: [Privacy Policy](https://stephenieliew.com/ballpark/privacy)

## Tech

- Manifest V3, vanilla JS, no build step, no new permissions beyond `storage` + the Anthropic host
- Content scripts: number detection (`lib/detector.js`), card rendering (`lib/card.js`), and the page-level gates (`lib/gates.js`); the popup status/override panel uses `lib/status.js`. The background service worker (`lib/api.js`) makes the API calls
- Gating (which pages run, and which numbers get underlined) is **local and deterministic** — only a *click* hits the API
- The calibration prompt lives in `prompts/calibration.md` — that's the file to iterate on for answer quality
- Claude Haiku 4.5 with the server-side `web_search_20250305` tool (`max_uses: 1`)

## Development

The **shipped extension** has no build step and no runtime dependencies — it's vanilla JS loaded straight into Chrome. There is a small **dev-only** setup for tests; nothing from it is bundled into the extension.

```bash
npm install   # installs jsdom, the only dev dependency
npm test      # runs the test suite via Node's built-in runner
```

Testing splits into three tiers:

- **`npm test`** runs the deterministic suites (no API key): `test/detector.test.js` — what counts as a number — and `test/gates.test.js` — the page-level run/suppress decision and which numbers get underlined, asserted against a labeled fixture corpus.
- **`npm run eval`** (needs `ANTHROPIC_API_KEY`) checks *calibration quality* against real cases — it prints a report, never gates.
- **`npm run eval:decisions`** scores *decision accuracy* (false positives weighted heavier than false negatives) over borderline pages — also a report, no key needed.

The detector and the gates are both precision/recall balances that degrade silently, so run the relevant suite after any change there.

## Known limitations

- **Web pages only.** Ballpark reads text from the page's DOM, so it can't see PDFs opened in Chrome's built-in viewer, content in native desktop apps, or text that's rendered to a canvas rather than the DOM — notably Google Docs. A report opened as a PDF won't light up; the same report as a web article will.
- **Web search inflates cost.** Search results count as input tokens, so searched calls are meaningfully pricier than memory-only ones.
- **Memory-only answers are directional, not precise.** When the model hasn't searched, it's now instructed to stick to relative/scale comparisons (ratios, multiples, percentiles) rather than inventing specific named facts like prices or deal dates. This sharply reduces confidently-wrong specifics, but the `~ From memory` indicator still means "trust the direction, not the exact figure" — the framing remains calibration, not verification.

## Roadmap

- **Next: per-number triage.** Page-level gating (above) keeps Ballpark off the wrong *surfaces*; the next step is suppressing the numbers you already grasp *within* a valid page — "50,000 reward points" is noise, "50,000 deaths" isn't — plus a graceful *"not enough context to calibrate this"* message for numbers that genuinely can't be anchored.
- A toggle to turn web search on or off — force grounding on every call for reliability, or skip it for speed and lower cost.
- A subtle "from cache" indicator on the card (the `cached` flag is already passed through from the background worker; it just needs surfacing).
- Persisting the cache across sessions (currently session-scoped via `chrome.storage.session`).

## License

[MIT](LICENSE) © 2026 Stephenie Liew
