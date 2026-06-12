// Tier 3, Part 1 — decision-accuracy gating tests for the page-level gates.
//
// lib/gates.js is a classic content script (an IIFE that attaches
// window.BallparkGates). We can't import it, so we load it into jsdom via
// window.eval and call its one export — evaluatePage — exactly as the extension
// will. This file also drives the labeled page corpus (added in Task 2).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const LIB = path.join(__dirname, '..', 'lib');
const GATES_SRC = fs.readFileSync(path.join(LIB, 'gates.js'), 'utf8');

// Evaluate gates.js into a fresh window over the given HTML and return its
// BallparkGates global.
function loadGates(html = '<!DOCTYPE html><body></body>') {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  dom.window.eval(GATES_SRC);
  return dom.window;
}

test('evaluatePage returns the { run, gate, reason } contract shape', () => {
  const window = loadGates();
  const result = window.BallparkGates.evaluatePage(window.document);
  assert.equal(typeof result.run, 'boolean', 'run must be boolean');
  assert.equal(typeof result.gate, 'string', 'gate must be a string id');
  assert.equal(typeof result.reason, 'string', 'reason must be a string');
});
