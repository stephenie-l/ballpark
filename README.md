# Ballpark

A Chrome extension that calibrates unfamiliar numbers as you read. Click any underlined figure for context — is that large, typical, or small for this domain?

## Setup

1. Clone or download this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `ballpark/` directory
5. Click the Ballpark toolbar icon → enter your [Anthropic API key](https://console.anthropic.com/settings/keys)

## How it works

- **Detector** (`lib/detector.js`) scans the page for calibration-worthy numbers (currencies, percentages, large counts) and wraps them in dotted-underline spans
- **Card** (`lib/card.js`) renders the floating calibration card
- **Background worker** (`background.js`) calls the Anthropic API with web search enabled so comparisons are grounded in real data
- **Prompt** (`prompts/calibration.md`) — the core artifact. Edit this to tune calibration quality

## Customizing the prompt

`prompts/calibration.md` is loaded at runtime. Edit it freely and reload the extension to test changes — no build step needed.

## File structure

```
ballpark/
├── manifest.json
├── background.js       # service worker; all API calls go through here
├── content.js          # orchestrates detection, click handling, card
├── content.css         # underline styles + card UI
├── popup.html/js/css   # API key settings
├── prompts/
│   └── calibration.md  # the calibration system prompt
└── lib/
    ├── detector.js     # regex detection + DOM underline injection
    ├── card.js         # card rendering + smart positioning
    └── api.js          # Anthropic API wrapper (agentic loop for web search)
```

## v1 scope

Detection covers: currency (`$40B`, `€500M`, `5 billion dollars`), percentages (`4.5%`, `40bps`), large plain numbers (`2.3M users`, `40,000`).

Out of scope for v1: hover triggering, caching, per-site toggle, reference class overrides.
