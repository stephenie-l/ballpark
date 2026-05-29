// content.js — main content script
// BallparkDetector and BallparkCard are loaded before this by the manifest.

(function () {
  'use strict';

  // Run detection after the DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    BallparkDetector.underlineAll(document.body);
    document.addEventListener('click', handleClick);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') BallparkCard.hide();
    });
  }

  function handleClick(e) {
    const span = e.target.closest('.bp-number');
    if (!span) return;

    e.preventDefault();
    e.stopPropagation();

    const numberText = span.textContent;
    const context = span.dataset.context || '';

    BallparkCard.show(numberText, span);

    chrome.runtime.sendMessage(
      {
        type: 'CALIBRATE',
        payload: {
          number: numberText,
          context,
          pageTitle: document.title,
          pageUrl: location.href,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          BallparkCard.error('Extension error: ' + chrome.runtime.lastError.message);
          return;
        }
        if (!response) {
          BallparkCard.error('No response from background worker.');
          return;
        }
        if (!response.success) {
          BallparkCard.error(response.error || 'Unknown error.');
          return;
        }
        BallparkCard.fill(response.data);
      }
    );
  }
})();
