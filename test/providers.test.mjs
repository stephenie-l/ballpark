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
  assert.match(r.message, /add an api key/i);
  delete globalThis.LanguageModel;
});

test('nano calibrate: downloadable → typed needs-download state (no fetch)', async () => {
  globalThis.LanguageModel = { availability: async () => 'downloadable' };
  const r = await nanoCalibrate({ number: '5', context: '', pageTitle: '', pageUrl: '' }, {});
  assert.equal(r.status, 'needs-download');
  assert.equal(r.provider, 'nano');
  assert.match(r.message, /download/i);
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
