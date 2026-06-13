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

// Evaluate gates.js into a fresh window over the given HTML and return the
// window with BallparkGates attached.
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

test('hardcoded host list: suffix match and miss', () => {
  const listed = (host) => {
    const dom = new JSDOM('<!DOCTYPE html><body><p>hi</p></body>', {
      runScripts: 'outside-only', url: `https://${host}/`,
    });
    dom.window.eval(GATES_SRC);
    return dom.window.BallparkGates.evaluatePage(dom.window.document);
  };
  assert.equal(listed('mail.google.com').gate, 'gate1-communication');
  assert.equal(listed('secure.chase.com').gate, 'gate1-sensitive'); // subdomain
  assert.equal(listed('example.com').run, true); // not listed → runs (for now)
});

test('applyOverride: force-on/off win, undefined passes through', () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  dom.window.eval(GATES_SRC);
  const { applyOverride } = dom.window.BallparkGates;

  const verdict = { run: false, gate: 'gate1-interface', reason: 'x' };

  const on = applyOverride(verdict, 'force-on');
  assert.equal(on.run, true);
  assert.equal(on.gate, 'override-on');

  const off = applyOverride({ run: true, gate: 'none', reason: '' }, 'force-off');
  assert.equal(off.run, false);
  assert.equal(off.gate, 'override-off');

  assert.deepEqual(applyOverride(verdict, undefined), verdict); // unchanged
});

// Evaluate a raw HTML string (optionally at a given url) through the gates.
function decideHtml(html, url) {
  const opts = { runScripts: 'outside-only' };
  if (url) opts.url = url;
  const dom = new JSDOM(html, opts);
  dom.window.eval(GATES_SRC);
  return dom.window.BallparkGates.evaluatePage(dom.window.document);
}

// Prose-rich body so Gate 1 would RUN — isolates Gate 2's effect.
const G2_PROSE = '<main><article><p>' + 'word '.repeat(60) + '</p></article></main>';

test('Gate 2 suppresses commerce archetypes (structured data + hostname net)', () => {
  const product = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@type":"Product","name":"Sofa"}</script></body>`
  );
  assert.equal(product.gate, 'gate2-commerce', 'Product JSON-LD');

  const og = decideHtml(
    `<!DOCTYPE html><head><meta property="og:type" content="product"></head><body>${G2_PROSE}</body>`
  );
  assert.equal(og.gate, 'gate2-commerce', 'og:type=product');

  const micro = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<div itemscope itemtype="https://schema.org/Product"></div></body>`
  );
  assert.equal(micro.gate, 'gate2-commerce', 'Product microdata');

  const graph = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"RealEstateListing"}]}</script></body>`
  );
  assert.equal(graph.gate, 'gate2-commerce', '@graph nested type');

  const re = decideHtml(`<!DOCTYPE html><body>${G2_PROSE}</body>`, 'https://www.zillow.com/homes/123');
  assert.equal(re.gate, 'gate2-commerce', 'real-estate SPA hostname net');
});

test('Gate 2 keeps articles and job postings running (precision guards)', () => {
  const article = decideHtml(
    `<!DOCTYPE html><head><meta property="og:type" content="article"></head><body>${G2_PROSE}<script type="application/ld+json">{"@type":"Product","name":"x"}</script></body>`
  );
  assert.equal(article.run, true, 'og:type=article overrides Product');
  assert.equal(article.gate, 'none');

  const news = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@type":"NewsArticle"}</script></body>`
  );
  assert.equal(news.run, true, 'NewsArticle runs');

  const job = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer"}</script></body>`
  );
  assert.equal(job.run, true, 'JobPosting runs (keep salaries)');

  // Deliberate tradeoff (suppress-bias): a Product page that ALSO ships an
  // Article node in its @graph runs — we'd rather under-suppress commerce
  // (override-recoverable) than risk hiding a real article's numbers.
  const productPlusArticle = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"x"},{"@type":"Article"}]}</script></body>`
  );
  assert.equal(productPlusArticle.run, true, 'Article node in @graph wins over Product');
});

test('Gate 2 covers non-Product commerce types (hotel)', () => {
  const hotel = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@type":"Hotel","name":"Grand"}</script></body>`
  );
  assert.equal(hotel.gate, 'gate2-commerce', 'Hotel JSON-LD suppresses');
});

const DETECTOR_SRC = fs.readFileSync(path.join(LIB, 'detector.js'), 'utf8');
const PAGES_DIR = path.join(__dirname, 'fixtures', 'pages');
const LABELS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'page-labels.json'), 'utf8')
);

// Load a corpus fixture into a window with gates + detector evaluated, exactly
// as the extension loads them.
function loadFixture(file, { url } = {}) {
  const html = fs.readFileSync(path.join(PAGES_DIR, file), 'utf8');
  const opts = { runScripts: 'outside-only' };
  if (url) opts.url = url;
  const dom = new JSDOM(html, opts);
  dom.window.eval(GATES_SRC);
  dom.window.eval(DETECTOR_SRC);
  return dom.window;
}

// Texts of every underlined number, in document order.
function underlinedNumbers(window) {
  window.BallparkDetector.underlineAll(window.document.body);
  return [...window.document.querySelectorAll('.bp-number')].map(
    (s) => s.textContent
  );
}

const hard = LABELS.filter((c) => c.tier === 'hard');

// --- Page-level decisions (Gates 1 & 2) ---
for (const c of hard) {
  // Pages whose gate isn't implemented yet run as `todo`: they execute (so a
  // premature pass is reported) but can't fail the suite.
  const opts = c.pending ? { todo: `awaiting ${c.pending}` } : {};
  test(`page decision: ${c.file}`, opts, () => {
    const window = loadFixture(c.file, { url: c.url });
    const result = window.BallparkGates.evaluatePage(window.document);
    assert.equal(
      result.run,
      c.page.expected === 'run',
      `expected run=${c.page.expected === 'run'}, got run=${result.run}`
    );
    assert.equal(
      result.gate,
      c.page.gate,
      `expected gate="${c.page.gate}", got gate="${result.gate}"`
    );
  });
}

// --- Number-level decisions (Gate 3) on run-pages ---
// A number may carry `pending` once Gate 3 suppression exists (Spec 3); until
// then run-pages list only `underline` numbers, which exercise the existing
// detector and pass now.
for (const c of hard.filter((x) => x.page.expected === 'run' && x.numbers)) {
  test(`number decisions: ${c.file}`, () => {
    const underlined = new Set(underlinedNumbers(loadFixture(c.file)));
    for (const num of c.numbers) {
      if (num.expected === 'underline') {
        assert.ok(
          underlined.has(num.text),
          `expected "${num.text}" underlined; got [${[...underlined].join(', ')}]`
        );
      } else {
        assert.ok(
          !underlined.has(num.text),
          `expected "${num.text}" suppressed but it was underlined`
        );
      }
    }
  });
}
