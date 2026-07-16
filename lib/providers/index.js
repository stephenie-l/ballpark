// index.js — provider registry + active-provider resolution.
// Adding a provider later = new module + one registry entry; the dispatcher
// in background.js never changes.

import * as nano from './nano.js';
import * as anthropic from './anthropic.js';

export const providers = { nano, anthropic };

/**
 * Mode-selection, honest failure: pick exactly ONE active provider from config.
 * Rule (approved design): activeProvider==='anthropic' AND a key present →
 * anthropic; otherwise the free on-device default, nano. We never chain or
 * silently swap providers at answer time — provenance stays truthful.
 *
 * @param {{ activeProvider?: string, apiKey?: string }} config
 */
export function resolveProvider(config) {
  const { activeProvider, apiKey } = config || {};
  if (activeProvider === 'anthropic' && apiKey) return anthropic;
  return nano;
}
