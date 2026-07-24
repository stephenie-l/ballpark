// Unit tests for the provider layer. Pure functions only — no network, no
// browser globals. The Nano happy path stays covered by the browser harness
// (eval/nano/), which Node can't run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponse, calibrate as anthropicCalibrate, id as anthropicId } from '../lib/providers/anthropic.js';

test('anthropic parseResponse: parses a clean fenced JSON result', () => {
  const text = '```json\n{"verdict":"High for the class","reference_class":"X","comparisons":[{"text":"~2x typical","source_url":null}]}\n```';
  const r = parseResponse(text);
  assert.equal(r.verdict, 'High for the class');
  assert.equal(r.reference_class, 'X');
  assert.equal(r.comparisons.length, 1);
  assert.equal(r.insufficient, undefined);
});

test('anthropic parseResponse: strips <cite> tags from comparison text', () => {
  const text = '{"verdict":"v","reference_class":"rc","comparisons":[{"text":"<cite>foo</cite> bar","source_url":null}]}';
  const r = parseResponse(text);
  assert.equal(r.comparisons[0].text, 'foo bar');
});

test('anthropic parseResponse: insufficient_context flag → insufficient note', () => {
  const text = '{"insufficient_context":true,"verdict":"Can\\u2019t anchor this number."}';
  const r = parseResponse(text);
  assert.equal(r.insufficient, true);
  assert.equal(r.message, 'Can’t anchor this number.');
});

test('anthropic parseResponse: non-JSON prose → insufficient', () => {
  const r = parseResponse('I cannot calibrate this.');
  assert.equal(r.insufficient, true);
});

test('anthropic calibrate: missing apiKey throws a clear error', async () => {
  await assert.rejects(
    () => anthropicCalibrate({ number: '5', context: '', pageTitle: '', pageUrl: '' }, { activeProvider: 'anthropic' }),
    /No API key/
  );
});

test('anthropic id is "anthropic"', () => {
  assert.equal(anthropicId, 'anthropic');
});

import { calibrate as nanoCalibrate, availability as nanoAvailability, id as nanoId } from '../lib/providers/nano.js';

test('nano id is "nano"', () => {
  assert.equal(nanoId, 'nano');
});

test('nano calibrate: unavailable hardware → typed unavailable state (no fetch)', async () => {
  globalThis.LanguageModel = { availability: async () => 'unavailable' };
  const r = await nanoCalibrate({ number: '5', context: '', pageTitle: '', pageUrl: '' }, {});
  assert.equal(r.status, 'unavailable');
  assert.equal(r.provider, 'nano');
  assert.equal(r.action.label, 'Add an API key');
  assert.equal(r.action.page, 'welcome.html');
  delete globalThis.LanguageModel;
});

test('nano calibrate: downloadable → typed needs-download state (no fetch)', async () => {
  globalThis.LanguageModel = { availability: async () => 'downloadable' };
  const r = await nanoCalibrate({ number: '5', context: '', pageTitle: '', pageUrl: '' }, {});
  assert.equal(r.status, 'needs-download');
  assert.equal(r.provider, 'nano');
  assert.match(r.message, /download/i);
  assert.equal(r.action.label, 'Set up the free model');
  assert.equal(r.action.page, 'welcome.html');
  delete globalThis.LanguageModel;
});

test('nano availability: absent LanguageModel global → "unavailable"', async () => {
  delete globalThis.LanguageModel;
  assert.equal(await nanoAvailability(), 'unavailable');
});

import { resolveProvider, providers } from '../lib/providers/index.js';

test('resolveProvider: anthropic selected WITH key → anthropic', () => {
  assert.equal(resolveProvider({ activeProvider: 'anthropic', apiKey: 'sk-x' }).id, 'anthropic');
});

test('resolveProvider: anthropic selected WITHOUT key → nano (no silent broken path)', () => {
  assert.equal(resolveProvider({ activeProvider: 'anthropic' }).id, 'nano');
});

test('resolveProvider: nano selected → nano even if a key is present', () => {
  assert.equal(resolveProvider({ activeProvider: 'nano', apiKey: 'sk-x' }).id, 'nano');
});

test('resolveProvider: empty/undefined config → nano (the default tier)', () => {
  assert.equal(resolveProvider({}).id, 'nano');
  assert.equal(resolveProvider(undefined).id, 'nano');
});

test('providers registry exposes nano and anthropic', () => {
  assert.equal(providers.nano.id, 'nano');
  assert.equal(providers.anthropic.id, 'anthropic');
});

test('anthropic parseResponse: recovers JSON wrapped in a prose preface', () => {
  const text =
    'Based on the search results, here is the calibration:\n\n' +
    '{"verdict":"Large for a federal agency budget","reference_class":"US federal agency annual budgets",' +
    '"comparisons":[{"text":"~2x the median cabinet-level agency","source_url":null}]}';
  const r = parseResponse(text);
  assert.equal(r.insufficient, undefined);
  assert.equal(r.verdict, 'Large for a federal agency budget');
  assert.equal(r.comparisons.length, 1);
});

test('anthropic parseResponse: pure prose with no JSON object → insufficient', () => {
  assert.equal(parseResponse('There is no number to calibrate here.').insufficient, true);
});

