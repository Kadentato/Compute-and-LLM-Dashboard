/* Runs the whole compute renderer (compute/scripts/charts.js) in node against the real data
   files, with a permissive stand-in for the DOM, and fails on any error it logs. Each data
   state is forced so branches that only run on some days are exercised today: on 21 Sep 2026
   a takeaway called a formatter out of scope on the branch where the two benchmarks disagree,
   the check that day saw them agree, and the dashboard stopped rendering the first day they
   did not. Run: node tests/charts_render.test.js (tests/test_charts_render.py runs it under
   pytest when node is on the path). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
// CHARTS_SRC points the test at another copy, so a deliberately broken one can prove it fails.
const SRC = process.env.CHARTS_SRC ? fs.readFileSync(process.env.CHARTS_SRC, 'utf8') : read('compute/scripts/charts.js');
const ECON = read('assets/econ.js');
const STATIC = JSON.parse(read('compute/dataFiles/gpu_prices.json'));
const LIVE = JSON.parse(read('compute/dataFiles/gpu_live.json'));
const META = JSON.parse(read('data/derived/meta.json'));

// A DOM stand-in that accepts anything. Every property read returns another stand-in, every
// call returns one, and it coerces to an empty string or zero. The point is not to draw but to
// run every line of the renderer's logic, so a ReferenceError or TypeError surfaces.
function stub(name) {
  const f = function () { return stub(name + '()'); };
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return h => (h === 'number' ? 0 : '');
      if (k === 'toString' || k === 'valueOf') return () => '';
      if (k === 'length') return 0;
      if (k === 'forEach' || k === 'map' || k === 'filter') return () => [];
      if (k === 'then') return undefined;               // not a thenable
      if (k in t && typeof k === 'symbol') return t[k];
      if (!(k in store(t))) store(t)[k] = stub(name + '.' + String(k));
      return store(t)[k];
    },
    set(t, k, v) { store(t)[k] = v; return true; },
    apply() { return stub(name + '()'); },
  });
}
const stores = new WeakMap();
const store = t => { if (!stores.has(t)) stores.set(t, {}); return stores.get(t); };

async function render(label, mutate) {
  const data = JSON.parse(JSON.stringify(STATIC));
  const live = JSON.parse(JSON.stringify(LIVE));
  mutate(data, live);
  const errors = [];
  const written = {};
  const byId = {};
  const el = id => byId[id] || (byId[id] = new Proxy(stub('#' + id), {
    set(t, k, v) { if (k === 'innerHTML' || k === 'textContent') written[id] = String(v); return true; },
  }));
  const document = new Proxy(stub('document'), {
    get(t, k) {
      if (k === 'getElementById') return el;
      if (k === 'querySelector') return sel => (sel === '[data-chart]' ? stub('host') : stub(sel));
      if (k === 'querySelectorAll') return () => [];
      if (k === 'documentElement') return stub('html');
      return t[k];
    },
  });
  const files = {
    'dataFiles/gpu_prices.json': data, 'dataFiles/gpu_live.json': live, '../data/derived/meta.json': META,
  };
  const ctx = {
    document, console: { error: (...a) => errors.push(a.join(' ')), warn() {}, log() {}, info() {} },
    fetch: url => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(JSON.stringify(files[url.split('?')[0]] || {}))) }),
    getComputedStyle: () => ({ getPropertyValue: () => '#000' }),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {},
    innerWidth: 1280, devicePixelRatio: 1, location: { hostname: 'example.org', search: '' },
    Math, Date, JSON, Object, Array, String, Number, Promise, isFinite, isNaN, parseFloat, parseInt,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  try {
    vm.runInContext(ECON, ctx, { filename: 'econ.js' });
    vm.runInContext(SRC, ctx, { filename: 'charts.js' });
  } catch (e) { errors.push('load: ' + e.message); }
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  const need = ['c-movers', 'c-take-basis', 'c-take-fwd', 'stampline'];
  const missing = need.filter(id => !written[id]);
  if (errors.length || missing.length) {
    throw new Error(`${label}: ${errors.join(' | ') || ''}${missing.length ? ' | never written: ' + missing.join(', ') : ''}`);
  }
  console.log('ok  ' + label + '\n    ' + (written['c-take-basis'] || '').replace(/<[^>]+>/g, '').slice(0, 110));
}

// Force the latest Ornn and Silicon Data H100 prints to a given basis on the newest date both carry.
const setBasis = pct => (data, live) => {
  const sd = live.sd && live.sd.h100, orn = live.ornn && live.ornn['H100 SXM'];
  if (!sd || !orn) return;
  const d = Object.keys(sd).filter(k => orn[k] != null).sort().pop();
  if (d) orn[d] = sd[d] * (1 + pct / 100);
};
const staleForward = (data, live) => { if (live.sd_forward) live.sd_forward.as_of = '2026-09-01'; };
const noLive = (data, live) => { for (const k of Object.keys(live)) delete live[k]; };

(async () => {
  await render('real data as committed', () => {});
  await render('benchmarks disagree, settled below', setBasis(-6.3));
  await render('benchmarks disagree, settled above', setBasis(+4.1));
  await render('benchmarks agree to a hundredth', setBasis(0.01));
  await render('benchmarks agree exactly', setBasis(0));
  await render('forward curve stale', staleForward);
  await render('no live file at all', noLive);
  console.log('\n7 render states passed');
})().catch(e => { console.error(e.message); process.exit(1); });
