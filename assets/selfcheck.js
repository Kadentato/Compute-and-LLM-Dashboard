/* Development self-check. Runs only on localhost; returns immediately anywhere else.

   Every page here is generated text, and a rendering path that only fires on one
   shape of data is the kind of bug that ships: the two gateways rounding to the
   same integer printed "73–73%", a sub-1% backwardation printed "-0%", a null
   print became NaN. None of them touched the console, so the console check that
   runs before every commit sailed past all three. This sweeps what the page
   actually rendered for those shapes and reports each one as a console error, so
   that same check catches them — on every page, every pass, without a new step.

   Loaded last on each page; waits for the page's own fetch-and-render to settle.
   Re-run by hand from the console with selfcheck(). */
(function () {
  'use strict';
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  // Range dashes on this site are en/em dashes; ISO dates use hyphen-minus, which
  // is why the first rule does not accept it — "2026-09-09" is not a range. The
  // lookbehind stops the capture starting mid-number: on its first run this rule
  // matched "25 – 25" inside the date range "1 Sep 2025 – 25 Aug 2026".
  var RULES = [
    [/(?<![\d.])(\$?\d+(?:\.\d+)?)\s?[–—]\s?\1(?![\d.])/g, 'zero-width range'],
    [/\bNaN\b/g, 'NaN rendered'],
    [/\bundefined\b/g, 'undefined rendered'],
    [/\bnull\b/g, 'null rendered'],
    [/\bInfinity\b/g, 'Infinity rendered'],
    [/-0(?:\.0+)?(?=\s?(?:%|pt\b|\/mo|x\b))/g, 'negative zero'],
    [/\$-0(?:\.0+)?(?!\d)/g, 'negative zero dollars'],
    [/\[object /g, 'object rendered as text'],
    [/%%/g, 'doubled percent'],
    [/\$\s?(?:NaN|-?Infinity)/g, 'money NaN']
  ];
  // Prose that legitimately contains one of the tokens above.
  var ALLOW = /null hypothesis|undefined behaviour/i;

  // Generated slots that should never still hold their placeholder once data is in.
  var SLOTS = '.takeaway, .lede, .stampline, .fhead, [id^="c-take"], [id^="t-"]';

  function sweep() {
    var text = document.body.innerText || '';
    var found = [];
    RULES.forEach(function (R) {
      var re = R[0], m;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        var ctx = text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ');
        if (!ALLOW.test(ctx)) found.push(R[1] + ': …' + ctx + '…');
      }
    });
    document.querySelectorAll(SLOTS).forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (!t || t === '—' || t === '–' || /^(Loading|Reading)\b/.test(t)) {
        found.push('empty or placeholder: ' + (el.id ? '#' + el.id : '.' + el.className) + ' "' + t + '"');
      }
    });
    if (found.length) {
      found.forEach(function (f) { console.error('[selfcheck] ' + f); });
    } else {
      console.info('[selfcheck] clean — ' + RULES.length + ' patterns over ' + text.length + ' chars, ' +
        document.querySelectorAll(SLOTS).length + ' generated slots filled');
    }
    return found;
  }

  window.selfcheck = sweep;
  window.addEventListener('load', function () { setTimeout(sweep, 2500); });
})();
