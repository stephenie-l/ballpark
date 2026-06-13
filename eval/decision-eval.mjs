// Tier 3, Part 2 — decision-accuracy report. NOT a unit test.
//
// Scores the gates' page-level run/suppress decisions over the SOFT (borderline)
// corpus, weighting false positives more heavily than false negatives. Like the
// Tier 2 calibration eval, it prints a report and NEVER throws — the number is
// the signal, not a pass/fail. The HARD corpus is gated separately in
// test/gates.test.js. No API key needed (decisions are deterministic + local).
//
//   npm run eval:decisions

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Running where we shouldn't (FP) erodes trust more than staying quiet (FN).
const FP_WEIGHT = 3;

const GATES_SRC = await readFile(path.join(root, 'lib/gates.js'), 'utf8');

function evaluatePage(html, url) {
  const opts = { runScripts: 'outside-only' };
  if (url) opts.url = url;
  const dom = new JSDOM(html, opts);
  dom.window.eval(GATES_SRC);
  return dom.window.BallparkGates.evaluatePage(dom.window.document);
}

const labels = JSON.parse(
  await readFile(path.join(root, 'test/fixtures/page-labels.json'), 'utf8')
);
const soft = labels.filter((c) => c.tier === 'soft');

let fp = 0;
let fn = 0;
let errored = 0;
const rows = [];

for (const c of soft) {
  try {
    const html = await readFile(
      path.join(root, 'test/fixtures/pages', c.file),
      'utf8'
    );
    const result = evaluatePage(html, c.url);
    const expectRun = c.page.expected === 'run';

    let outcome = 'ok';
    if (result.run && !expectRun) { fp++; outcome = 'FP'; }
    else if (!result.run && expectRun) { fn++; outcome = 'FN'; }

    rows.push({
      file: c.file,
      expected: c.page.expected,
      got: result.run ? 'run' : 'suppress',
      outcome,
    });
  } catch (err) {
    errored++;
    rows.push({ file: c.file, outcome: 'ERR', errMsg: err.message });
  }
}

const n = soft.length;
const weighted = fp * FP_WEIGHT + fn;
const pct = (x) => (n ? ((x / n) * 100).toFixed(1) : '0.0');

console.log(`Decision-accuracy report (soft corpus): ${n} cases\n`);
for (const r of rows) {
  if (r.outcome === 'ERR') {
    console.log(`⚠  ERR  ${r.file}  (${r.errMsg})`);
  } else {
    const mark = r.outcome === 'ok' ? '✓' : '✗';
    console.log(`${mark}  ${r.outcome.padEnd(3)}  ${r.file}  (expected ${r.expected}, got ${r.got})`);
  }
}
console.log('\n──────── summary ────────');
console.log(`cases:      ${n}`);
console.log(`false pos:  ${fp}  (weighted ×${FP_WEIGHT})`);
console.log(`false neg:  ${fn}`);
console.log(`FP-rate:    ${pct(fp)}%`);
console.log(`FN-rate:    ${pct(fn)}%`);
console.log(`weighted:   ${weighted}   (lower is better)`);
console.log(`errors:     ${errored}`);
console.log('\nNote: Spec 1 scores page-level only; number-level (Gate 3) scoring arrives with Spec 3.');
