// Unit tests for lib/status.js (pure popup helpers), loaded as a classic IIFE
// into jsdom — same pattern as gates/detector.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const STATUS_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'status.js'), 'utf8'
);

function load() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(STATUS_SRC);
  return dom.window.BallparkStatus;
}

test('formatStatus: ran (no count); suppressed shows reason', () => {
  const { formatStatus } = load();

  const ran = formatStatus({ run: true, gate: 'none', reason: '', override: undefined });
  assert.match(ran.line, /on for this page/);
  assert.doesNotMatch(ran.line, /\d/, 'should not show a number count');
  assert.equal(ran.detail, '');

  const off = formatStatus({ run: false, gate: 'gate1-interface', reason: 'Looks like an app or dashboard, not an article', override: undefined });
  assert.match(off.line, /off here/);
  assert.match(off.detail, /app or dashboard/);
});

test('formatStatus: override states explain themselves', () => {
  const { formatStatus } = load();

  const forcedOn = formatStatus({ run: true, gate: 'override-on', reason: '', override: 'force-on' });
  assert.match(forcedOn.detail, /turned it on/);

  const forcedOff = formatStatus({ run: false, gate: 'override-off', reason: '', override: 'force-off' });
  assert.match(forcedOff.detail, /turned it off/);
});

test('formatStatus: inactive page', () => {
  const { formatStatus } = load();
  const none = formatStatus(null); // no content script responded
  assert.match(none.line, /isn't active/);
});

test('nextOverrideAction: contextual button + reset', () => {
  const { nextOverrideAction } = load();
  // running by gate -> offer to turn off
  assert.equal(nextOverrideAction({ run: true, gate: 'none', override: undefined }), 'force-off');
  // suppressed by gate -> offer to turn on
  assert.equal(nextOverrideAction({ run: false, gate: 'gate1-sensitive', override: undefined }), 'force-on');
  // already overridden -> offer reset
  assert.equal(nextOverrideAction({ run: true, gate: 'override-on', override: 'force-on' }), 'reset');
  // inactive page -> no action
  assert.equal(nextOverrideAction(null), null);
});

// Note: assert fields individually, not deepEqual — engineState's return object
// is created in the jsdom window realm, so deepStrictEqual fails a cross-realm
// prototype check (same reason the formatStatus tests assert field-by-field).
test('engineState: no key → nano active, key side disabled', () => {
  const { engineState } = load();
  for (const r of [engineState({}), engineState()]) {
    assert.equal(r.active, 'nano');
    assert.equal(r.enabled.anthropic, false);
  }
});

test('engineState: key + activeProvider anthropic → anthropic active, key enabled', () => {
  const { engineState } = load();
  const r = engineState({ apiKey: 'sk-x', activeProvider: 'anthropic' });
  assert.equal(r.active, 'anthropic');
  assert.equal(r.enabled.anthropic, true);
});

test('engineState: key present but activeProvider nano → nano active, key enabled', () => {
  const { engineState } = load();
  const r = engineState({ apiKey: 'sk-x', activeProvider: 'nano' });
  assert.equal(r.active, 'nano');
  assert.equal(r.enabled.anthropic, true);
});

test('engineState: activeProvider anthropic but no key → nano active (mirrors resolveProvider)', () => {
  const { engineState } = load();
  const r = engineState({ activeProvider: 'anthropic' });
  assert.equal(r.active, 'nano');
  assert.equal(r.enabled.anthropic, false);
});

// --- Contextual free slot (Gemini scoped in as the ungrounded fallback) ---

test('engineState: gemini selected + gemini key → gemini active + freeEngine gemini', () => {
  const { engineState } = load();
  const r = engineState({ geminiApiKey: 'AIza-x', activeProvider: 'gemini' });
  assert.equal(r.active, 'gemini');
  assert.equal(r.freeEngine, 'gemini');
  assert.equal(r.enabled.gemini, true);
});

test('engineState: gemini selected but no gemini key → nano active (mirrors resolveProvider)', () => {
  const { engineState } = load();
  const r = engineState({ activeProvider: 'gemini' });
  assert.equal(r.active, 'nano');
  assert.equal(r.freeEngine, 'nano');
  assert.equal(r.enabled.gemini, false);
});

test('engineState: keys are independent — an anthropic key does not enable gemini', () => {
  const { engineState } = load();
  const r = engineState({ apiKey: 'sk-x', activeProvider: 'gemini' });
  assert.equal(r.active, 'nano');            // wrong key for the selected engine
  assert.equal(r.enabled.anthropic, true);
  assert.equal(r.enabled.gemini, false);
});

test('engineState: both keys present, gemini selected → gemini active', () => {
  const { engineState } = load();
  const r = engineState({ apiKey: 'sk-x', geminiApiKey: 'AIza-x', activeProvider: 'gemini' });
  assert.equal(r.active, 'gemini');
});

// freeEngine can never mislabel the LIT segment: when a free engine is active,
// freeEngine IS that engine. Only when Claude is active is freeEngine a dormant
// label (the free engine the user is set up for).
test('engineState: freeEngine mirrors the active free engine', () => {
  const { engineState } = load();
  assert.equal(engineState({ activeProvider: 'gemini', geminiApiKey: 'AIza-x' }).freeEngine, 'gemini');
  assert.equal(engineState({ activeProvider: 'nano' }).freeEngine, 'nano');
});

test('engineState: Claude active + a saved Gemini key → free segment shows Gemini (dormant)', () => {
  const { engineState } = load();
  const r = engineState({ apiKey: 'sk-x', geminiApiKey: 'AIza-x', activeProvider: 'anthropic' });
  assert.equal(r.active, 'anthropic');
  assert.equal(r.freeEngine, 'gemini');
});

test('engineState: Claude active, no Gemini key → free segment shows Nano (dormant)', () => {
  const { engineState } = load();
  const r = engineState({ apiKey: 'sk-x', activeProvider: 'anthropic' });
  assert.equal(r.active, 'anthropic');
  assert.equal(r.freeEngine, 'nano');
});

test('screenForState: maps each availability state to its screen', () => {
  const { screenForState } = load();
  assert.equal(screenForState('available'), 'ready');
  assert.equal(screenForState('downloadable'), 'consent');
  assert.equal(screenForState('downloading'), 'downloading');
  assert.equal(screenForState('unavailable'), 'unavailable');
});

test('screenForState: unknown/undefined → unavailable (honest fallback)', () => {
  const { screenForState } = load();
  assert.equal(screenForState('wat'), 'unavailable');
  assert.equal(screenForState(undefined), 'unavailable');
});

test('nanoNudgeVisible: on-device active + model not ready → show', () => {
  const { nanoNudgeVisible } = load();
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: 'downloadable' }), true);
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: 'downloading' }), true);
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: 'unavailable' }), true);
});

