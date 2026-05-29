// detector.js — number detection and DOM underline injection
// Runs as a classic content script; no imports, exposes globals on window.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Patterns
  // ---------------------------------------------------------------------------

  const CURRENCY_SYMBOLS = '[$€£¥₹]';
  const SUFFIXES = '(?:thousand|million|billion|trillion|[KMBTkmbt])';
  const WRITTEN_NUMBERS =
    '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|' +
    'eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|' +
    'thirty|forty|fifty|sixty|seventy|eighty|ninety|' +
    'hundred|thousand|million|billion|trillion)';

  // Core numeric: digits with optional commas/decimals
  const NUM = '\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?|\\.\\d+|\\d+(?:\\.\\d+)?';

  // Build a combined pattern that catches:
  //   $40B  $1.2T  $5 billion  €500M
  //   4.5%  40bps  four point five percent
  //   40,000  2.3M users  forty billion
  const PATTERNS = [
    // Currency + number + optional suffix/word
    `${CURRENCY_SYMBOLS}\\s*(?:${NUM})\\s*(?:${SUFFIXES}|thousand|million|billion|trillion)?`,
    // Number + currency word
    `(?:${NUM})\\s+(?:${SUFFIXES}\\s+)?(?:dollars?|euros?|pounds?|yen)`,
    // Number + suffix (2.3M, 40B, etc.) — standalone
    `(?:${NUM})\\s*${SUFFIXES}(?=\\b)`,
    // Percentage
    `(?:${NUM})\\s*(?:%|percent|bps|basis points)`,
    // Large plain number (at least 4 digits or has commas)
    `\\b\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?\\b`,
    // Written large number (e.g. "forty billion", "2.3 billion")
    `(?:${NUM}|${WRITTEN_NUMBERS})(?:\\s+(?:${WRITTEN_NUMBERS}))*\\s+(?:million|billion|trillion)`,
  ];

  const COMBINED = new RegExp(PATTERNS.join('|'), 'gi');

  // ---------------------------------------------------------------------------
  // Exclusion heuristics
  // ---------------------------------------------------------------------------

  // Years — standalone 4-digit number in range 1000-2099
  const RE_YEAR = /^\d{4}$/;

  // Version numbers: v2.5, iOS 17.2, 2.5.1
  const RE_VERSION = /^v?\d+\.\d+/i;

  // Looks like a pure year value
  function isYear(text) {
    const n = parseInt(text.replace(/,/g, ''), 10);
    return RE_YEAR.test(text.trim()) && n >= 1000 && n <= 2099;
  }

  // Surrounding context patterns that signal noise
  const NOISE_PREFIXES = [
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s*$/i,
    /\b(?:jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?\s*$/i,
    /\b(?:q[1-4]|fy|fiscal year)\s*$/i,  // Q3 2024
    /(?:version|ver|v|ios|android|release|build)\s*$/i,
    /\bpage\s*$/i,
    /\bfootnote\s*$/i,
    /(?:\(|\[)\s*$/,  // footnote marker like [1] or (2)
    /\b(?:section|chapter|figure|table|item|step)\s*$/i,
    /\b(?:ext|extension|x)\s*$/i, // phone extensions
    /[-–—]\s*$/,  // date range separator before year
  ];

  const NOISE_SUFFIXES = [
    /^\s*(?:st|nd|rd|th)\b/i,  // ordinal suffix
    /^\s*[/-]\d/,               // date separator
    /^\s*:\d{2}/,               // time separator HH:MM
    /^\s*[ap]m\b/i,             // time am/pm
    /^\s*(?:bc|ad|ce|bce)\b/i,
  ];

  function isExcluded(matchText, precedingText, followingText) {
    const trimmed = matchText.trim();

    // Version numbers
    if (RE_VERSION.test(trimmed)) return true;

    // Years when standalone digit string
    if (/^\d{4}$/.test(trimmed) && isYear(trimmed)) return true;

    // Phone number heuristic: 10+ consecutive digits with optional dashes/parens
    if (/^[\d\s\-().+]{7,}$/.test(trimmed) && /\d{7,}/.test(trimmed.replace(/\D/g, ''))) return true;

    // Check preceding context
    for (const re of NOISE_PREFIXES) {
      if (re.test(precedingText)) return true;
    }

    // Check following context
    for (const re of NOISE_SUFFIXES) {
      if (re.test(followingText)) return true;
    }

    return false;
  }

  // ---------------------------------------------------------------------------
  // Skip certain DOM elements
  // ---------------------------------------------------------------------------

  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
    'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON',
    'A',  // skip links — URLs contain numbers
    'TIME', 'HEADER', 'FOOTER', 'NAV',
  ]);

  const SKIP_CLASSES = ['bp-number']; // don't re-process our own spans

  function shouldSkipElement(el) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    for (const cls of SKIP_CLASSES) {
      if (el.classList && el.classList.contains(cls)) return true;
    }
    // Skip if inside a link
    if (el.closest && el.closest('a, code, pre')) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Get surrounding text from adjacent text nodes / parent text content
  // ---------------------------------------------------------------------------

  function getSurroundingText(textNode, matchStart, matchEnd) {
    const fullText = textNode.textContent;
    const WINDOW = 200;

    const before = fullText.slice(Math.max(0, matchStart - WINDOW), matchStart);
    const after = fullText.slice(matchEnd, Math.min(fullText.length, matchEnd + WINDOW));

    return {
      before: before.trim(),
      after: after.trim(),
      full: before + fullText.slice(matchStart, matchEnd) + after,
    };
  }

  // ---------------------------------------------------------------------------
  // Process a single text node — split and inject <span class="bp-number">
  // ---------------------------------------------------------------------------

  function processTextNode(textNode) {
    const text = textNode.textContent;
    if (!text || text.length < 2) return;

    COMBINED.lastIndex = 0;
    const matches = [];
    let m;

    while ((m = COMBINED.exec(text)) !== null) {
      const matchText = m[0];
      const start = m.index;
      const end = start + matchText.length;

      const preceding = text.slice(Math.max(0, start - 60), start);
      const following = text.slice(end, Math.min(text.length, end + 60));

      if (isExcluded(matchText, preceding, following)) continue;

      const surrounding = getSurroundingText(textNode, start, end);

      matches.push({ matchText, start, end, surrounding });
    }

    if (matches.length === 0) return;

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    for (const match of matches) {
      // Text before match
      if (match.start > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, match.start)));
      }

      // The underlined span
      const span = document.createElement('span');
      span.className = 'bp-number';
      span.textContent = match.matchText;
      span.dataset.context = match.surrounding.full.slice(0, 400);
      fragment.appendChild(span);

      cursor = match.end;
    }

    // Trailing text
    if (cursor < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    textNode.parentNode.replaceChild(fragment, textNode);
  }

  // ---------------------------------------------------------------------------
  // Walk the DOM and underline all qualifying numbers
  // ---------------------------------------------------------------------------

  function underlineAll(root) {
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          // Skip if parent is a disallowed element
          let el = node.parentElement;
          while (el && el !== root) {
            if (shouldSkipElement(el)) return NodeFilter.FILTER_REJECT;
            el = el.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    // Collect all text nodes first (modifying DOM while walking is unsafe)
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    for (const tn of textNodes) {
      try {
        processTextNode(tn);
      } catch (e) {
        // Skip silently — don't break the page
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Exports (globals for use by content.js)
  // ---------------------------------------------------------------------------

  window.BallparkDetector = { underlineAll };
})();
