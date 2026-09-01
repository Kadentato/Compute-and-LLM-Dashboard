/* Compute Futures — price dashboard engine.
   Vanilla SVG, no dependencies. Reads the static Bloomberg series
   (dataFiles/gpu_prices.json), splices on the daily public-feed values
   (dataFiles/gpu_live.json), and renders charts into [data-chart] hosts plus
   the scoreboard/readout/rank panels by id. The analysis page keeps every
   number in static prose, so it still reads correctly if this file fails. */

(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function niceTicks(lo, hi, target) {
    var span = hi - lo || 1;
    var raw = span / (target || 5);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var step = mag;
    [1, 2, 2.5, 5, 10].some(function (m) {
      if (raw / mag <= m) { step = m * mag; return true; }
      return false;
    });
    var t0 = Math.ceil(lo / step) * step;
    var out = [];
    for (var v = t0; v <= hi + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  function fmtDate(iso) {
    var p = iso.split('-');
    return MONTHS[+p[1] - 1] + ' ' + (+p[2]) + ', ' + p[0];
  }

  /* ---------- generic daily line chart ---------- */
  function lineChart(host, dates, seriesList, opts) {
    opts = opts || {};
    host.replaceChildren();
    var W = 920, H = 340, L = 44, R = 86, T = 14, B = 28;
    var iw = W - L - R, ih = H - T - B;

    var lo = Infinity, hi = -Infinity;
    seriesList.forEach(function (s) {
      s.values.forEach(function (v) {
        if (v == null) return;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      });
    });
    (opts.refLines || []).forEach(function (r) {
      if (r.v < lo) lo = r.v;
      if (r.v > hi) hi = r.v;
    });
    var pad = (hi - lo) * 0.07 || 1;
    lo -= pad; hi += pad;
    if (opts.yMin != null) lo = opts.yMin;

    var n = dates.length;
    function X(i) { return L + (i / (n - 1)) * iw; }
    function Y(v) { return T + (1 - (v - lo) / (hi - lo)) * ih; }

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart', role: 'img' });
    if (opts.aria) svg.setAttribute('aria-label', opts.aria);

    // y gridlines + labels
    var yt = niceTicks(lo, hi, 5);
    yt.forEach(function (v) {
      el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), 'class': 'gridline' }, svg);
      var t = el('text', { x: L - 6, y: Y(v) + 4, 'text-anchor': 'end', 'class': undefined }, svg);
      t.setAttribute('class', '');
      t.textContent = opts.yFmt ? opts.yFmt(v) : v;
      t.setAttribute('fill', 'var(--ink-dim)');
      t.setAttribute('font-size', '11');
    });

    // x ticks at month starts
    for (var i = 0; i < n; i++) {
      if (dates[i].slice(8) === '01') {
        var m = +dates[i].slice(5, 7);
        el('line', { x1: X(i), x2: X(i), y1: H - B, y2: H - B + 4, stroke: 'var(--border)' }, svg);
        if ((m - 1) % 2 === 0 || n < 200) {
          var tx = el('text', { x: X(i), y: H - B + 16, 'text-anchor': 'middle' }, svg);
          tx.textContent = MONTHS[m - 1] + (m === 1 || m === 9 ? ' ’' + dates[i].slice(2, 4) : '');
          tx.setAttribute('fill', 'var(--ink-dim)');
          tx.setAttribute('font-size', '11');
        }
      }
    }
    el('line', { x1: L, x2: W - R, y1: H - B, y2: H - B, stroke: 'var(--border)' }, svg);

    // reference lines
    (opts.refLines || []).forEach(function (r) {
      el('line', { x1: L, x2: W - R, y1: Y(r.v), y2: Y(r.v), 'class': 'refline' }, svg);
      if (r.label) {
        var t = el('text', { x: L + 6, y: Y(r.v) + (r.below ? 14 : -5), 'class': 'reflabel' }, svg);
        t.textContent = r.label;
      }
    });

    // event markers
    var evSlot = 0;
    (opts.events || []).forEach(function (ev) {
      var i = dates.indexOf(ev.date);
      if (i < 0) return;
      el('line', { x1: X(i), x2: X(i), y1: T + 16, y2: H - B, 'class': 'evline' }, svg);
      var t = el('text', { x: X(i) + 4, y: T + 10 + (evSlot % 2) * 12, 'class': 'evlabel' }, svg);
      t.textContent = ev.label;
      evSlot++;
    });

    // series paths
    seriesList.forEach(function (s) {
      var d = '', pen = false;
      for (var i = 0; i < n; i++) {
        var v = s.values[i];
        if (v == null) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
        pen = true;
      }
      el('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': 2,
        'stroke-dasharray': s.dash || 'none', 'stroke-linejoin': 'round' }, svg);
    });

    // end labels with simple collision spreading
    var labels = seriesList.map(function (s) {
      var li = s.values.length - 1;
      while (li >= 0 && s.values[li] == null) li--;
      return { s: s, i: li, y: Y(s.values[li]) };
    }).sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < labels.length; k++) {
      if (labels[k].y - labels[k - 1].y < 14) labels[k].y = labels[k - 1].y + 14;
    }
    labels.forEach(function (lb) {
      var t = el('text', { x: X(lb.i) + 6, y: lb.y + 4, 'class': 'endlabel', fill: lb.s.color }, svg);
      t.textContent = (opts.yFmt ? opts.yFmt(lb.s.values[lb.i]) : lb.s.values[lb.i]) +
        (lb.s.endLabel ? ' ' + lb.s.endLabel : '');
    });

    // legend
    var legend = document.createElement('div');
    legend.className = 'chartLegend';
    seriesList.forEach(function (s) {
      var item = document.createElement('span');
      var sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = s.color;
      item.appendChild(sw);
      item.appendChild(document.createTextNode(s.label));
      legend.appendChild(item);
    });
    host.appendChild(legend);
    host.appendChild(svg);

    // hover crosshair + tooltip
    var tip = document.createElement('div');
    tip.className = 'chartTip';
    host.appendChild(tip);
    var cross = el('line', { y1: T, y2: H - B, stroke: 'var(--ink-dim)', 'stroke-width': 1, visibility: 'hidden' }, svg);
    var overlay = el('rect', { x: L, y: T, width: iw, height: ih, fill: 'transparent' }, svg);

    overlay.addEventListener('mousemove', function (evd) {
      var r = svg.getBoundingClientRect();
      var fx = (evd.clientX - r.left) / r.width * W;
      var i = Math.round((fx - L) / iw * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i));
      cross.setAttribute('visibility', 'visible');
      var rows = '<div class="tipDate">' + fmtDate(dates[i]) + '</div>';
      seriesList.forEach(function (s) {
        var v = s.values[i];
        rows += '<div><span class="swatch" style="background:' + s.color + '"></span>' + s.label + ': <b>' +
          (v == null ? '—' : (opts.yFmt ? opts.yFmt(v) : v)) + '</b></div>';
      });
      tip.innerHTML = rows;
      tip.style.display = 'block';
      var hostR = host.getBoundingClientRect();
      var px = evd.clientX - hostR.left + 14;
      if (px + tip.offsetWidth > hostR.width - 8) px = evd.clientX - hostR.left - tip.offsetWidth - 14;
      tip.style.left = px + 'px';
      tip.style.top = (evd.clientY - hostR.top - 10) + 'px';
    });
    overlay.addEventListener('mouseleave', function () {
      tip.style.display = 'none';
      cross.setAttribute('visibility', 'hidden');
    });
  }

  /* ---------- forward curve small multiples ---------- */
  function forwardChart(host, fwd, mode) {
    host.querySelectorAll('.fwdWrap').forEach(function (n) { n.remove(); });
    var wrap = document.createElement('div');
    wrap.className = 'fwdWrap';
    wrap.style.display = 'grid';
    wrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(240px, 1fr))';
    wrap.style.gap = '0.8rem';

    var gpus = [
      { key: 'h100', name: 'H100' },
      { key: 'b200', name: 'B200' },
      { key: 'a100', name: 'A100' }
    ];
    var tenors = fwd.tenors;

    // shared scale for % mode (the honest comparison view)
    var pLo = 0, pHi = 0;
    gpus.forEach(function (g) {
      ['term', 'fwd'].forEach(function (kind) {
        fwd[g.key][kind].forEach(function (v) {
          var p = (v / fwd[g.key][kind === 'term' ? 'term' : 'fwd'][0] - 1) * 100;
          if (p < pLo) pLo = p;
          if (p > pHi) pHi = p;
        });
      });
    });
    pLo -= 1; pHi += 1;

    gpus.forEach(function (g) {
      var W = 300, H = 220, L = 40, R = 14, T = 26, B = 24;
      var iw = W - L - R, ih = H - T - B;
      var box = document.createElement('div');
      var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart', role: 'img',
        'aria-label': g.name + ' term structure and implied forwards' });

      var term = fwd[g.key].term, fw = fwd[g.key].fwd;
      var vals, yFmt, lo, hi;
      if (mode === 'pct') {
        vals = {
          term: term.map(function (v) { return (v / term[0] - 1) * 100; }),
          fwd: fw.map(function (v) { return (v / fw[0] - 1) * 100; })
        };
        lo = pLo; hi = pHi;
        yFmt = function (v) { return (v > 0 ? '+' : '') + v.toFixed(0) + '%'; };
      } else {
        vals = { term: term, fwd: fw };
        lo = Math.min.apply(null, term.concat(fw));
        hi = Math.max.apply(null, term.concat(fw));
        var pad = (hi - lo) * 0.12 || 0.1;
        lo -= pad; hi += pad;
        yFmt = function (v) { return '$' + v.toFixed(2); };
      }

      function X(i) { return L + i / (tenors.length - 1) * iw; }
      function Y(v) { return T + (1 - (v - lo) / (hi - lo)) * ih; }

      var title = el('text', { x: L, y: 14, 'font-size': '12', 'font-weight': '700', fill: 'var(--ink)' }, svg);
      title.textContent = g.name + (mode === 'pct' ? ' — % vs spot' : ' — USD/GPU-hr');

      niceTicks(lo, hi, 4).forEach(function (v) {
        el('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), 'class': 'gridline' }, svg);
        var t = el('text', { x: L - 4, y: Y(v) + 3, 'text-anchor': 'end', 'font-size': '9.5', fill: 'var(--ink-dim)' }, svg);
        t.textContent = yFmt(v);
      });
      tenors.forEach(function (tn, i) {
        var t = el('text', { x: X(i), y: H - 8, 'text-anchor': 'middle', 'font-size': '9.5', fill: 'var(--ink-dim)' }, svg);
        t.textContent = tn;
      });
      if (mode === 'pct') el('line', { x1: L, x2: W - R, y1: Y(0), y2: Y(0), 'class': 'refline' }, svg);

      [['term', PAL.h100, 'Term rate (lock in today)'], ['fwd', PAL.fwd, 'Implied forward (expected spot)']].forEach(function (cfg) {
        var key = cfg[0], color = cfg[1], label = cfg[2];
        var d = '';
        vals[key].forEach(function (v, i) { d += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
        el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2 }, svg);
        vals[key].forEach(function (v, i) {
          var c = el('circle', { cx: X(i), cy: Y(v), r: 3, fill: color }, svg);
          var ti = el('title', {}, c);
          ti.textContent = g.name + ' ' + label + ' — ' + tenors[i] + ': $' +
            fwd[g.key][key][i].toFixed(2) + (i ? ' (' + ((fwd[g.key][key][i] / fwd[g.key][key][0] - 1) * 100).toFixed(1) + '% vs spot)' : '');
        });
      });
      box.appendChild(svg);
      wrap.appendChild(box);
    });
    host.appendChild(wrap);
  }

  /* ---------- range tabs ---------- */
  var RANGES = [
    { label: '1M', days: 30 }, { label: '3M', days: 90 }, { label: '6M', days: 180 },
    { label: '1Y', days: 365 }, { label: 'ALL', days: 0 }
  ];

  function mountLine(host, dates, series, opts) {
    if (!host.dataset.ranges) { lineChart(host, dates, series, opts); return; }
    host.replaceChildren();
    var cur = +(host.dataset.range || 0);
    var bar = document.createElement('div');
    bar.className = 'ranges';
    RANGES.forEach(function (r) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = r.label;
      if (cur === r.days) b.classList.add('on');
      b.addEventListener('click', function () {
        host.dataset.range = r.days;
        mountLine(host, dates, series, opts);
      });
      bar.appendChild(b);
    });
    var slot = document.createElement('div');
    host.appendChild(bar);
    host.appendChild(slot);
    var start = cur > 0 ? Math.max(0, dates.length - cur) : 0;
    lineChart(slot, dates.slice(start), series.map(function (s) {
      return { values: s.values.slice(start), color: s.color, label: s.label, endLabel: s.endLabel, dash: s.dash };
    }), opts);
  }

  /* ---------- series maths for the scoreboard ---------- */
  function lastIdx(vals) {
    for (var i = vals.length - 1; i >= 0; i--) if (vals[i] != null) return i;
    return -1;
  }
  function isoMinus(iso, days) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }
  function latest(vals) {
    var i = lastIdx(vals);
    return i < 0 ? null : vals[i];
  }
  /* Value as of `days` ago: the most recent print at or before that date. */
  function backValue(dates, vals, days) {
    var li = lastIdx(vals);
    if (li < 0) return null;
    var target = isoMinus(dates[li], days);
    for (var i = li; i >= 0; i--) if (vals[i] != null && dates[i] <= target) return vals[i];
    return null;
  }

  function deltaCells(dates, vals, kind) {
    var now = latest(vals);
    return [7, 30, 90].map(function (n) {
      var then = backValue(dates, vals, n);
      if (now == null || then == null) return { txt: '–', dir: 0 };
      var raw = kind === 'pct' ? (now / then - 1) * 100 : now - then;
      if (Math.abs(raw) < (kind === 'x' ? 0.005 : 0.05)) return { txt: '0', dir: 0 };
      var txt;
      if (kind === 'pct') txt = (raw >= 0 ? '+' : '') + raw.toFixed(1) + '%';
      else if (kind === 'pp') txt = (raw >= 0 ? '+' : '') + raw.toFixed(1) + 'pp';
      else txt = (raw >= 0 ? '+' : '') + raw.toFixed(2) + 'x';
      return { txt: txt, dir: raw > 0 ? 1 : -1 };
    });
  }

  function movers(host, rows) {
    if (!host) return;
    host.innerHTML = '<table class="mvT"><thead><tr><th>Series</th><th class="num">Latest</th>' +
      '<th class="num">7d</th><th class="num">30d</th><th class="num">90d</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td' + (r.tip ? ' data-tip="' + r.tip + '"' : '') + '>' + r.label + '</td>' +
          '<td class="num lat">' + r.latest + '</td>' +
          r.d.map(function (x) {
            return '<td class="num ' + (x.dir > 0 ? 'up' : x.dir < 0 ? 'dn' : '') + '">' + x.txt + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
  }

  /* ---------- hover explainers ---------- */
  function initTips() {
    var box = document.getElementById('tipbox');
    if (!box) return;
    var show = function (target, x, y) {
      box.textContent = target.getAttribute('data-tip');
      box.style.display = 'block';
      var r = box.getBoundingClientRect();
      var left = Math.min(Math.max(8, x + 14), innerWidth - r.width - 8);
      var top = y + 18 + r.height > innerHeight ? y - r.height - 12 : y + 18;
      box.style.left = left + 'px';
      box.style.top = Math.max(8, top) + 'px';
    };
    var hide = function () { box.style.display = 'none'; };
    document.addEventListener('mousemove', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (t) show(t, e.clientX, e.clientY); else hide();
    });
    document.addEventListener('focusin', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { hide(); return; }
      var r = t.getBoundingClientRect();
      show(t, r.left, r.bottom);
    });
    document.addEventListener('focusout', hide);
    document.querySelectorAll('.info').forEach(function (i) {
      i.setAttribute('tabindex', '0');
      i.setAttribute('role', 'note');
    });
  }

  /* ---------- boot ---------- */
  var PAL = {};
  function readPalette() {
    var cs = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var x = cs.getPropertyValue(name).trim();
      return x || fallback;
    }
    PAL.h100 = v('--ch-h100', '#2a78d6');
    PAL.ornn = v('--ch-ornn', '#eb6834');
    PAL.b200 = v('--ch-b200', '#1baf7a');
    PAL.a100 = v('--ch-a100', '#8a8172');
    PAL.fwd = v('--ch-fwd', '#c98500');
  }

  function derived(D) {
    var usdOf = function (ratio) {
      return ratio.map(function (r, i) {
        return (r == null || D.sd_h100_usd[i] == null) ? null : Math.round(r * D.sd_h100_usd[i] * 1000) / 1000;
      });
    };
    return {
      b200usd: usdOf(D.ratio_b200),
      a100usd: usdOf(D.ratio_a100),
      spread: D.dates.map(function (d, i) {
        var s = D.sd_h100_usd[i], o = D.ornn_h100_usd[i];
        return (s == null || o == null) ? null : (o / s - 1) * 100;
      })
    };
  }

  function renderAll(data) {
    readPalette();
    var D = data.daily;
    var X = derived(D);
    var usd = function (v) { return '$' + v.toFixed(2); };

    document.querySelectorAll('[data-chart="benchmarks"]').forEach(function (host) {
      mountLine(host, D.dates, [
        { values: D.sd_h100_usd, color: PAL.h100, label: 'Silicon Data H100 (SDH100RT)', endLabel: 'SD' },
        { values: D.ornn_h100_usd, color: PAL.ornn, label: 'Ornn H100 (ORNNH100)', endLabel: 'Ornn' }
      ], {
        yFmt: usd,
        events: [
          { date: '2025-12-05', label: 'SD index revision' },
          { date: '2026-05-20', label: 'May squeeze' }
        ],
        aria: 'H100 spot rental rate, Silicon Data versus Ornn'
      });
    });

    document.querySelectorAll('[data-chart="rebased"]').forEach(function (host) {
      mountLine(host, D.dates, [
        { values: D.reb_h100, color: PAL.h100, label: 'H100 (SDH100RT)', endLabel: 'H100' },
        { values: D.reb_b200, color: PAL.b200, label: 'B200 (SDB200RT)', endLabel: 'B200' },
        { values: D.reb_a100, color: PAL.a100, label: 'A100 (SDA100RT)', endLabel: 'A100' }
      ], {
        yFmt: function (v) { return v.toFixed(0); },
        refLines: [{ v: 100, label: '100 = 1 Sep 2025' }],
        aria: 'GPU rental price indices rebased to 100 at 1 September 2025'
      });
    });

    document.querySelectorAll('[data-chart="ratios"]').forEach(function (host) {
      mountLine(host, D.dates, [
        { values: D.ratio_b200, color: PAL.b200, label: 'B200 / H100 price ratio', endLabel: 'B200/H100' },
        { values: D.ratio_a100, color: PAL.a100, label: 'A100 / H100 price ratio', endLabel: 'A100/H100' }
      ], {
        yFmt: function (v) { return v.toFixed(2) + 'x'; },
        yMin: 0,
        refLines: [
          { v: 2.2, label: 'B200/H100 training parity (2.2x)' },
          { v: 0.45, label: 'A100/H100 training parity (0.45x)', below: true }
        ],
        events: [
          { date: '2025-12-05', label: 'SD index revision' },
          { date: '2026-03-28', label: 'Late-Mar squeeze' },
          { date: '2026-07-08', label: 'Jul episode' }
        ],
        aria: 'Generational price ratios versus training-performance parity'
      });
    });

    document.querySelectorAll('[data-chart="forward"]').forEach(function (host) {
      forwardChart(host, data.forward, host.dataset.mode || 'pct');
    });

    /* ----- scoreboard ----- */
    var pb = data.spot.b200.parity_train, pa = data.spot.a100.parity_train;
    var effB = X.b200usd.map(function (v) { return v == null ? null : v / pb; });
    var effA = X.a100usd.map(function (v) { return v == null ? null : v / pa; });
    var f2 = function (v) { return v == null ? '–' : '$' + v.toFixed(2); };
    var fx = function (v) { return v == null ? '–' : v.toFixed(2) + 'x'; };
    var fpct = function (v) { return v == null ? '–' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };

    movers(document.getElementById('c-movers'), [
      { label: 'H100 — Silicon Data ($/GPU-hr)',
        tip: 'The standardized assessed market rate to rent one H100 for an hour. This is the reference asset for the whole market.',
        latest: f2(latest(D.sd_h100_usd)), d: deltaCells(D.dates, D.sd_h100_usd, 'pct') },
      { label: 'H100 — Ornn settled ($/GPU-hr)',
        tip: 'The same chip priced from transactions that actually cleared, rather than from an assessment. Gaps versus Silicon Data are the story, not an error.',
        latest: f2(latest(D.ornn_h100_usd)), d: deltaCells(D.dates, D.ornn_h100_usd, 'pct') },
      { label: 'Benchmark spread (Ornn vs SD)',
        tip: 'How far settled deals sit from the standardized rate. Wide means transactions and market rates have come apart; narrow means a settled market.',
        latest: fpct(latest(X.spread)), d: deltaCells(D.dates, X.spread, 'pp') },
      { label: 'B200 ($/GPU-hr)',
        tip: 'The newest Blackwell-generation chip, derived from its ratio to H100 applied to the H100 print.',
        latest: f2(latest(X.b200usd)), d: deltaCells(D.dates, X.b200usd, 'pct') },
      { label: 'A100 ($/GPU-hr)',
        tip: 'The oldest chip still widely rented: cheapest to rent, most expensive per unit of work.',
        latest: f2(latest(X.a100usd)), d: deltaCells(D.dates, X.a100usd, 'pct') },
      { label: 'B200 / H100 ratio (parity 2.2x)',
        tip: 'What a B200 costs relative to an H100. At or below 2.2x means it is priced at or under what its extra performance justifies.',
        latest: fx(latest(D.ratio_b200)), d: deltaCells(D.dates, D.ratio_b200, 'x') },
      { label: 'A100 / H100 ratio (parity 0.45x)',
        tip: 'What an A100 costs relative to an H100. It has held well above 0.45x all year — a premium to its productivity.',
        latest: fx(latest(D.ratio_a100)), d: deltaCells(D.dates, D.ratio_a100, 'x') },
      { label: 'Cheapest compute (B200, $/H100-eq-hr)',
        tip: 'B200 rental rate divided by its 2.2x training-performance multiple: what an H100-equivalent hour of work costs on the newest chip.',
        latest: f2(latest(effB)), d: deltaCells(D.dates, effB, 'pct') }
    ]);

    /* ----- readout above the H100 chart ----- */
    var ro = document.getElementById('c-readout');
    if (ro) {
      var rows = [
        { name: 'Silicon Data', color: PAL.h100, v: f2(latest(D.sd_h100_usd)),
          tip: 'Latest standardized assessed H100 rate.' },
        { name: 'Ornn settled', color: PAL.ornn, v: f2(latest(D.ornn_h100_usd)),
          tip: 'Latest settled H100 transaction index.' },
        { name: 'Spread', color: null, v: fpct(latest(X.spread)),
          tip: 'Ornn relative to Silicon Data. Positive means deals are clearing above the assessed rate.' }
      ];
      ro.innerHTML = rows.map(function (r) {
        return '<div class="r" data-tip="' + r.tip + '"><span class="rl">' +
          (r.color ? '<i style="background:' + r.color + '"></i>' : '') +
          r.name + '</span><span class="rv">' + r.v + '</span></div>';
      }).join('');
    }

    /* ----- price per unit of real work ----- */
    var effEl = document.getElementById('c-effective');
    if (effEl) {
      var items = [
        { name: 'B200', cost: latest(effB), price: latest(D.ratio_b200), parity: pb },
        { name: 'H100', cost: latest(D.sd_h100_usd), price: 1, parity: 1 },
        { name: 'A100', cost: latest(effA), price: latest(D.ratio_a100), parity: pa }
      ].filter(function (i) { return i.cost != null && i.price != null; })
        .sort(function (a, b) { return a.cost - b.cost; });
      effEl.innerHTML = items.map(function (it, i) {
        var over = it.price > it.parity;
        var tag = it.name === 'H100' ? 'reference' :
          it.price.toFixed(2) + 'x price / ' + it.parity + 'x work';
        var tip = it.name === 'H100' ? 'Every other chip is priced relative to this one.' :
          (over ? 'Priced above what its measured performance justifies.'
                : 'Priced at or below what its measured performance justifies.');
        return '<li><span class="n">' + (i + 1) + '</span><span class="name">' + it.name + '</span>' +
          '<span class="tag' + (over ? ' over' : '') + '" data-tip="' + tip + '">' + tag + '</span>' +
          '<span class="val">$' + it.cost.toFixed(2) + '</span></li>';
      }).join('');
    }
  }

  function isoAddDay(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  function fmtShort(iso) {
    return MONTHS[+iso.slice(5, 7) - 1] + ' ' + (+iso.slice(8)) + ', ' + iso.slice(0, 4);
  }

  /* Splice the daily public-feed values (gpu_live.json, written by
     collector/collect_gpu.py) onto the static Bloomberg series. */
  function mergeLive(data, live) {
    var D = data.daily;
    var ornn = (live.ornn && live.ornn['H100 SXM']) || {};
    var sdh = (live.sd && live.sd.h100) || {};
    var sdb = (live.sd && live.sd.b200) || {};
    var sda = (live.sd && live.sd.a100) || {};

    // Fill missing prints inside the static window from the source's own feed.
    D.dates.forEach(function (d, i) {
      if (D.ornn_h100_usd[i] == null && ornn[d] != null) D.ornn_h100_usd[i] = ornn[d];
    });

    // Extend day by day past the static end.
    var maxDate = D.dates[D.dates.length - 1];
    [ornn, sdh].forEach(function (m) {
      Object.keys(m).forEach(function (d) { if (d > maxDate) maxDate = d; });
    });
    var baseH = D.sd_h100_usd[0];
    var baseB = D.ratio_b200[0] * baseH;
    var baseA = D.ratio_a100[0] * baseH;
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    var r4 = function (v) { return Math.round(v * 10000) / 10000; };
    var d = isoAddDay(D.dates[D.dates.length - 1]);
    while (d <= maxDate) {
      var h = sdh[d] != null ? sdh[d] : null;
      var b = sdb[d] != null ? sdb[d] : null;
      var a = sda[d] != null ? sda[d] : null;
      D.dates.push(d);
      D.sd_h100_usd.push(h);
      D.ornn_h100_usd.push(ornn[d] != null ? ornn[d] : null);
      D.reb_h100.push(h != null ? r2(100 * h / baseH) : null);
      D.reb_b200.push(b != null ? r2(100 * b / baseB) : null);
      D.reb_a100.push(a != null ? r2(100 * a / baseA) : null);
      D.ratio_b200.push(h != null && b != null ? r4(b / h) : null);
      D.ratio_a100.push(h != null && a != null ? r4(a / h) : null);
      d = isoAddDay(d);
    }
  }

  /* GPUs outside the report's three, straight from the daily feeds. */
  function renderOthers(live) {
    var host = document.getElementById('c-others');
    if (!host || !live) return;
    var rows = [];
    var pick = function (map, label, source, tip) {
      if (!map) return;
      var dates = Object.keys(map).sort();
      if (!dates.length) return;
      var last = dates[dates.length - 1];
      var prev = null;
      for (var i = dates.length - 2; i >= 0; i--) {
        if (dates[i] <= isoMinus(last, 7)) { prev = map[dates[i]]; break; }
      }
      rows.push({
        name: label, source: source, value: map[last],
        chg: prev == null ? null : (map[last] / prev - 1) * 100,
        tip: tip + ' Latest print ' + fmtShort(last) + '.'
      });
    };
    pick(live.ornn && live.ornn.H200, 'H200', 'Ornn',
      'Hopper refresh with more memory; settled from transactions.');
    pick(live.sd && live.sd.mi300x, 'MI300X', 'Silicon Data',
      'AMD data-center accelerator — the main non-NVIDIA option.');
    pick(live.ornn && live.ornn['RTX 5090'], 'RTX 5090', 'Ornn',
      'A consumer gaming card rented for AI work; a different market from data-center parts.');
    if (!rows.length) return;
    host.innerHTML = rows.map(function (r, i) {
      var chg = r.chg == null ? '' :
        '<span class="tag' + (r.chg < 0 ? ' over' : '') + '">' +
        (r.chg >= 0 ? '+' : '') + r.chg.toFixed(1) + '% 7d</span>';
      return '<li><span class="n">' + (i + 1) + '</span>' +
        '<span class="name" data-tip="' + r.tip + '">' + r.name +
        ' <span style="color:var(--ink-dim);font-size:0.72rem">' + r.source + '</span></span>' +
        chg + '<span class="val">$' + r.value.toFixed(2) + '</span></li>';
    }).join('');
  }

  function stamp(data, live) {
    var D = data.daily;
    var through = D.dates[lastIdx(D.sd_h100_usd)] || D.dates[D.dates.length - 1];
    var line = document.getElementById('stampline');
    if (line) {
      var when = '';
      if (live && live.generated_at) {
        var g = live.generated_at;
        when = ' · collected ' + g.slice(11, 16) + ' UTC ' + fmtShort(g.slice(0, 10));
      }
      line.textContent = 'Data through ' + fmtShort(through) + when +
        (live ? ' · daily feeds live' : ' · static snapshot');
    }
    var foot = document.getElementById('c-foot');
    if (foot) {
      foot.innerHTML = 'A compact view — every panel links into the ' +
        '<a href="prices-full.html">full analysis</a>. ' +
        '<a href="../methodology.html">Methodology</a> · ' +
        '<a href="https://github.com/Kadentato/Compute-and-LLM-Dashboard">GitHub</a> · ' +
        '<a href="https://github.com/Kadentato/Compute-and-LLM-Dashboard/tree/main/compute/dataFiles">all data</a> · Site v0.23.0';
    }
  }

  Promise.all([
    fetch('dataFiles/gpu_prices.json').then(function (r) { return r.json(); }),
    fetch('dataFiles/gpu_live.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ])
    .then(function (loaded) {
      var data = loaded[0], live = loaded[1];
      if (live) {
        try { mergeLive(data, live); } catch (e) { console.error('live merge: ' + e.message); }
      }
      renderAll(data);
      renderOthers(live);
      stamp(data, live);
      initTips();

      // forward-curve unit toggle (attach once; mode kept on the host)
      document.querySelectorAll('[data-chart="forward"]').forEach(function (host) {
        var tg = host.parentElement.querySelector('.segToggle');
        if (tg) tg.addEventListener('click', function (e) {
          var b = e.target.closest('button');
          if (!b) return;
          tg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          host.dataset.mode = b.dataset.mode;
          forwardChart(host, data.forward, b.dataset.mode);
        });
      });

      // redraw with the other palette when the OS color scheme flips
      if (window.matchMedia) {
        matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
          renderAll(data);
        });
      }
    })
    .catch(function (err) {
      if (window.console) console.error('charts: ' + err.message);
    });
})();
