// Gemini Nano calibration harness (browser-only — the Prompt API's
// LanguageModel is a browser global with no Node binding).
//
// Runs the real 22 fixtures through on-device Nano using the adapted, no-search
// prompt, scores each with the SAME eval/scoring.mjs the Claude harness uses,
// and renders a head-to-head-ready report. Report-only, never a gate.
//
// Serve from the repo root and open http://localhost:PORT/eval/nano/harness.html
// in a Chrome where LanguageModel.availability() === 'available'.

import { evaluateResult } from '../scoring.mjs';

const FIXTURES_URL = '../../test/fixtures/calibration-cases.json';
const PROMPT_URL = './prompt-nano.md';

// Forces card-shaped JSON out of Nano. The insufficient_context path is NOT
// modeled here (a fixed schema can't express the union) — so the lone
// 'uncertain' fixture (fail-003) is judged on whether its verdict hedges, which
// is the outcome that actually matters for the card.
const SCHEMA = {
  type: 'object',
  required: ['verdict', 'reference_class', 'comparisons'],
  additionalProperties: false,
  properties: {
    verdict: { type: 'string' },
    reference_class: { type: 'string' },
    comparisons: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: {
        type: 'object',
        required: ['text'],
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          source_url: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids) n.append(k);
  return n;
};

function setStatus(msg, cls = '') {
  const s = $('status');
  s.textContent = msg;
  s.className = cls;
}

function formatUserMessage({ number, context, label, url }) {
  return [
    `Number: ${number}`,
    `Context: "${context}"`,
    `Page: ${label || '(no title)'}`,
    `URL: ${url || '(unknown)'}`,
  ].join('\n');
}

// Same tolerant cleanup lib/api.js uses — schema-constrained output should be
// clean already, but strip fences defensively in case a build ignores it.
function parseOutput(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

async function createSession(system) {
  // Prefer the language-tagged create (silences the output-language warning the
  // probe surfaced); fall back if this build rejects the option.
  try {
    return await LanguageModel.create({
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      initialPrompts: [{ role: 'system', content: system }],
    });
  } catch {
    return await LanguageModel.create({ initialPrompts: [{ role: 'system', content: system }] });
  }
}

async function runOne(system, c) {
  // Fresh session per case so one calibration can't pollute the next — each
  // click in production is independent, and the eval must be too.
  const session = await createSession(system);
  try {
    const userMsg = formatUserMessage(c);
    let raw;
    try {
      raw = await session.prompt(userMsg, { responseConstraint: SCHEMA });
    } catch {
      raw = await session.prompt(userMsg);
    }
    const parsed = parseOutput(raw);
    // Nano never searches — set the flag deterministically so the shared
    // scorer's 'searched-is-boolean' check is meaningful.
    parsed.searched = false;
    return { raw, result: parsed };
  } finally {
    session.destroy?.();
  }
}

async function main() {
  const runBtn = $('run');
  runBtn.disabled = true;

  if (!('LanguageModel' in self)) {
    setStatus('LanguageModel API not present in this browser. Open in Chrome 138+ with the Prompt API available.', 'bad');
    return;
  }
  const availability = await LanguageModel.availability();
  if (availability !== 'available') {
    setStatus(`LanguageModel.availability() === "${availability}" — Nano isn't ready to run here (needs "available"). ` +
      'Requires ~22GB free disk + a qualifying GPU/RAM, and the one-time model download.', 'bad');
    return;
  }

  setStatus('Loading prompt + fixtures…');
  const [system, allFixtures] = await Promise.all([
    fetch(PROMPT_URL).then((r) => r.text()),
    fetch(FIXTURES_URL).then((r) => r.json()),
  ]);
  const cases = allFixtures.filter((c) => c.id);

  const tbody = $('rows');
  tbody.replaceChildren();
  const tally = {};
  const collected = [];
  let cleanPasses = 0;
  let errored = 0;
  const t0 = performance.now();

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    setStatus(`Running ${i + 1}/${cases.length}: ${c.id}…`);
    let checks, result, error;
    try {
      const out = await runOne(system, c);
      result = out.result;
      checks = evaluateResult(c, result);
    } catch (e) {
      error = e.message;
    }

    const row = el('tr');
    row.append(el('td', { textContent: c.id }));
    row.append(el('td', { textContent: c.expected_direction }));

    if (error) {
      errored++;
      row.classList.add('err');
      row.append(el('td', { colSpan: 3, textContent: 'ERROR: ' + error }));
      collected.push({ id: c.id, expected: c.expected_direction, error });
    } else {
      const failed = checks.filter((ch) => !ch.ok);
      if (failed.length === 0) cleanPasses++;
      for (const ch of checks) {
        tally[ch.name] = tally[ch.name] || { pass: 0, total: 0 };
        tally[ch.name].total++;
        if (ch.ok) tally[ch.name].pass++;
      }
      row.classList.add(failed.length === 0 ? 'pass' : 'fail');
      row.append(el('td', { textContent: failed.length === 0 ? '✓ clean' : `✗ ${failed.map((f) => f.name).join(', ')}` }));
      row.append(el('td', { className: 'verdict', textContent: result.verdict || '' }));
      row.append(el('td', { className: 'refclass', textContent: result.reference_class || '' }));
      collected.push({ id: c.id, expected: c.expected_direction, result, checks });
    }
    tbody.append(row);
  }

  const secs = ((performance.now() - t0) / 1000).toFixed(0);

  // --- summary ---
  const directional = tally['direction-matches'] || { pass: 0, total: 0 };
  const hedges = tally['direction-hedges'] || { pass: 0, total: 0 };
  const dirPass = directional.pass + hedges.pass;
  const dirTotal = directional.total + hedges.total;
  const structuralNames = ['verdict-present', 'verdict-under-15-words', 'reference_class-present', 'comparisons-1-or-2', 'searched-is-boolean'];
  let structPass = 0, structTotal = 0;
  for (const n of structuralNames) { if (tally[n]) { structPass += tally[n].pass; structTotal += tally[n].total; } }

  const pct = (p, t) => (t ? Math.round((100 * p) / t) : 0);
  const summary = $('summary');
  summary.replaceChildren();
  summary.append(el('div', { textContent: `cases: ${cases.length}   clean passes: ${cleanPasses}   errored: ${errored}   time: ${secs}s` }));
  summary.append(el('div', { className: 'big', textContent: `STRUCTURAL: ${pct(structPass, structTotal)}%  (bar ≥85%)   DIRECTIONAL: ${pct(dirPass, dirTotal)}%  (bar ≥70%)` }));
  const perCrit = el('div', { className: 'crit' });
  for (const [name, t] of Object.entries(tally)) {
    perCrit.append(el('div', { textContent: `${t.pass}/${t.total}  ${pct(t.pass, t.total)}%  ${name}` }));
  }
  summary.append(perCrit);

  const payload = { generatedFrom: 'gemini-nano', cases: cases.length, cleanPasses, errored,
    structuralPct: pct(structPass, structTotal), directionalPct: pct(dirPass, dirTotal), tally, results: collected };
  $('copy').onclick = () => navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  $('copy').disabled = false;

  setStatus(`Done — ${cleanPasses}/${cases.length} clean, ${errored} errored, ${secs}s. Click "Copy results JSON" and paste to Claude.`, 'good');
  window.__nanoResults = payload; // also reachable via console
}

$('run').onclick = main;
