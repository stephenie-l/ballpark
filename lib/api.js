// api.js — Anthropic API wrapper for the background service worker
// ES module; imported by background.js.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 1024;

/**
 * Call the Anthropic API with the calibration prompt.
 * Uses the built-in web_search tool so the model can ground comparisons.
 * The web_search tool is server-side, so we get a single response with
 * search results already integrated — no agentic loop needed.
 *
 * @param {string} apiKey
 * @param {string} systemPrompt — loaded from prompts/calibration.md
 * @param {{ number: string, context: string, pageTitle: string, pageUrl: string }} payload
 * @returns {Promise<{ verdict, reference_class, comparisons, searched }>}
 */
export async function calibrate(apiKey, systemPrompt, payload) {
  const userMessage = formatUserMessage(payload);
  const messages = [{ role: 'user', content: userMessage }];

  const tools = [
    {
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 1,
    },
  ];

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json();

  const searchCount = data.usage?.server_tool_use?.web_search_requests ?? 0;

  // Collect all text blocks — server-side tools may produce multiple,
  // and we want the model's final answer (typically the last one).
  const textBlocks = data.content.filter((b) => b.type === 'text').map((b) => b.text);
  const finalText = textBlocks[textBlocks.length - 1] ?? null;

  if (!finalText) {
    throw new Error('No response from model.');
  }

  const result = parseResponse(finalText);
  // "Can't calibrate" results have no search signal to report.
  if (result.insufficient) return result;
  // Deterministic signal: did the server-side web_search tool actually run?
  result.searched = searchCount > 0;
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

// A clean "couldn't calibrate" outcome the card renders as a neutral note
// rather than a red error. Used whenever we can't produce a real calibration —
// the model bowed out, or its output wasn't usable.
const INSUFFICIENT_MSG = 'Not enough context to calibrate this number.';

function insufficient(message) {
  return { insufficient: true, message: message || INSUFFICIENT_MSG };
}

function parseResponse(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // The model didn't return JSON — typically a prose refusal for a number
    // that can't be anchored to any reference class. Show a clean note, not a
    // raw dump. Keep the raw text in the worker console for debugging.
    console.warn('[Ballpark] Non-JSON model response:', text);
    return insufficient();
  }

  // The model explicitly signalled the number can't be calibrated.
  if (parsed.insufficient_context) {
    const msg = typeof parsed.verdict === 'string' && parsed.verdict.trim();
    return insufficient(msg || undefined);
  }

  // Defensive: valid JSON but missing the fields the card needs to render.
  if (!parsed.verdict || !parsed.reference_class || !Array.isArray(parsed.comparisons)) {
    console.warn('[Ballpark] Malformed calibration JSON:', parsed);
    return insufficient();
  }

  // Strip <cite> tags from comparison text — web_search wraps cited portions
  // in citation markers that we don't want to render literally.
  parsed.comparisons = parsed.comparisons.map((c) => ({
    ...c,
    text: (c.text || '').replace(/<\/?cite[^>]*>/g, '').trim(),
  }));

  return parsed;
}