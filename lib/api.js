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

  const parsed = parseResponse(finalText);
  // Deterministic signal: did the server-side web_search tool actually run?
  parsed.searched = searchCount > 0;
  return parsed;
}

function formatUserMessage({ number, context, pageTitle, pageUrl }) {
  return [
    `Number: ${number}`,
    `Context: "${context}"`,
    `Page: ${pageTitle || '(no title)'}`,
    `URL: ${pageUrl || '(unknown)'}`,
  ].join('\n');
}

function parseResponse(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Model returned invalid JSON. Raw: ' + text.slice(0, 200));
  }
  
  // Strip <cite> tags from comparison text — web_search wraps cited portions
  // in citation markers that we don't want to render literally.
  if (Array.isArray(parsed.comparisons)) {
    parsed.comparisons = parsed.comparisons.map((c) => ({
      ...c,
      text: (c.text || '').replace(/<\/?cite[^>]*>/g, '').trim(),
    }));
  }
  
  return parsed;
}