test('nano calibrate: malformed on-device output → graceful insufficient (no throw)', async () => {
  globalThis.LanguageModel = {
    availability: async () => 'available',
    create: async () => ({ prompt: async () => 'not json at all', destroy() {} }),
  };
  globalThis.chrome = { runtime: { getURL: (p) => p } };
  globalThis.fetch = async () => ({ ok: true, text: async () => 'SYSTEM PROMPT' });
  const r = await nanoCalibrate({ number: '5', context: '', pageTitle: '', pageUrl: '' }, {});
  assert.equal(r.insufficient, true);
  assert.equal(r.provider, 'nano');
  delete globalThis.LanguageModel; delete globalThis.chrome; delete globalThis.fetch;
});

test('nano calibrate: on-device output missing required fields → graceful insufficient', async () => {
  globalThis.LanguageModel = {
    availability: async () => 'available',
    create: async () => ({ prompt: async () => '{"verdict":"x"}', destroy() {} }),
  };
  globalThis.chrome = { runtime: { getURL: (p) => p } };
  globalThis.fetch = async () => ({ ok: true, text: async () => 'SYSTEM PROMPT' });
  const r = await nanoCalibrate({ number: '5', context: '', pageTitle: '', pageUrl: '' }, {});
  assert.equal(r.insufficient, true);
  assert.equal(r.provider, 'nano');
  delete globalThis.LanguageModel; delete globalThis.chrome; delete globalThis.fetch;
});

// ---- Gemini provider (ungrounded free cloud fallback) ----
import { parseResponse as geminiParse, calibrate as geminiCalibrate, id as geminiId } from '../lib/providers/gemini.js';

const GEMINI_OK = (text) => ({
  status: 200, ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
});
const CARD_JSON = '{"verdict":"High for the class","reference_class":"X","comparisons":[{"text":"~2x typical","source_url":null}]}';

test('gemini id is "gemini"', () => {
  assert.equal(geminiId, 'gemini');
});

test('gemini parseResponse: parses clean fenced JSON', () => {
  const r = geminiParse('```json\n' + CARD_JSON + '\n```');
  assert.equal(r.verdict, 'High for the class');
  assert.equal(r.comparisons.length, 1);
  assert.equal(r.insufficient, undefined);
});

test('gemini parseResponse: insufficient_context flag → insufficient note', () => {
  const r = geminiParse('{"insufficient_context":true,"verdict":"Can\'t anchor this."}');
  assert.equal(r.insufficient, true);
  assert.equal(r.message, "Can't anchor this.");
});

test('gemini parseResponse: recovers JSON wrapped in a prose preface', () => {
  const r = geminiParse('Here is the calibration:\n\n' + CARD_JSON);
  assert.equal(r.insufficient, undefined);
  assert.equal(r.verdict, 'High for the class');
});

test('gemini parseResponse: pure prose with no JSON → insufficient', () => {
  assert.equal(geminiParse('No number to calibrate here.').insufficient, true);
});

test('gemini calibrate: missing geminiApiKey throws a clear error', async () => {
  await assert.rejects(
    () => geminiCalibrate({ number: '5', context: '', pageTitle: '', pageUrl: '' }, { activeProvider: 'gemini' }),
    /Gemini API key/
  );
});

test('gemini calibrate: happy path → parsed result, searched:false, provider+model set', async () => {
  globalThis.fetch = async () => GEMINI_OK(CARD_JSON);
  const r = await geminiCalibrate(
    { number: '5', context: '', pageTitle: '', pageUrl: '' },
    { geminiApiKey: 'AIza-x', systemPrompt: 'SYS', retryDelayMs: 0 },
  );
  assert.equal(r.provider, 'gemini');
  assert.equal(r.searched, false);        // free tier never searches — deterministic
  assert.equal(r.verdict, 'High for the class');
  assert.equal(typeof r.model, 'string');
  delete globalThis.fetch;
});

test('gemini calibrate: persistent 429 (daily cap) → neutral rate-limited note, not a throw', async () => {
  globalThis.fetch = async () => ({ status: 429, ok: false, json: async () => ({ error: { message: 'quota' } }) });
  const r = await geminiCalibrate(
    { number: '5', context: '', pageTitle: '', pageUrl: '' },
    { geminiApiKey: 'AIza-x', systemPrompt: 'SYS', retryDelayMs: 0 },
  );
  assert.equal(r.status, 'rate-limited');
  assert.equal(r.provider, 'gemini');
  assert.match(r.message, /limit/i);
  assert.equal(r.action.page, 'welcome.html');
  delete globalThis.fetch;
});

test('gemini calibrate: retries a transient 503 then succeeds', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { status: 503, ok: false, json: async () => ({}) };
    return GEMINI_OK(CARD_JSON);
  };
  const r = await geminiCalibrate(
    { number: '5', context: '', pageTitle: '', pageUrl: '' },
    { geminiApiKey: 'AIza-x', systemPrompt: 'SYS', retryDelayMs: 0 },
  );
  assert.equal(calls, 2);                 // retried once, then succeeded
  assert.equal(r.verdict, 'High for the class');
  delete globalThis.fetch;
});

test('resolveProvider: gemini selected WITH gemini key → gemini', () => {
  assert.equal(resolveProvider({ activeProvider: 'gemini', geminiApiKey: 'AIza-x' }).id, 'gemini');
});

test('resolveProvider: gemini selected WITHOUT gemini key → nano (no silent broken path)', () => {
  assert.equal(resolveProvider({ activeProvider: 'gemini' }).id, 'nano');
});

test('resolveProvider: a gemini key present but nano selected → nano (never auto-switches)', () => {
  assert.equal(resolveProvider({ activeProvider: 'nano', geminiApiKey: 'AIza-x' }).id, 'nano');
});

test('providers registry exposes gemini', () => {
  assert.equal(providers.gemini.id, 'gemini');
});
