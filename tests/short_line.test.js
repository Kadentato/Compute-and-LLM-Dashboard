/* Every outcome the overview's accruing-series line can meet on 1 Oct 2026, run through the
   page's own code. The functions are cut from index.html between the [short:begin] and
   [short:end] markers, so this tests what ships, not a copy. Run: node tests/short_line.test.js
   (tests/test_short_line.py runs it under pytest when node is on the path). */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const a = html.indexOf('// [short:begin]'), b = html.indexOf('// [short:end]');
if (a < 0 || b < 0) throw new Error('markers not found in index.html');
const block = html.slice(a, b);

// What the block expects from the page around it.
const env = {
  location: { hostname: 'example.org', search: '' },   // production: SHORT_MIN stays 30
  day: iso => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }),
  money: v => '$' + v.toFixed(2),
};
const factory = new Function('location', 'day', 'money', block + '\nreturn { SHORT_MIN, shortRow, shortLine, pts, dmoney };');
const { SHORT_MIN, shortRow, shortLine, pts, dmoney } = factory(env.location, env.day, env.money);

// The self-check's own rules, so a scenario fails the way the page would on localhost.
const RULES = [
  [/(?<![\d.])(\$?\d+(?:\.\d+)?)\s?[–—]\s?\1(?![\d.])/, 'zero-width range'],
  [/\bNaN\b/, 'NaN'], [/\bundefined\b/, 'undefined'], [/\bnull\b/, 'null'], [/\bInfinity\b/, 'Infinity'],
  [/(?<![\d.\w])-0(?:\.0+)?(?![\d.])/, 'negative zero'], [/\$-0(?:\.0+)?(?!\d)/, 'negative zero dollars'],
  [/\[object /, 'object'], [/%%/, 'doubled percent'],
];
const text = h => h.replace(/<[^>]+>/g, '');
const checkClean = (label, h) => {
  const t = text(h);
  for (const [re, name] of RULES) if (re.test(t)) throw new Error(`${label}: ${name} in "${t}"`);
};

const days = (n, from) => { const out = []; const d = new Date(from + 'T00:00:00Z'); for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); } return out; };
const pct = v => v.toFixed(0) + '%';
const signed = v => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
const linear = (n, from, to) => Array.from({ length: n }, (_, i) => from + (to - from) * i / Math.max(1, n - 1));
const series = (short, n, vals, fmt, dfmt) => shortRow(short === 'H100 listings unavailable' ? 'H100 listings marked unavailable' : short,
  short, days(n, '2026-09-01'), vals, fmt, dfmt, '#', SHORT_MIN);
const four = (nA, nB, nC, nD, opts = {}) => [
  series('H100 listings unavailable', nA, opts.availability || linear(nA, 33, 43), pct, pts),
  series('B200 36-month backwardation', nB, opts.backwardation || linear(nB, -1.2, -0.3), signed, pts),
  series('cheapest-quartile H100 on the fixed panel', nC, opts.p25 || linear(nC, 2.77, 2.92), env.money, dmoney),
  series('specialist premium over marketplace, H100', nD, opts.spread || linear(nD, 0.30, 0.23), env.money, dmoney),
];

let passed = 0;
const scenario = (label, rows, expect) => {
  const out = shortLine(rows);
  checkClean(label, out);
  for (const e of expect) if (!text(out).includes(e)) throw new Error(`${label}: expected "${e}" in "${text(out)}"`);
  passed++;
  console.log('ok  ' + label + '\n    ' + text(out));
};

// 1. Today, 20 captures: the date line, nothing read.
scenario('20 captures, before the date', four(20, 15, 20, 20), ['range 28% – 43%'.replace('28', '33'), 'first trend read Oct 1, 2026', '3 more series accruing']);
// 2. 1 Oct, every series at 30: four clauses, no rank.
scenario('30 captures, all four', four(30, 30, 30, 30), ['Since Sep 1, 2026', 'up to 30 captures', 'H100 listings unavailable 43%', '+', 'No rank yet', 'specialist premium']);
// 3. 1 Oct with the forward curve still dark: three read, one named as waiting.
scenario('forward curve lagging at 15', four(30, 15, 30, 30), ['Still accruing: B200 36-month backwardation (15 captures)', 'cheapest-quartile H100']);
// 4. Only one series has the count: singular wording.
scenario('one series read', four(30, 10, 12, 9), ['over 30 captures', 'Still accruing:', '(10 captures)', '(12 captures)', '(9 captures)']);
// 5. Flat and near-flat series: never "-0.0", never a zero-width range.
scenario('flat and tiny-negative moves', four(30, 30, 30, 30, {
  availability: Array(30).fill(40), backwardation: linear(30, -0.5, -0.5004), p25: Array(30).fill(2.80), spread: linear(30, 0.25, 0.2499) }),
  ['+0.0 pts', '+$0.00']);
// 6. Big falls: the minus sign is the typographic one and the dollars keep their sign.
scenario('large negative moves', four(30, 30, 30, 30, { availability: linear(30, 60, 20), p25: linear(30, 3.50, 2.20) }), ['−$1.03', '-31.7 pts']);   // seven-against-seven means on a straight line, not end to end
// 7. A brand-new series with one capture: no range to print.
scenario('single capture', [series('H100 listings unavailable', 1, [43], pct, pts)], ['H100 listings unavailable: 43%', '1 captures'.replace('1 captures', 'first trend read')]);
// 8. Nothing loaded at all.
scenario('no series', [], ['No accruing series loaded.']);
// 9. Gaps in the dates (missed runs) change nothing but the count.
const gappy = days(45, '2026-09-01').filter((_, i) => i % 3 !== 2);   // 30 of 45 days
scenario('gappy captures', [shortRow('H100 listings marked unavailable', 'H100 listings unavailable', gappy, linear(30, 33, 43), pct, pts, '#', SHORT_MIN)], ['over 30 captures', '+7.9 pts']);   // same seven-against-seven means as scenario 2
// 10. Formatters directly.
for (const [f, v, want] of [[pts, -0.04, '+0.0 pts'], [pts, 0, '+0.0 pts'], [pts, -0.06, '-0.1 pts'], [dmoney, -0.004, '+$0.00'], [dmoney, -0.006, '−$0.01']   /* -0.005 rounds to -0 in JS and prints +$0.00, which is fine */, [dmoney, 1.5, '+$1.50']]) {
  const got = f(v); if (got !== want) throw new Error(`format ${v}: got "${got}", want "${want}"`); passed++;
}
console.log(`\n${passed} scenarios passed; SHORT_MIN in production = ${SHORT_MIN}`);
