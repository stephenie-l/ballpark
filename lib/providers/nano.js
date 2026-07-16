// nano.js — On-device provider (Chrome built-in Prompt API / Gemini Nano).
// Runs directly in the MV3 service worker; no offscreen doc, no extra permission.
// Implements: calibrate(payload, config) → Result | TypedStatus. Never searches.
//
// LanguageModel is a browser global — referenced ONLY inside functions via
// globalThis so this module (and the registry that imports it) loads in Node.

export const id = 'nano';
const PROMPT_URL = 'prompts/calibration-nano.md';

const NEEDS_DOWNLOAD_MSG =
  "Ballpark's free on-device model needs a one-time download before it can calibrate.";
const UNAVAILABLE_MSG =
  "This device can't run Ballpark's free on-device model.";
const NANO_INSUFFICIENT_MSG =
  'The on-device model returned an unusable answer for this number.';

// Forces card-shaped JSON out of Nano (same schema the spike harness validated).
const SCHEMA = {
  type: 'object',
  required: ['verdict', 'reference_class', 'comparisons'],
  additionalProperties: false,
  properties: {
    verdict: { type: 'string' },
    reference_class: { type: 'string' },
    comparisons: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        required: ['text'],
        additionalProperties: false,
        properties: { text: { type: 'string' }, source_url: { type: ['string', 'null'] } },
      },
    },
  },
};

let cachedPrompt = null;
async function loadPrompt() {
  if (cachedPrompt) return cachedPrompt;
  const res = await fetch(chrome.runtime.getURL(PROMPT_URL));
  if (!res.ok) throw new Error(`Failed to load Nano prompt: ${res.status}`);
  cachedPrompt = await res.text();
  return cachedPrompt;
}

export async function availability() {
  const LM = globalThis.LanguageModel;
  if (!LM) return 'unavailable';
  return LM.availability();
}

export async function calibrate(payload, config) {
  const state = await availability();
  if (state === 'unavailable') {
    return { status: 'unavailable', provider: id, message: UNAVAILABLE_MSG,
      action: { label: 'Add an API key', page: 'welcome.html' } };
  }
  if (state !== 'available') {
    // 'downloadable' | 'downloading' — model present but not fetched/ready.
    return { status: 'needs-download', provider: id, message: NEEDS_DOWNLOAD_MSG,
      action: { label: 'Set up the free model', page: 'welcome.html' } };
  }

  const system = await loadPrompt();
  const session = await createSession(system);
  try {
    const raw = await promptWithSchema(session, formatUserMessage(payload));
    const parsed = parseOutput(raw);
    if (!parsed) return { insufficient: true, message: NANO_INSUFFICIENT_MSG, provider: id };
    parsed.searched = false; // Nano never searches — deterministic.
    parsed.provider = id;
    return parsed;
  } finally {
    session.destroy?.();
  }
}

// For the later piece-④ consent UI: create() with a download monitor.
export async function download(onProgress) {
  const LM = globalThis.LanguageModel;
  if (!LM) throw new Error('On-device model API not available in this browser.');
  const session = await LM.create({
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded));
    },
  });
  session.destroy?.();
}

async function createSession(system) {
  const LM = globalThis.LanguageModel;
  try {
    return await LM.create({
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      initialPrompts: [{ role: 'system', content: system }],
    });
  } catch {
    return await LM.create({ initialPrompts: [{ role: 'system', content: system }] });
  }
}

async function promptWithSchema(session, userMsg) {
  try {
    return await session.prompt(userMsg, { responseConstraint: SCHEMA });
  } catch {
    return await session.prompt(userMsg);
  }
}

function parseOutput(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!parsed.verdict || !parsed.reference_class || !Array.isArray(parsed.comparisons)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatUserMessage({ number, context, pageTitle, pageUrl }) {
  return [
    `Number: ${number}`,
    `Context: "${context}"`,
    `Page: ${pageTitle || '(no title)'}`,
    `URL: ${pageUrl || '(unknown)'}`,
  ].join('\n');
}
