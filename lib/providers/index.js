// index.js — provider registry + active-provider resolution.
// Adding a provider later = new module + one registry entry; the dispatcher
// in background.js never changes.

import * as nano from './nano.js';
import * as anthropic from './anthropic.js';
import * as gemini from './gemini.js';

export const providers = { nano, anthropic, gemini };

/**
 * Mode-selection, honest failure: pick exactly ONE active provider from config.
 * Config-only (so lib/status.js's engineState can mirror it EXACTLY, keeping the
 * popup from offering a state this won't honor). activeProvider is the source of
 * truth, set at onboarding time — we only select 'gemini' for users who can't run
 * Nano. Rule:
 *   activeProvider==='anthropic' AND an Anthropic key  → anthropic (paid, searched)
 *   activeProvider==='gemini'    AND a Gemini key       → gemini (free cloud fallback)
 *   otherwise                                           → nano (free on-device default)
 * We never chain or silently swap providers at answer time — provenance stays truthful.
 *
 * @param {{ activeProvider?: string, apiKey?: string, geminiApiKey?: string }} config
 */
export function resolveProvider(config) {
  const { activeProvider, apiKey, geminiApiKey } = config || {};
  if (activeProvider === 'anthropic' && apiKey) return anthropic;
  if (activeProvider === 'gemini' && geminiApiKey) return gemini;
  return nano;
}
