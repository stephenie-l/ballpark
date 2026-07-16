// anthropic.js — Anthropic provider (Claude Haiku 4.5 + server-side web_search).
// Background/ESM. Implements the provider interface:
//   calibrate(payload, config) → Result | Insufficient  (provider: 'anthropic')
// Refactored from the former lib/api.js; parseResponse is exported for tests.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const MODEL_LABEL = 'Haiku 4.5'; // human label shown in the card's provenance line
const MAX_TOKENS = 1024;
const PROMPT_URL = 'prompts/calibration.md';

export const id = 'anthropic';

let cachedPrompt = null;
async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const res = await fetch(chrome.runtime.getURL(PROMPT_URL));
  if (!res.ok) throw new Error(`Failed to load calibration prompt: ${res.status}`);
  cachedPrompt = await res.text();
  return cachedPrompt;
}

/**
 * @param {{ number, context, pageTitle, pageUrl }} payload
 * @param {{ apiKey?: string, systemPrompt?: string }} config
 *   systemPrompt lets Node callers (the eval) inject the prompt instead of the
 *   browser-only self-load.
 * @returns {Promise<Result|Insufficient>} both tagged provider:'anthropic'
 */
export async function calibrate(payload, config) {
  const apiKey = config?.apiKey;
  if (!apiKey) throw new Error('No API key set. Open the Ballpark popup to add your Anthropic API key.');

  const systemPrompt = config?.systemPrompt ?? await loadPrompt();
  const userMessage = formatUserMessage(payload);
  const messages = [{ role: 'user', content: userMessage }];
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }];

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, tools, messages }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const searchCount = data.usage?.server_tool_use?.web_search_requests ?? 0;
  const textBlocks = data.content.filter((b) => b.type === 'text').map((b) => b.text);
  const finalText = textBlocks[textBlocks.length - 1] ?? null;
  if (!finalText) throw new Error('No response from model.');

  const result = parseResponse(finalText);
  result.provider = id;
  if (result.insufficient) return result; // no search signal to report
  result.searched = searchCount > 0;      // deterministic: did web_search run?
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

const INSUFFICIENT_MSG = 'Not enough context to calibrate this number.';
function insufficient(message) {
  return { insufficient: true, message: message || INSUFFICIENT_MSG };
}

export function parseResponse(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let parsed = tryParse(cleaned);
  if (parsed === null) {
    // Model wrapped valid JSON in a prose preface (seen on news-001). Scan for
    // a JSON object anywhere in the text: first '{' through the last '}'.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) parsed = tryParse(cleaned.slice(start, end + 1));
  }
  if (parsed === null) {
    console.warn('[Ballpark] Non-JSON model response:', text);
    return insufficient();
  }

  if (parsed.insufficient_context) {
    const msg = typeof parsed.verdict === 'string' && parsed.verdict.trim();
    return insufficient(msg || undefined);
  }

  if (!parsed.verdict || !parsed.reference_class || !Array.isArray(parsed.comparisons)) {
    console.warn('[Ballpark] Malformed calibration JSON:', parsed);
    return insufficient();
  }

  parsed.comparisons = parsed.comparisons.map((c) => ({
    ...c,
    text: (c.text || '').replace(/<\/?cite[^>]*>/g, '').trim(),
  }));
  return parsed;
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
