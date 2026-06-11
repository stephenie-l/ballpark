// Black-box tests for lib/detector.js.
//
// detector.js is a classic content script (an IIFE that attaches
// window.BallparkDetector). We can't import its internals, so we test the only
// thing it exposes — underlineAll() — by running it against a real DOM (jsdom)
// and asserting which numbers came out underlined. That mirrors exactly what
// the extension does on a page.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const DETECTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'detector.js'),
  'utf8'
);

// Run the detector against an HTML body fragment and return the text of every
// underlined number, in document order. A fresh DOM per call keeps tests
// isolated (the detector's regex is module-level and stateful).
function underline(bodyHtml) {
  const dom = new JSDOM(`<!DOCTYPE html><body>${bodyHtml}</body>`, {
    runScripts: 'outside-only', // enables window.eval so we can load the IIFE
  });
  dom.window.eval(DETECTOR_SRC);
  dom.window.BallparkDetector.underlineAll(dom.window.document.body);
  return [...dom.window.document.querySelectorAll('.bp-number')].map(
    (span) => span.textContent
  );
}

// Convenience: is `text` underlined when it appears in a plain paragraph?
function underlinedInPara(text) {
  return underline(`<p>${text}</p>`);
}

test('underlines currency amounts with magnitude suffixes', () => {
  assert.deepEqual(underlinedInPara('raised a $28M Series B'), ['$28M']);
  assert.deepEqual(underlinedInPara('a $1.2T market'), ['$1.2T']);
  assert.deepEqual(underlinedInPara('worth $40B today'), ['$40B']);
  assert.deepEqual(underlinedInPara('a €500M fund'), ['€500M']);
});

test('underlines currency amounts written with magnitude words', () => {
  assert.deepEqual(underlinedInPara('valued at $5 billion'), ['$5 billion']);
});

test('underlines percentages and basis points', () => {
  assert.deepEqual(underlinedInPara('runs 34% gross margins'), ['34%']);
  assert.deepEqual(underlinedInPara('cut rates by 40bps'), ['40bps']);
});

test('underlines bare magnitude numbers (comma form)', () => {
  assert.deepEqual(underlinedInPara('about 40,000 employees'), ['40,000']);
});

test('underlines written-out large numbers', () => {
  assert.deepEqual(underlinedInPara('roughly forty billion stars'), [
    'forty billion',
  ]);
});

test('catches multiple numbers in one paragraph, in order', () => {
  assert.deepEqual(underlinedInPara('raised $28M at a $200M valuation'), [
    '$28M',
    '$200M',
  ]);
});

test('does NOT underline bare years in prose', () => {
  assert.deepEqual(underlinedInPara('Back in 2024 the firm grew'), []);
  assert.deepEqual(underlinedInPara('founded in 1999'), []);
});

test('does NOT underline version numbers', () => {
  assert.deepEqual(underlinedInPara('upgraded to v2.5 last week'), []);
  assert.deepEqual(underlinedInPara('running 2.5.1 in production'), []);
});

test('does NOT underline small bare integers', () => {
  assert.deepEqual(underlinedInPara('it took 7 tries'), []);
});

test('does NOT underline numbers inside links', () => {
  // Links are skipped wholesale — URLs and anchor text are full of numbers.
  assert.deepEqual(underline('<p>see <a href="#">$28M round</a></p>'), []);
});

test('does NOT underline numbers inside our own card (#bp-card)', () => {
  // The re-scan observer fires when the card mounts; without this skip it would
  // underline the figures in the card's own verdict/comparisons.
  assert.deepEqual(
    underline('<div id="bp-card"><div>worth $40B vs $28M</div></div><p>raised $5M</p>'),
    ['$5M']
  );
});

test('does NOT underline numbers inside code/pre', () => {
  assert.deepEqual(underline('<p>set <code>$28M</code> here</p>'), []);
  assert.deepEqual(underline('<pre>budget = $40B</pre>'), []);
});

test('attaches surrounding context to each underlined span', () => {
  // content.js reads span.dataset.context and sends it to the model, so an
  // empty context would silently degrade every calibration.
  const dom = new JSDOM(
    '<!DOCTYPE html><body><p>The startup raised a $28M Series B led by Acme.</p></body>',
    { runScripts: 'outside-only' }
  );
  dom.window.eval(DETECTOR_SRC);
  dom.window.BallparkDetector.underlineAll(dom.window.document.body);
  const span = dom.window.document.querySelector('.bp-number');
  assert.ok(span, 'expected a .bp-number span');
  assert.match(span.dataset.context, /Series B/);
});

test('re-running underlineAll is idempotent (no double-wrap)', () => {
  // content.js re-scans on every settled DOM mutation (MutationObserver) to
  // recover underlines that React hydration wipes on news sites. That only works
  // if a second pass over already-underlined DOM is a no-op: same spans, none
  // nested inside another .bp-number.
  const dom = new JSDOM(
    '<!DOCTYPE html><body><p>raised $28M at a $200M valuation</p></body>',
    { runScripts: 'outside-only' }
  );
  dom.window.eval(DETECTOR_SRC);
  const { document } = dom.window;

  dom.window.BallparkDetector.underlineAll(document.body);
  const afterFirst = [...document.querySelectorAll('.bp-number')].map((s) => s.textContent);

  dom.window.BallparkDetector.underlineAll(document.body);
  const afterSecond = [...document.querySelectorAll('.bp-number')].map((s) => s.textContent);

  assert.deepEqual(afterSecond, afterFirst, 'span set changed on re-scan');
  assert.deepEqual(afterSecond, ['$28M', '$200M']);
  assert.equal(
    document.querySelectorAll('.bp-number .bp-number').length,
    0,
    'found a .bp-number nested inside another — double-wrapped'
  );
});

// --- Documented current-behavior gaps -------------------------------------
// These assert what the detector does TODAY, not necessarily what we'd want.
// They exist so the behavior is visible and a future change is a conscious one.

test('underlines decimal numbers (percent, suffix, and magnitude-word forms)', () => {
  // Regression guard: RE_VERSION used to match the leading "N.N" of any decimal
  // and drop these as if they were version strings. Decimals are ubiquitous in
  // Ballpark's domain (margins, percentages, "2.3 billion people").
  assert.deepEqual(underlinedInPara('up 4.5% this quarter'), ['4.5%']);
  assert.deepEqual(underlinedInPara('2.3M users signed up'), ['2.3M']);
  assert.deepEqual(underlinedInPara('some 2.3 billion people'), ['2.3 billion']);
});

test('GAP: bare 3-digit counts are not underlined (no suffix/%/currency)', () => {
  // The README's "Phase II trial enrolled 180 patients" example would NOT
  // light up — a plain 180 matches no pattern (plain-number needs commas).
  assert.deepEqual(underlinedInPara('enrolled 180 patients'), []);
});
