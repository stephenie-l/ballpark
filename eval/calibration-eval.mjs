// Tier 2 calibration eval — NOT a unit test.
//
// Feeds the real fixtures (test/fixtures/calibration-cases.json) to the real
// calibrate() from lib/api.js, using the real prompt (prompts/calibration.md)
// and the real model. This costs API tokens and is non-deterministic, so it
// lives outside test/ (npm test never runs it) and is invoked manually:
//
//   ANTHROPIC_API_KEY=sk-ant-... npm run eval
//
// It checks LOOSE acceptance criteria, not exact strings:
//   structural  — usable shape: verdict < 15 words, reference_class present,
//                 1–2 comparisons, searched is boolean
//   directional — verdict matches the case's expected_direction (via the
//                 fixture's verdict_keywords + scale-word lists)
//   ref-class   — reference_class mentions an expected-domain keyword
//
// It prints a per-case report and a summary; it does not throw on a miss (an
// eval surfaces the distribution of quality, it doesn't gate a build).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { calibrate } from '../lib/api.js';
import { evaluateResult } from './scoring.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const CONCURRENCY = 4;

// Scoring (evaluateResult + DIRECTION_WORDS) now lives in ./scoring.mjs so the
// Nano browser harness scores against the exact same ruler. See eval/nano/.

async function runCase(c) {
  const payload = {
    number: c.number,
    context: c.context,
    pageTitle: c.label || '',
    pageUrl: c.url || '',
  };
  try {
    const result = await calibrate(process.env.ANTHROPIC_API_KEY, systemPrompt, payload);
    return { c, result, checks: evaluateResult(c, result) };
  } catch (err) {
    return { c, error: err.message };
  }
}

async function runPool(items, worker, concurrency) {
  const out = new Array(items.length);
  let cursor = 0;
  async function next() {
    const i = cursor++;
    if (i >= items.length) return;
    out[i] = await worker(items[i], i);
    process.stdout.write('.'); // progress dot per completed case
    await next();
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
  return out;
}

// --- main ---
const systemPrompt = await readFile(path.join(root, 'prompts/calibration.md'), 'utf8');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Set ANTHROPIC_API_KEY in the environment, e.g.\n  ANTHROPIC_API_KEY=sk-ant-... npm run eval');
  process.exit(1);
}

const all = JSON.parse(await readFile(path.join(root, 'test/fixtures/calibration-cases.json'), 'utf8'));
const cases = all.filter((c) => c.id);

console.log(`Running calibration eval: ${cases.length} cases, concurrency ${CONCURRENCY}\n`);
const results = await runPool(cases, runCase, CONCURRENCY);
console.log('\n');

// --- report ---
let errored = 0;
const tally = {}; // checkName -> {pass, total}
const fullPasses = [];
const misses = [];

for (const r of results) {
  if (r.error) {
    errored++;
    console.log(`⚠️  ${r.c.id} [${r.c.expected_direction}] ${r.c.label}\n     API error: ${r.error}`);
    continue;
  }
  const failed = r.checks.filter((ch) => !ch.ok);
  for (const ch of r.checks) {
    tally[ch.name] = tally[ch.name] || { pass: 0, total: 0 };
    tally[ch.name].total++;
    if (ch.ok) tally[ch.name].pass++;
  }
  const mark = failed.length === 0 ? '✓' : '✗';
  console.log(`${mark}  ${r.c.id} [${r.c.expected_direction}] ${r.c.label}`);
  if (failed.length === 0) {
    fullPasses.push(r.c.id);
  } else {
    misses.push(r.c.id);
    for (const ch of failed) console.log(`     ✗ ${ch.name}${ch.detail ? ' — ' + ch.detail : ''}`);
  }
}

console.log('\n──────── summary ────────');
console.log(`cases:        ${cases.length}`);
console.log(`clean passes: ${fullPasses.length}`);
console.log(`with misses:  ${misses.length}${misses.length ? ' (' + misses.join(', ') + ')' : ''}`);
console.log(`api errors:   ${errored}`);
console.log('\nper-criterion pass rate:');
for (const [name, t] of Object.entries(tally)) {
  console.log(`  ${t.pass}/${t.total}  ${name}`);
}
