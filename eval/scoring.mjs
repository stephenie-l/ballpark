// Shared calibration scoring — the single ruler for BOTH eval harnesses.
//
// Extracted verbatim from calibration-eval.mjs so the Node (Claude) harness and
// the browser (Gemini Nano) harness score results identically. Pure JS, no Node
// or browser APIs, so it imports cleanly in both a .mjs Node process and a
// <script type="module"> page.
//
// The contract: evaluateResult(case, result) → array of { name, ok, detail }
// checks. `result` is the parsed calibration ({ verdict, reference_class,
// comparisons, searched } or { insufficient, message }); `case` is a fixture
// from test/fixtures/calibration-cases.json.

// Scale words that signal each direction, used as a fallback when none of the
// fixture's hand-written verdict_keywords appear verbatim.
export const DIRECTION_WORDS = {
  large: ['large', 'high', 'big', 'top', 'above', 'more than', 'exceed', 'outsized', 'record', 'steep', 'elevated', 'premium', 'massive', 'huge'],
  small: ['small', 'low', 'below', 'modest', 'tiny', 'little', 'fraction', 'underwhelm', 'weak', 'mediocre', 'cheap', 'minimal'],
  average: ['typical', 'average', 'normal', 'in line', 'comparable', 'middling', 'par', 'unremarkable', 'standard', 'median', 'common', 'ordinary'],
};

const lc = (s) => (s || '').toLowerCase();
const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

export function evaluateResult(c, result) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  // The model bowed out via the insufficient_context path.
  if (result && result.insufficient) {
    add('usable-result', c.expected_direction === 'uncertain',
      `insufficient_context → "${result.message}"` +
      (c.expected_direction === 'uncertain' ? '' : ` (expected a ${c.expected_direction} calibration)`));
    return checks;
  }

  // --- Structural ---
  add('verdict-present', typeof result.verdict === 'string' && result.verdict.trim().length > 0);
  const vw = result.verdict ? wordCount(result.verdict) : 0;
  add('verdict-under-15-words', vw > 0 && vw < 15, `${vw} words`);
  add('reference_class-present', typeof result.reference_class === 'string' && result.reference_class.trim().length > 0);
  const nComp = Array.isArray(result.comparisons) ? result.comparisons.length : 0;
  add('comparisons-1-or-2', nComp >= 1 && nComp <= 2, `${nComp} comparisons`);
  add('searched-is-boolean', typeof result.searched === 'boolean', `searched=${result.searched}`);

  // --- Directional ---
  const verdict = lc(result.verdict);
  const expected = c.expected_direction;
  if (expected === 'uncertain') {
    // An honest hedge is the win; a confident large/small is the failure.
    const hedged = (c.verdict_keywords || []).some((k) => verdict.includes(lc(k)));
    add('direction-hedges', hedged, `expected uncertain | verdict: "${result.verdict}"`);
  } else {
    const kwHit = (c.verdict_keywords || []).some((k) => verdict.includes(lc(k)));
    const wordHit = (DIRECTION_WORDS[expected] || []).some((w) => verdict.includes(w));
    add('direction-matches', kwHit || wordHit, `expected ${expected} | verdict: "${result.verdict}"`);
  }

  // --- Reference class on-topic ---
  const haystack = lc(result.reference_class) + ' ' + (result.comparisons || []).map((x) => lc(x.text)).join(' ');
  const rcHit = (c.reference_class_keywords || []).some((k) => haystack.includes(lc(k)));
  add('reference-class-on-topic', rcHit, `reference_class: "${result.reference_class}"`);

  return checks;
}
