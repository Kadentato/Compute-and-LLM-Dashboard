/* Compute Futures — price dashboard charts.
   Vanilla SVG, no dependencies. Reads dataFiles/gpu_prices.json and renders
   into elements carrying [data-chart] / [data-spark]. Pages still read fine
   if this file or the fetch fails: all numbers in the prose are static HTML. */

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
          tx.textContent = MONTHS[m - 1] + (m === 1 ? ' ’26' : (dates[i].slice(0, 4) === '2025' && m === 9 ? ' ’25' : ''));
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

  /* ---------- tile sparkline ---------- */
  function sparkline(svgEl, values, color) {
    var W = 120, H = 34;
    svgEl.replaceChildren();
    svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svgEl.setAttribute('preserveAspectRatio', 'none');
    var v = values.filter(function (x) { return x != null; });
    var lo = Math.min.apply(null, v), hi = Math.max.apply(null, v);
    if (hi - lo < 1e-9) hi = lo + 1;
    var n = values.length, d = '', pen = false;
    for (var i = 0; i < n; i++) {
      if (values[i] == null) { pen = false; continue; }
      var x = i / (n - 1) * W;
      var y = 3 + (1 - (values[i] - lo) / (hi - lo)) * (H - 6);
      d += (pen ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      pen = true;
    }
    el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 1.6 }, svgEl);
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

  function renderAll(data) {
    readPalette();
    var D = data.daily;
    var b200usd = D.ratio_b200.map(function (r, i) {
      return (r == null || D.sd_h100_usd[i] == null) ? null : Math.round(r * D.sd_h100_usd[i] * 1000) / 1000;
    });
    var a100usd = D.ratio_a100.map(function (r, i) {
      return (r == null || D.sd_h100_usd[i] == null) ? null : Math.round(r * D.sd_h100_usd[i] * 1000) / 1000;
    });
    var usd = function (v) { return '$' + v.toFixed(2); };

    document.querySelectorAll('[data-chart="benchmarks"]').forEach(function (host) {
      lineChart(host, D.dates, [
        { values: D.sd_h100_usd, color: PAL.h100, label: 'Silicon Data H100 (SDH100RT)', endLabel: 'SD' },
        { values: D.ornn_h100_usd, color: PAL.ornn, label: 'Ornn H100 (ORNNH100)', endLabel: 'Ornn' }
      ], {
        yFmt: usd,
        events: [
          { date: '2025-12-05', label: 'SD index revision' },
          { date: '2026-05-20', label: 'May squeeze' }
        ],
        aria: 'H100 spot rental rate, Silicon Data versus Ornn, September 2025 to August 2026'
      });
    });

    document.querySelectorAll('[data-chart="rebased"]').forEach(function (host) {
      lineChart(host, D.dates, [
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
      lineChart(host, D.dates, [
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

    var sparks = {
      sd_h100: [D.sd_h100_usd, PAL.h100],
      b200_usd: [b200usd, PAL.b200],
      a100_usd: [a100usd, PAL.a100],
      ratio_b200: [D.ratio_b200, PAL.b200]
    };
    document.querySelectorAll('[data-spark]').forEach(function (svgEl) {
      var cfg = sparks[svgEl.dataset.spark];
      if (cfg) sparkline(svgEl, cfg[0], cfg[1]);
    });
  }

  fetch('dataFiles/gpu_prices.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      renderAll(data);

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