test('nanoNudgeVisible: model ready → hide (nothing to finish)', () => {
  const { nanoNudgeVisible } = load();
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: 'available' }), false);
});

test('nanoNudgeVisible: on the Anthropic engine → hide', () => {
  const { nanoNudgeVisible } = load();
  // anthropic active (key present) → not a Nano concern
  assert.equal(nanoNudgeVisible({ activeProvider: 'anthropic', apiKey: 'sk-x', nanoState: 'downloadable' }), false);
});

test('nanoNudgeVisible: on the Gemini engine → hide (Nano isn\'t the active free engine)', () => {
  const { nanoNudgeVisible } = load();
  assert.equal(nanoNudgeVisible({ activeProvider: 'gemini', geminiApiKey: 'AIza-x', nanoState: 'downloadable' }), false);
});

test('nanoNudgeVisible: unknown Nano state → hide (no false alarm)', () => {
  const { nanoNudgeVisible } = load();
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano', nanoState: null }), false);
  assert.equal(nanoNudgeVisible({ activeProvider: 'nano' }), false);
});

test('failedCopy: never-started download is honest and surfaces Chrome\'s reason', () => {
  const { failedCopy } = load();
  const c = failedCopy({
    message: 'The device does not have enough space for downloading the on-device model',
    started: false,
  });
  assert.match(c.title, /couldn't start/i);
  assert.match(c.reason, /enough space/);
  // Nothing downloaded, so never claim progress was saved.
  assert.doesNotMatch(c.sub, /progress is saved/i);
});

test('failedCopy: mid-download failure keeps the progress-saved copy', () => {
  const { failedCopy } = load();
  const c = failedCopy({ message: 'network changed', started: true });
  assert.match(c.title, /didn't finish/i);
  assert.match(c.sub, /progress is saved/i);
  assert.match(c.reason, /network changed/);
});

test('failedCopy: no browser message → no dangling reason line', () => {
  const { failedCopy } = load();
  const c = failedCopy({ started: false });
  assert.equal(c.reason, '');
  assert.ok(c.sub.length > 0, 'still gives the user something to do');
});
