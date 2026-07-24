// welcome.js — on-device (Gemini Nano) onboarding for the welcome page.
// ES module so it can import the real Nano provider — the same
// availability()/download() the calibrator uses (single source of truth). The
// key-save sections (Anthropic + Gemini) are handled by the shared popup.js;
// the pure screenForState() mapper comes from lib/status.js (a classic script
// loaded before this module, so window.BallparkStatus is set).

import { availability, download } from './lib/providers/nano.js';

// 'failed' and 'gemini-offer' are local UI screens, not availability() states —
// the download's catch shows 'failed'; the decline / unavailable / keeps-failing
// links show 'gemini-offer'. Kept out of screenForState so its contract (and
// tests) stay exactly the four availability states.
const SCREENS = ['ready', 'consent', 'downloading', 'failed', 'unavailable', 'gemini-offer'];

function show(screenId) {
  for (const id of SCREENS) {
    const el = document.getElementById('screen-' + id);
    if (el) el.hidden = id !== screenId;
  }
}

// Progress: fraction in [0,1], or null for an indeterminate "setting up…" bar.
function setProgress(fraction) {
  const fill = document.getElementById('progress-fill');
  const pct = document.getElementById('progress-pct');
  if (!fill) return;
  if (fraction == null) {
    fill.style.width = '35%';
    if (pct) pct.textContent = 'Setting up…';
  } else {
    const p = Math.round(fraction * 100);
    fill.style.width = p + '%';
    if (pct) pct.textContent = p + '%';
  }
}

// Carry the progress reached into the amber card's bar, so "your progress is
// saved" is visibly true rather than just a claim. A download that never
// started gets "couldn't start" copy + the browser's reason (failedCopy) —
// an empty bar and Chrome's own words instead of a false "progress saved".
function showFailed(err, started) {
  const copy = window.BallparkStatus.failedCopy({ message: err && err.message, started });
  const fill = document.getElementById('progress-fill');
  const failedFill = document.getElementById('failed-fill');
  if (failedFill) failedFill.style.width = started ? (fill?.style.width || '35%') : '0%';
  const title = document.getElementById('failed-title');
  if (title) title.textContent = copy.title;
  const reason = document.getElementById('failed-reason');
  if (reason) {
    reason.textContent = copy.reason;
    reason.hidden = !copy.reason;
  }
  const sub = document.getElementById('failed-sub');
  if (sub) sub.textContent = copy.sub;
  show('failed');
}

// Start (or attach to) the one-time model download, then re-read the REAL state
// — never assume success — and show the matching screen.
async function runDownload() {
  show('downloading');
  setProgress(null);
  let started = false;
  try {
    await download((fraction) => {
      if (fraction > 0) started = true;
      setProgress(fraction);
    });
    show(window.BallparkStatus.screenForState(await availability()));
  } catch (err) {
    console.warn('[Ballpark] Nano download failed:', err);
    showFailed(err, started);
  }
}

async function render() {
  const screen = window.BallparkStatus.screenForState(await availability());
  // 'downloading' on load = a download already running (another tab / prior
  // visit): attach and watch it to completion. Otherwise just show the screen.
  if (screen === 'downloading') runDownload();
  else show(screen);
}

document.getElementById('turn-on-btn')?.addEventListener('click', runDownload);
document.getElementById('retry-btn')?.addEventListener('click', runDownload);

// The consent decline line, the failed card's fallback, and the unavailable
// screen all route to the shared Gemini offer.
for (const link of document.querySelectorAll('[data-goto="gemini-offer"]')) {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    show('gemini-offer');
  });
}

render();
