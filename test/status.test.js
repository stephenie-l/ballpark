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

test('formatStatus: ran shows count; suppressed shows reason', () => {
  const { formatStatus } = load();

  const ran = formatStatus({ run: true, gate: 'none', reason: '', count: 12 });
  assert.match(ran.line, /Ran/);
  assert.match(ran.line, /12/);

  const off = formatStatus({ run: false, gate: 'gate1-interface', reason: 'Looks like an app or dashboard, not an article', count: 0 });
  assert.match(off.line, /Didn't run/);
  assert.match(off.detail, /app or dashboard/);
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
