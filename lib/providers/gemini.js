// gemini.js — Google Gemini provider (free-tier cloud, UNGROUNDED).
// Background/ESM. Implements the provider interface:
//   calibrate(payload, config) → Result | Insufficient | TypedStatus  (provider: 'gemini')
//
// The free tier has NO Search grounding (confirmed by live probe — the pricing
// page says "Not available" and the google_search tool 429s), so this provider
// never searches: searched:false always, deterministically. The free tier is also
// flaky — transient 503s under load and a daily request cap — so calibrate retries
// 503, and on a persistent 429 returns a NEUTRAL typed note (honest failure, not a
// red error) pointing at the paid upgrade. parseResponse is exported for tests.

const MODEL = 'gemini-flash-latest'; // stable "current flash" alias (NOT 2.5 — 404s for new keys)
const MODEL_LABEL = 'Gemini';        // human label for the card's provenance line
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const PROMPT_URL = 'prompts/calibration-gemini.md';
const MAX_ATTEMPTS = 4;               // 1 try + up to 3 retries on 503/429
const DEFAULT_RETRY_DELAY_MS = 1500;  // base backoff, grows per attempt

export const id = 'gemini';

const INSUFFICIENT_MSG = 'Not enough context to calibrate this number.';
const RATE_LIMIT_MSG =
  "Ballpark's free cloud tier hit its daily limit. Try again tomorrow, or add a paid key for unlimited, web-searched answers.";

let cachedPrompt = null;
async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const res = await fetch(chrome.runtime.getURL(PROMPT_URL));
  if (!res.ok) throw new Error(`Failed to load Gemini prompt: ${res.status}`);
  cachedPrompt = await res.text();
  return cachedPrompt;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{ number, context, pageTitle, pageUrl }} payload
 * @param {{ geminiApiKey?: string, systemPrompt?: string, retryDelayMs?: number }} config
 *   systemPrompt lets Node callers inject the prompt instead of the browser
 *   self-load; retryDelayMs lets tests skip the backoff wait.
 * @returns {Promise<Result|Insufficient|TypedStatus>} tagged provider:'gemini'
 */
export async function calibrate(payload, config) {
  const apiKey = config?.geminiApiKey;
  if (!apiKey) throw new Error('No Gemini API key set. Open the Ballpark setup page to add your free Google key.');

  const systemPrompt = config?.systemPrompt ?? await loadPrompt();
  const retryDelayMs = config?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: formatUserMessage(payload) }] }],
    generationConfig: { responseMimeType: 'application/json' },
  };

  // Retry transient 503 (overload) and 429 (rate) with growing backoff.
  let res;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    res = await fetch(`${API_BASE}/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if ((res.status === 503 || res.status === 429) && attempt < MAX_ATTEMPTS - 1) {
      await sleep(retryDelayMs * (attempt + 1));
      continue;
    }
    break;
  }

  // Persistent 429 = the free-tier daily cap. Neutral, actionable note — not an error.
  if (res.status === 429) {
    return { status: 'rate-limited', provider: id, message: RATE_LIMIT_MSG,
      action: { label: 'Add a paid key', page: 'welcome.html' } };
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p) => p.text).filter(Boolean).join('') : null;
  if (!text) throw new Error('No response from model.');

  const result = parseResponse(text);
  result.provider = id;
  if (result.insufficient) return result;
  result.searched = false; // free tier never searches — deterministic, per the ② rule
  result.model = MODEL_LABEL;
  return result;
}

function formatUserMessage({ number, context, pageTitle, pageUrl }) {
  return [
    `Number: ${number}`,
    `Context: "${context}"`,
    `Page: ${pageTitle || '(no title)'}`,
    `URL: ${pageUrl || '(unknown)'}`,
  ].join('\n');
}

function insufficient(message) {
  return { insufficient: true, message: message || INSUFFICIENT_MSG };
}

// Same tolerant contract as anthropic.parseResponse: strip fences, else scan for a
// JSON object anywhere in the text; honor insufficient_context; require the card
// fields or degrade to a neutral insufficient note.
export function parseResponse(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed = tryParse(cleaned);
  if (parsed === null) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) parsed = tryParse(cleaned.slice(start, end + 1));
  }
  if (parsed === null) {
    console.warn('[Ballpark] Non-JSON Gemini response:', text);
    return insufficient();
  }

  if (parsed.insufficient_context) {
    const msg = typeof parsed.verdict === 'string' && parsed.verdict.trim();
    return insufficient(msg || undefined);
  }

  if (!parsed.verdict || !parsed.reference_class || !Array.isArray(parsed.comparisons)) {
    console.warn('[Ballpark] Malformed Gemini calibration JSON:', parsed);
    return insufficient();
  }
  return parsed;
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
