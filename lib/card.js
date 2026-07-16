// card.js — calibration card rendering and positioning
// Classic content script; no imports.

(function () {
  'use strict';

  const CARD_ID = 'bp-card';
  let currentAnchor = null;
  let outsideClickHandler = null;

  // ---------------------------------------------------------------------------
  // Build the card DOM (empty shell, filled by showCard)
  // ---------------------------------------------------------------------------

  function buildCard() {
    const card = document.createElement('div');
    card.id = CARD_ID;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Ballpark calibration');
    card.innerHTML = `
      <button class="bp-close" aria-label="Close">✕</button>
      <div class="bp-number-echo"></div>
      <div class="bp-body">
        <div class="bp-loading">
          <span class="bp-spinner"></span>
          <span>Calibrating…</span>
        </div>
        <div class="bp-result" hidden>
          <div class="bp-verdict"></div>
          <div class="bp-ref-class"></div>
          <ul class="bp-comparisons"></ul>
          <div class="bp-confidence"></div>
        </div>
        <div class="bp-note" hidden></div>
        <a class="bp-note-action" role="button" tabindex="0" hidden></a>
        <div class="bp-error" hidden></div>
      </div>
    `;
    return card;
  }

  // ---------------------------------------------------------------------------
  // Positioning — keep card on screen
  // ---------------------------------------------------------------------------

  function positionCard(card, anchor) {
    const MARGIN = 8;
    const rect = anchor.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Temporarily show off-screen to measure
    card.style.visibility = 'hidden';
    card.style.display = 'block';
    const cardW = card.offsetWidth;
    const cardH = card.offsetHeight;
    card.style.display = '';
    card.style.visibility = '';

    // Default: below and left-aligned to anchor
    let top = rect.bottom + scrollY + MARGIN;
    let left = rect.left + scrollX;

    // Flip above if not enough room below
    if (rect.bottom + cardH + MARGIN > vh) {
      top = rect.top + scrollY - cardH - MARGIN;
    }

    // Clamp horizontally
    const maxLeft = scrollX + vw - cardW - MARGIN;
    const minLeft = scrollX + MARGIN;
    left = Math.min(Math.max(left, minLeft), maxLeft);

    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }

  // ---------------------------------------------------------------------------
  // Populate card with calibration data
  // ---------------------------------------------------------------------------

  function populateCard(card, data) {
    card.querySelector('.bp-loading').hidden = true;
    card.querySelector('.bp-note').hidden = true;
    card.querySelector('.bp-error').hidden = true;

    const result = card.querySelector('.bp-result');
    result.hidden = false;

    card.querySelector('.bp-verdict').textContent = data.verdict;
    card.querySelector('.bp-ref-class').textContent = `vs. ${data.reference_class}`;

    const ul = card.querySelector('.bp-comparisons');
    ul.innerHTML = '';
    for (const comp of (data.comparisons || []).slice(0, 2)) {
      const li = document.createElement('li');
      if (comp.source_url) {
        const a = document.createElement('a');
        a.href = comp.source_url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = comp.text;
        li.appendChild(a);
      } else {
        li.textContent = comp.text;
      }
      ul.appendChild(li);
    }

    card.querySelector('.bp-note-action').hidden = true;

    const confEl = card.querySelector('.bp-confidence');
    if (data.provider === 'nano') {
      confEl.textContent = '⚡ On-device';
      confEl.className = 'bp-confidence bp-confidence--ondevice';
    } else {
      const prefix = data.model ? `${data.model} · ` : '';
      if (data.searched) {
        confEl.textContent = `${prefix}✓ Searched`;
        confEl.className = 'bp-confidence bp-confidence--searched';
      } else {
        confEl.textContent = `${prefix}~ From memory`;
        confEl.className = 'bp-confidence bp-confidence--memory';
      }
    }
  }

  function showError(card, message) {
    card.querySelector('.bp-loading').hidden = true;
    card.querySelector('.bp-result').hidden = true;
    card.querySelector('.bp-note').hidden = true;
    card.querySelector('.bp-note-action').hidden = true;
    const errEl = card.querySelector('.bp-error');
    errEl.textContent = message;
    errEl.hidden = false;
  }

  // Neutral "couldn't calibrate" message — not an error, just no useful answer.
  // Optional action = { label, onClick } renders a link (e.g. open the setup guide).
  function showNote(card, message, action) {
    card.querySelector('.bp-loading').hidden = true;
    card.querySelector('.bp-result').hidden = true;
    card.querySelector('.bp-error').hidden = true;
    const noteEl = card.querySelector('.bp-note');
    noteEl.textContent = message;
    noteEl.hidden = false;

    const actionEl = card.querySelector('.bp-note-action');
    if (action && action.label && typeof action.onClick === 'function') {
      actionEl.textContent = `${action.label} →`;
      const fire = (e) => { e.preventDefault(); action.onClick(); };
      actionEl.onclick = fire;
      actionEl.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') fire(e); };
      actionEl.hidden = false;
    } else {
      actionEl.onclick = null;
      actionEl.onkeydown = null;
      actionEl.hidden = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  function getOrCreateCard() {
    let card = document.getElementById(CARD_ID);
    if (!card) {
      card = buildCard();
      document.body.appendChild(card);

      card.querySelector('.bp-close').addEventListener('click', () => hide());
    }
    return card;
  }

  function show(numberText, anchor) {
    if (currentAnchor) {
      currentAnchor.classList.remove('bp-number--active');
    }
    currentAnchor = anchor;
    anchor.classList.add('bp-number--active');

    const card = getOrCreateCard();

    // Reset to loading state
    card.querySelector('.bp-loading').hidden = false;
    card.querySelector('.bp-result').hidden = true;
    card.querySelector('.bp-note').hidden = true;
    card.querySelector('.bp-note-action').hidden = true;
    card.querySelector('.bp-error').hidden = true;
    card.querySelector('.bp-number-echo').textContent = numberText;

    positionCard(card, anchor);
    card.classList.add('bp-card--visible');

    // Outside click dismissal
    if (outsideClickHandler) {
      document.removeEventListener('mousedown', outsideClickHandler, true);
    }
    outsideClickHandler = (e) => {
      if (!card.contains(e.target) && e.target !== anchor) {
        hide();
      }
    };
    // Small delay so the click that opened the card doesn't immediately close it
    setTimeout(() => {
      document.addEventListener('mousedown', outsideClickHandler, true);
    }, 0);
  }

  function fill(data) {
    const card = document.getElementById(CARD_ID);
    if (!card) return;
    populateCard(card, data);
  }

  function error(message) {
    const card = document.getElementById(CARD_ID);
    if (!card) return;
    showError(card, message);
  }

  function note(message, action) {
    const card = document.getElementById(CARD_ID);
    if (!card) return;
    showNote(card, message, action);
  }

  function hide() {
    const card = document.getElementById(CARD_ID);
    if (card) card.classList.remove('bp-card--visible');

    if (currentAnchor) {
      currentAnchor.classList.remove('bp-number--active');
      currentAnchor = null;
    }

    if (outsideClickHandler) {
      document.removeEventListener('mousedown', outsideClickHandler, true);
      outsideClickHandler = null;
    }
  }

  window.BallparkCard = { show, fill, note, error, hide };
})();
