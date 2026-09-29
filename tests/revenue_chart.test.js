/* The lab-revenue chart (Tracker.revenueChart in assets/engine.js) across the states the file
   can be in: as committed, one lab, one report, empty, a headline with markup in it, reports
   on the same day, a small figure. Loads the real engine and the real data file, and checks
   every output against the self-check's rules. Run: node tests/revenue_chart.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = { window: {}, document: { addEventListener() {} }, console, Date, Math, JSON };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets', 'engine.js'), 'utf8'), ctx, { filename: 'engine.js' });
const T = ctx.window.Tracker;
if (!T || !T.revenueChart) throw new Error('Tracker.revenueChart not exported');
const DOC = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'reported', 'lab_revenue.json'), 'utf8'));

const RULES = [[/\bNaN\b/, 'NaN'], [/\bundefined\b/, 'undefined'], [/\bnull\b/, 'null'], [/\bInfinity\b/, 'Infinity'],
  [/\[object /, 'object'], [/(?<![\d.\w])-0(?:\.0+)?(?![\d.])/, 'negative zero']];
let passed = 0;
const check = (label, svg, expect) => {
  for (const [re, name] of RULES) if (re.test(svg)) throw new Error(`${label}: ${name} in output`);
  for (const [what, ok] of expect) if (!ok(svg)) throw new Error(`${label}: ${what}\n${svg.slice(0, 400)}`);
  passed++; console.log('ok  ' + label);
};
const count = (s, re) => (s.match(re) || []).length;
const TODAY = '2026-09-29';

check('as committed', T.revenueChart(DOC, { today: TODAY }), [
  ['one marker per report', s => count(s, /<circle /g) === DOC.rows.length],
  ['every marker links to its report', s => count(s, /<a href="https:/g) === DOC.rows.length],
  ['one line per lab', s => count(s, /<polyline /g) === Object.keys(DOC.labs).length],
  ['end labels carry the latest figures', s => s.includes('Anthropic $65B') && s.includes('OpenAI nearly $70B')],
  ['axis runs to today', s => s.includes('>today<')],
  ['company-stated points are filled', s => count(s, /<circle [^>]*fill="var\(--c[27]\)"/g) === DOC.rows.filter(r => r.attribution === 'company').length],
]);
check('mini, for the overview', T.revenueChart(DOC, { today: TODAY, mini: true, w: 150, h: 64 }), [
  ['markers but no links or axes', s => count(s, /<circle /g) === DOC.rows.length && !s.includes('<a ') && !s.includes('>today<')],
  ['end labels are figures only', s => s.includes('>$65B<') && s.includes('>nearly $70B<')],
]);
const one = { labs: { openai: 'OpenAI' }, rows: [DOC.rows.find(r => r.lab === 'openai')] };
check('one lab, one report', T.revenueChart(one, { today: TODAY }), [
  ['a marker and no line', s => count(s, /<circle /g) === 1 && count(s, /<polyline /g) === 0],
]);
check('empty file', T.revenueChart({ labs: {}, rows: [] }), [['says so', s => s.includes('No reported figures')]]);
check('no file', T.revenueChart(null), [['says so', s => s.includes('No reported figures')]]);
const hostile = { labs: { anthropic: 'Anthropic' }, rows: [Object.assign({}, DOC.rows[0], { headline: 'A <script>x</script> & "quote"', url: 'https://x/?a=1&b="2"' })] };
check('markup in a headline is escaped', T.revenueChart(hostile, { today: TODAY }), [
  ['no raw tag', s => !s.includes('<script>') && s.includes('&lt;script>')],
  ['attribute stays closed', s => !/data-tip="[^"]*"quote"/.test(s)],
]);
const sameDay = { labs: DOC.labs, rows: [
  Object.assign({}, DOC.rows[0], { lab: 'anthropic', date: '2026-09-01', published: '2026-09-01', usd_bn: 60 }),
  Object.assign({}, DOC.rows[0], { lab: 'openai', date: '2026-09-01', published: '2026-09-01', usd_bn: 61 })] };
check('two labs on one day at nearly one figure', T.revenueChart(sameDay, { today: TODAY }), [
  ['end labels pushed apart', s => { const ys = [...s.matchAll(/<text x="[\d.]+" y="([\d.]+)" font-size="11" font-weight="650"/g)].map(m => +m[1]); return ys.length === 2 && Math.abs(ys[0] - ys[1]) >= 13; }],
]);
check('a figure under a billion', T.revenueChart({ labs: DOC.labs, rows: [Object.assign({}, DOC.rows[0], { usd_bn: 0.4 })] }, { today: TODAY }), [
  ['prints with a decimal', s => s.includes('$0.4B')],
]);
// End labels must end inside the chart: on 29 Sep 2026 a fixed margin cut "nearly $70B" to
// "nearly $" on the overview. Width is estimated at the label's font size, as the engine does.
const fits = (svg, W, charW) => [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="(\d+)" font-weight="650"[^>]*>([^<]*)<\/text>/g)]
  .every(m => +m[1] + m[3].length * charW <= W + 1);
for (const [w, mini] of [[150, true], [260, true], [420, true], [360, false], [640, false], [1090, false]]) {
  const svg = T.revenueChart(DOC, { today: TODAY, mini, w, h: mini ? 104 : 240 });
  if (!fits(svg, w, mini ? 5.9 : 6.5)) throw new Error(`end label runs past the edge at w=${w} mini=${mini}`);
}
passed++; console.log('ok  end labels fit at six widths');
const L = T.revenueLatest(DOC);
if (L.anthropic.usd_bn !== 65 || L.openai.usd_bn !== 70) throw new Error('revenueLatest: ' + JSON.stringify(L));
passed++;
console.log(`\n${passed} revenue chart checks passed`);
