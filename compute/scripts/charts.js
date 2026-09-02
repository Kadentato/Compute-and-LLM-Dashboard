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
    // Map the viewBox 1:1 onto the rendered width. Scaling a fixed 920-unit
    // box down to a phone shrank every label to ~4px; at 1:1, 11 means 11.
    var W = Math.max(300, Math.round(host.clientWidth || 920));
    var narrow = W < 560;
    var H = narrow ? 300 : 340;
    var L = narrow ? 38 : 44, R = narrow ? 54 : 86, T = 14, B = narrow ? 34 : 28;
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
        if (narrow ? (m - 1) % 3 === 0 : ((m - 1) % 2 === 0 || n < 200)) {
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
    (narrow ? [] : (opts.events || [])).forEach(function (ev) {
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
        (lb.s.endLabel && !narrow ? ' ' + lb.s.endLabel : '');
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

    var onMove = function (evd) {
      if (evd.touches && evd.touches.length) evd = evd.touches[0];
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
    };
    var onLeave = function () {
      tip.style.display = 'none';
      cross.setAttribute('visibility', 'hidden');
    };
    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('mouseleave', onLeave);
    overlay.addEventListener('touchstart', onMove, { passive: true });
    overlay.addEventListener('touchmove', onMove, { passive: true });
    overlay.addEventListener('touchend', onLeave);
  }

  /* ---------- forward curve small multiples ---------- */
  /* Kalshi implied medians, aligned to the SD curve's tenors.
     The contracts settle on ORNN, so in % mode they are rebased to their own
     spot anchor (the Ornn print) — comparing two curves that sit on different
     bases in dollars would be a false comparison. */
  function kalshiPath(live, gpu, tenors) {
    var k = live && live.kalshi && live.kalshi[gpu];
    if (!k) return null;
    var months = Object.keys(k).sort();
    if (months.length < 2) return null;
    var vals = [], oi = 0, n = Math.min(tenors.length, months.length);
    for (var i = 0; i < n; i++) {
      vals.push(k[months[i]].median);
      oi += k[months[i]].open_interest || 0;
    }
    while (vals.length < tenors.length) vals.push(null);
    return { values: vals, months: months.slice(0, n), openInterest: oi };
  }

  function forwardChart(host, fwd, mode, live) {
    host.querySelectorAll('.fwdWrap, .chartLegend').forEach(function (n) { n.remove(); });
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
      var kal = kalshiPath(live, g.name, tenors);
      var kraw = kal ? kal.values : null;
      var vals, yFmt, lo, hi;
      if (mode === 'pct') {
        var kbase = kraw ? kraw[0] : null;
        vals = {
          term: term.map(function (v) { return (v / term[0] - 1) * 100; }),
          fwd: fw.map(function (v) { return (v / fw[0] - 1) * 100; })
        };
        if (kraw && kbase) {
          vals.kalshi = kraw.map(function (v) { return v == null ? null : (v / kbase - 1) * 100; });
        }
        lo = pLo; hi = pHi;
        (vals.kalshi || []).forEach(function (v) {
          if (v == null) return;
          if (v < lo) lo = v - 1;
          if (v > hi) hi = v + 1;
        });
        yFmt = function (v) { return (v > 0 ? '+' : '') + v.toFixed(0) + '%'; };
      } else {
        // USD: omit Kalshi. It settles on Ornn, so its dollar level is not
        // comparable to the Silicon Data curve on a shared axis — on A100 the
        // basis alone is ~38%, which reads as disagreement when it is not.
        vals = { term: term, fwd: fw };
        var all = term.concat(fw);
        lo = Math.min.apply(null, all);
        hi = Math.max.apply(null, all);
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

      [['term', PAL.h100, 'Term rate (lock in today)'],
       ['fwd', PAL.fwd, 'Implied forward (expected spot)'],
       ['kalshi', PAL.ornn, 'Kalshi implied median']].forEach(function (cfg) {
        if (!vals[cfg[0]]) return;
        var key = cfg[0], color = cfg[1], label = cfg[2];
        var series = vals[key];
        var dollars = key === 'kalshi' ? kraw : fwd[g.key][key];
        var d = '', pen = false;
        series.forEach(function (v, i) {
          if (v == null) { pen = false; return; }
          d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
          pen = true;
        });
        el('path', { d: d, fill: 'none', stroke: color, 'stroke-width': 2,
          'stroke-dasharray': key === 'kalshi' ? '5 3' : 'none' }, svg);
        series.forEach(function (v, i) {
          if (v == null) return;
          var c = el('circle', { cx: X(i), cy: Y(v), r: 3, fill: color }, svg);
          var ti = el('title', {}, c);
          ti.textContent = g.name + ' ' + label + ' — ' + tenors[i] + ': $' +
            dollars[i].toFixed(2) +
            (i ? ' (' + ((dollars[i] / dollars[0] - 1) * 100).toFixed(1) + '% vs its own spot)' : '') +
            (key === 'kalshi' ? ' · settles on Ornn' : '');
        });
      });
      box.appendChild(svg);
      wrap.appendChild(box);
    });

    var legend = document.createElement('div');
    legend.className = 'chartLegend';
    var legendRows = [['Term rate — what you lock in today for that term', PAL.h100],
     ['Implied forward — where the market expects spot to be that month', PAL.fwd]];
    if (live && live.kalshi) {
      legendRows.push([mode === 'pct'
        ? 'Kalshi implied median — speculators, settles on Ornn (dashed)'
        : 'Kalshi implied median — hidden in USD: it settles on Ornn, so its level is not comparable here. Switch to % to compare.',
        PAL.ornn]);
    }
    legendRows.forEach(function (cfg) {
      var item = document.createElement('span');
      var sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = cfg[1];
      item.appendChild(sw);
      item.appendChild(document.createTextNode(cfg[0]));
      legend.appendChild(item);
    });
    host.appendChild(legend);
    host.appendChild(wrap);
  }

  /* ---------- basis risk: listed prices vs the index ----------
     Everything is drawn as a percentage of that GPU's index print, so the
     three GPUs share one axis and the readable quantity is the basis. Bars
     are provider medians, not raw offers.

     mode 'robust' keeps only what can carry weight: on-demand listings (the
     product the index is built on) quoted by at least MIN_PROVIDERS providers,
     and the interquartile range only — with a handful of providers the min and
     max are single quotes, not a market. mode 'all' shows everything collected. */
  var MIN_PROVIDERS = 8;

  function dispersionChart(host, live, indexOf, mode) {
    if (!host) return null;
    var disp = live && live.dispersion;
    if (!disp) return null;
    host.replaceChildren();
    var robust = mode !== 'all';

    var GPUS = ['H100', 'B200', 'A100'];
    var rows = [], dropped = [];
    GPUS.forEach(function (g) {
      var idx = indexOf(g);
      if (!disp[g] || idx == null) return;
      ['on_demand', 'spot'].forEach(function (rt) {
        var s = disp[g][rt];
        if (!s) return;
        var thin = s.providers < MIN_PROVIDERS;
        if (robust && (rt !== 'on_demand' || thin)) {
          dropped.push({
            gpu: g, rt: rt, providers: s.providers,
            why: rt !== 'on_demand' ? 'interruptible spot, a different product'
              : 'only ' + s.providers + ' providers quote it'
          });
          return;
        }
        rows.push({
          gpu: g, rt: rt, idx: idx, s: s,
          pct: function (v) { return 100 * v / idx; }
        });
      });
    });
    if (!rows.length) return { rows: rows, dropped: dropped, robust: robust };

    var W = Math.max(300, Math.round(host.clientWidth || 920));
    var narrow = W < 560;
    var rowH = narrow ? 40 : 34, T = 26, B = 48, L = narrow ? 74 : 96, R = narrow ? 8 : 20;
    var H = T + rows.length * rowH + B;
    var lo = 80, hi = 120;
    rows.forEach(function (r) {
      lo = Math.min(lo, r.pct(robust ? r.s.p25 : r.s.min));
      hi = Math.max(hi, r.pct(robust ? r.s.p75 : r.s.max));
    });
    lo = Math.max(0, lo - 8); hi = hi + 8;
    var iw = W - L - R;
    function X(p) { return L + (p - lo) / (hi - lo) * iw; }

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, 'class': 'chart', role: 'img',
      'aria-label': 'Listed provider prices as a percentage of the index' });

    niceTicks(lo, hi, 6).forEach(function (p) {
      el('line', { x1: X(p), x2: X(p), y1: T - 8, y2: H - B, 'class': 'gridline' }, svg);
      var t = el('text', { x: X(p), y: H - B + 16, 'text-anchor': 'middle', 'font-size': '11',
        fill: 'var(--ink-dim)' }, svg);
      t.textContent = Math.round(p) + '%';
    });

    el('line', { x1: X(100), x2: X(100), y1: T - 12, y2: H - B, stroke: 'var(--ink)',
      'stroke-width': 1.5 }, svg);
    var il = el('text', { x: X(100), y: T - 16, 'text-anchor': 'middle', 'font-size': '11',
      'font-weight': '700', fill: 'var(--ink)' }, svg);
    il.textContent = 'The index = 100%';

    var cheap = el('text', { x: X(100) - 10, y: H - B + 32, 'text-anchor': 'end',
      'font-size': '11', fill: 'var(--ink-dim)' }, svg);
    cheap.textContent = '← cheaper than the index';
    var dear = el('text', { x: X(100) + 10, y: H - B + 32, 'font-size': '11',
      fill: 'var(--ink-dim)' }, svg);
    dear.textContent = 'dearer than the index →';

    rows.forEach(function (r, i) {
      var y = T + i * rowH + rowH / 2;
      var color = r.rt === 'spot' ? PAL.a100 : (r.gpu === 'B200' ? PAL.b200 : PAL.h100);
      var lab = el('text', { x: 8, y: narrow ? y - 6 : y + 4, 'font-size': narrow ? '11' : '11.5',
        fill: 'var(--ink-soft)' }, svg);
      lab.textContent = r.gpu + ' · ' + (r.rt === 'spot' ? 'spot' : 'on-demand');

      var tip = r.gpu + ' ' + (r.rt === 'spot' ? 'spot' : 'on-demand') + ': ' +
        r.s.providers + ' providers, ' + r.s.offers + ' offers. Median $' + r.s.median.toFixed(2) +
        ' (' + Math.round(r.pct(r.s.median)) + '% of the $' + r.idx.toFixed(2) +
        ' index); middle half $' + r.s.p25.toFixed(2) + '–$' + r.s.p75.toFixed(2) +
        '; full range $' + r.s.min.toFixed(2) + '–$' + r.s.max.toFixed(2) + '.';

      var g = el('g', {}, svg);
      g.setAttribute('data-tip', tip);

      if (!robust) {
        el('line', { x1: X(r.pct(r.s.min)), x2: X(r.pct(r.s.max)), y1: y, y2: y,
          stroke: color, 'stroke-opacity': 0.45, 'stroke-width': 2 }, g);
        [r.s.min, r.s.max].forEach(function (v) {
          el('line', { x1: X(r.pct(v)), x2: X(r.pct(v)), y1: y - 5, y2: y + 5,
            stroke: color, 'stroke-opacity': 0.6, 'stroke-width': 2 }, g);
        });
      }
      el('rect', { x: X(r.pct(r.s.p25)), y: y - 8,
        width: Math.max(1, X(r.pct(r.s.p75)) - X(r.pct(r.s.p25))),
        height: 16, fill: color, 'fill-opacity': 0.30, rx: 3 }, g);
      el('line', { x1: X(r.pct(r.s.median)), x2: X(r.pct(r.s.median)), y1: y - 9, y2: y + 9,
        stroke: color, 'stroke-width': 2.5 }, g);

      var right = robust ? r.s.p75 : r.s.max;
      var txt = (robust
        ? '$' + r.s.p25.toFixed(2) + '–$' + r.s.p75.toFixed(2)
        : '$' + r.s.min.toFixed(2) + '–$' + r.s.max.toFixed(2)) +
        ' · n=' + r.s.providers;
      if (narrow) {
        var sub = el('text', { x: 8, y: y + 15, 'font-size': '10', fill: 'var(--ink-dim)' }, svg);
        sub.textContent = txt;
      } else {
        var vl = el('text', { x: X(r.pct(right)) + 8, y: y + 4, 'font-size': '10.5',
          fill: 'var(--ink-dim)' }, svg);
        vl.textContent = txt;
      }
    });

    var key = document.createElement('div');
    key.className = 'glyphKey';
    key.innerHTML =
      (robust ? '' :
        '<span><svg viewBox="0 0 26 12"><line x1="1" y1="6" x2="25" y2="6" stroke="currentColor" stroke-opacity="0.5" stroke-width="2"/>' +
        '<line x1="1" y1="2" x2="1" y2="10" stroke="currentColor" stroke-opacity="0.6" stroke-width="2"/>' +
        '<line x1="25" y1="2" x2="25" y2="10" stroke="currentColor" stroke-opacity="0.6" stroke-width="2"/></svg>' +
        'cheapest to dearest provider</span>') +
      '<span><svg viewBox="0 0 26 12"><rect x="3" y="2" width="20" height="8" rx="2" fill="currentColor" fill-opacity="0.3"/></svg>' +
        'middle half of providers</span>' +
      '<span><svg viewBox="0 0 26 12"><line x1="13" y1="1" x2="13" y2="11" stroke="currentColor" stroke-width="2.5"/></svg>' +
        'median provider</span>' +
      '<span><svg viewBox="0 0 26 12"><line x1="13" y1="0" x2="13" y2="12" stroke="currentColor" stroke-width="1.5"/></svg>' +
        'the index (100%)</span>';
    host.appendChild(key);
    host.appendChild(svg);
    return { rows: rows, dropped: dropped, robust: robust };
  }

  /* Rolling realized-vol series aligned to `dates` (null until enough history). */
  function rollingVol(dates, vals, win) {
    var out = new Array(vals.length).fill(null);
    var idx = [];
    for (var i = 0; i < vals.length; i++) {
      if (vals[i] != null) idx.push(i);
      if (idx.length > win) {
        var seg = idx.slice(idx.length - win - 1);
        var rets = [];
        for (var k = 1; k < seg.length; k++) rets.push(Math.log(vals[seg[k]] / vals[seg[k - 1]]));
        var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
        var varr = rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (rets.length - 1);
        out[i] = Math.sqrt(varr) * Math.sqrt(365) * 100;
      }
    }
    return out;
  }

  /* ---------- realized volatility ----------
     Annualised standard deviation of daily log returns over `win` days.
     Assessed indices are smoothed, so this is a floor on traded volatility. */
  function realizedVol(dates, vals, win) {
    var pairs = [];
    for (var i = 0; i < vals.length; i++) if (vals[i] != null) pairs.push([dates[i], vals[i]]);
    if (pairs.length < win + 1) return null;
    var rets = [];
    for (var k = pairs.length - win; k < pairs.length; k++) {
      if (k < 1) continue;
      rets.push(Math.log(pairs[k][1] / pairs[k - 1][1]));
    }
    if (rets.length < 5) return null;
    var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
    var varr = rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (rets.length - 1);
    return Math.sqrt(varr) * Math.sqrt(365) * 100;
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
  /* Last print with its date, so a stale series can be labelled rather than
     silently compared against a fresher one. */
  function lastPrint(dates, vals) {
    var i = lastIdx(vals);
    return i < 0 ? null : { v: vals[i], date: dates[i] };
  }
  function shortDate(iso) {
    return MONTHS[+iso.slice(5, 7) - 1] + ' ' + (+iso.slice(8));
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
      if (Math.abs(raw) < (kind === 'x' ? 0.005 : 0.05)) {
        return { txt: kind === 'x' ? '0.00x' : (kind === 'pp' ? '0.0pp' : '0.0%'), dir: 0 };
      }
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
          '<td class="num lat">' + r.latest +
          (r.asof ? '<span class="asofStamp" data-tip="This series last printed on ' + r.asof +
            '; later dates shown elsewhere on this card come from a source that printed more recently.">' +
            r.asof + '</span>' : '') + '</td>' +
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
      if (pinned) return;                       // a tapped tip stays until dismissed
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (t) show(t, e.clientX, e.clientY); else hide();
    });
    // Touch: there is no hover, so a tap opens the explainer and the next tap
    // anywhere else closes it.
    var pinned = false;
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-tip]');
      if (t) {
        var r = t.getBoundingClientRect();
        show(t, r.left + Math.min(40, r.width / 2), r.top + r.height - 12);
        pinned = true;
        e.stopPropagation();
      } else if (pinned) {
        pinned = false;
        hide();
      }
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
  var PAL = {}, LIVE = null;
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

    var EF = effectiveForward(data, LIVE);
    document.querySelectorAll('[data-chart="forward"]').forEach(function (host) {
      forwardChart(host, EF.fwd, host.dataset.mode || 'pct', LIVE);
    });

    if (LIVE) {
      var dispHost = document.getElementById('c-dispersion');
      var idxOf = function (gpu) {
        return gpu === 'H100' ? latest(D.sd_h100_usd)
          : gpu === 'B200' ? latest(X.b200usd)
          : gpu === 'A100' ? latest(X.a100usd) : null;
      };
      var drawDisp = function (m) {
        var res = dispersionChart(dispHost, LIVE, idxOf, m);
        if (!res) return;
        var h = LIVE.dispersion.H100 && LIVE.dispersion.H100.on_demand;
        var idx = idxOf('H100');
        var note = document.getElementById('c-disp-note');
        if (!h || idx == null) return;
        var over = (h.median / idx - 1) * 100;
        var rule = document.getElementById('c-disp-rule');
        if (rule) {
          rule.innerHTML = res.robust
            ? '<b>High confidence</b> = on-demand listings only (the product the index prices), ' +
              'quoted by at least <b>' + MIN_PROVIDERS + ' providers</b>, showing the middle half of them. ' +
              'Spot is excluded as a different product; thinly-quoted rows are excluded because a percentile ' +
              'across 3–6 providers describes those providers, not a market. The threshold is a judgement call, not a standard.'
            : '<b>All listings</b> = every rental type and provider count collected, each bar extended to its ' +
              'full cheapest-to-dearest range. Use it to see the true spread; do not read any single row as a price.';
        }
        if (res.robust) {
          setHTML('c-take-disp',
            'On the listings solid enough to read, the median provider quotes an H100 at <b>$' +
            h.median.toFixed(2) + '</b> — <b>' + Math.abs(over).toFixed(0) + '% ' +
            (over >= 0 ? 'above' : 'below') + '</b> the <b>$' + idx.toFixed(2) +
            '</b> index — and the middle half of providers sits in a <b>$' + h.p25.toFixed(2) +
            '–$' + h.p75.toFixed(2) + '</b> band. <span class="muted">That gap is structural, not noise: ' +
            'a like-for-like index strips the premium on short-commitment, fully-supported capacity.</span>');
          if (note) {
            note.textContent = res.dropped.length
              ? 'Excluded here: ' + res.dropped.map(function (d) {
                  return d.gpu + ' ' + (d.rt === 'spot' ? 'spot' : 'on-demand') + ' (' + d.why + ')';
                }).join(', ') + '. With fewer than ' + MIN_PROVIDERS +
                ' providers a percentile describes a few quotes rather than a market — switch to all listings to see them.'
              : '';
          }
        } else {
          var ds = LIVE.dispersion.H100 && LIVE.dispersion.H100.spot;
          setHTML('c-take-disp',
            'The median provider lists an H100 at <b>$' + h.median.toFixed(2) + '</b> — <b>' +
            Math.abs(over).toFixed(0) + '% ' + (over >= 0 ? 'above' : 'below') +
            '</b> the <b>$' + idx.toFixed(2) + '</b> index. The middle half of providers spans $' +
            h.p25.toFixed(2) + '–$' + h.p75.toFixed(2) + ', and the full range is <b>' +
            (h.max / h.min).toFixed(1) + 'x wide</b>' +
            (ds ? '; interruptible spot capacity clears near <b>$' + ds.median.toFixed(2) + '</b>' : '') +
            '. <span class="muted">A hedge tracks the index, not any of these invoices — that difference is your basis risk.</span>');
          if (note) {
            note.textContent = 'Why so wide: these are rate cards, not like-for-like prices. ' +
              h.providers + ' providers quote an H100 on-demand hour anywhere from $' +
              h.min.toFixed(2) + ' to $' + h.max.toFixed(2) +
              ' because commitment length, region, interconnect and support all differ. ' +
              'Thinly-quoted rows are included here — read the spread and its direction, never a single number.';
          }
        }
      };
      drawDisp((dispHost && dispHost.dataset.mode) || 'robust');

      var dtg = document.querySelector('.dispToggle');
      if (dtg && !dtg.dataset.wired) {
        dtg.dataset.wired = '1';
        dtg.addEventListener('click', function (e) {
          var btn = e.target.closest('button');
          if (!btn) return;
          dtg.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
          btn.classList.add('on');
          if (dispHost) dispHost.dataset.mode = btn.dataset.mode;
          drawDisp(btn.dataset.mode);
        });
      }
    }

    /* ----- scoreboard ----- */
    var pb = data.spot.b200.parity_train, pa = data.spot.a100.parity_train;
    var effB = X.b200usd.map(function (v) { return v == null ? null : v / pb; });
    var effA = X.a100usd.map(function (v) { return v == null ? null : v / pa; });
    var f2 = function (v) { return v == null ? '–' : '$' + v.toFixed(2); };
    var fx = function (v) { return v == null ? '–' : v.toFixed(2) + 'x'; };
    var fpct = function (v) { return v == null ? '–' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%'; };

    var volH = rollingVol(D.dates, D.sd_h100_usd, 30);
    takeaways(data, D, X, volH);

    // Series print on different days. Stamp any value that is not from the
    // newest date so no two numbers on this card are silently cross-dated.
    var pSd = lastPrint(D.dates, D.sd_h100_usd);
    var pOr = lastPrint(D.dates, D.ornn_h100_usd);
    var pSpread = lastPrint(D.dates, X.spread);
    var newest = [pSd, pOr, pSpread].filter(Boolean)
      .map(function (p) { return p.date; }).sort().pop();
    var stampOf = function (p) {
      return (p && p.date !== newest) ? shortDate(p.date) : null;
    };
    var fvol = function (v) { return v == null ? '–' : v.toFixed(0) + '%'; };

    movers(document.getElementById('c-movers'), [
      { label: 'H100 — Silicon Data index', tip: 'The standardized assessed rate: like-for-like across providers and basis-adjusted. The announced CME contract names this index as its reference — it lists 5 Oct 2026, so nothing settles against it yet.',
        latest: f2(latest(D.sd_h100_usd)), asof: stampOf(pSd), d: deltaCells(D.dates, D.sd_h100_usd, 'pct') },
      { label: 'H100 — Ornn settled (OCPI)', tip: 'The same chip priced from transactions that cleared, and the ICE contract reference.',
        latest: f2(latest(D.ornn_h100_usd)), asof: stampOf(pOr), d: deltaCells(D.dates, D.ornn_h100_usd, 'pct') },
      { label: 'Index basis (Ornn vs SD)', tip: 'Settled minus assessed, in percent. This is the cross-benchmark basis a position referencing one index and hedged in the other would carry.',
        latest: fpct(latest(X.spread)), asof: stampOf(pSpread), d: deltaCells(D.dates, X.spread, 'pp') },
      { label: 'H100 30d realized vol (ann.)', tip: 'Annualised standard deviation of daily log returns over the last 30 prints. Assessed indices are smoothed by construction, so treat this as a floor on traded volatility, not an estimate of it.',
        latest: fvol(latest(volH)), d: deltaCells(D.dates, volH, 'pp') },
      { label: 'B200 ($/GPU-hr)', tip: 'Derived from the B200/H100 ratio applied to the H100 print.',
        latest: f2(latest(X.b200usd)), d: deltaCells(D.dates, X.b200usd, 'pct') },
      { label: 'A100 ($/GPU-hr)', tip: 'The oldest chip still widely rented.',
        latest: f2(latest(X.a100usd)), d: deltaCells(D.dates, X.a100usd, 'pct') },
      { label: 'B200 / H100 vs 2.2x parity', tip: 'Price ratio against the MLPerf training-performance ratio. At or below 2.2x means Blackwell is priced at or under the compute it delivers — the cross-generation relative-value signal.',
        latest: fx(latest(D.ratio_b200)), d: deltaCells(D.dates, D.ratio_b200, 'x') },
      { label: 'A100 / H100 vs 0.45x parity', tip: 'The legacy chip has held a persistent premium to its productivity all year.',
        latest: fx(latest(D.ratio_a100)), d: deltaCells(D.dates, D.ratio_a100, 'x') }
    ]);

    /* ----- readout above the H100 chart ----- */
    var ro = document.getElementById('c-readout');
    if (ro) {
      var rows = [
        { name: 'Silicon Data', color: PAL.h100, v: f2(latest(D.sd_h100_usd)), p: pSd,
          tip: 'Latest standardized assessed H100 rate.' },
        { name: 'Ornn settled', color: PAL.ornn, v: f2(latest(D.ornn_h100_usd)), p: pOr,
          tip: 'Latest settled H100 transaction index.' },
        { name: 'Spread', color: null, v: fpct(latest(X.spread)), p: pSpread,
          tip: 'Ornn relative to Silicon Data on the last day BOTH printed — a same-day comparison, so it will not always equal the two levels shown here when one source has printed more recently.' }
      ];
      ro.innerHTML = rows.map(function (r) {
        return '<div class="r" data-tip="' + r.tip + '"><span class="rl">' +
          (r.color ? '<i style="background:' + r.color + '"></i>' : '') +
          r.name + '</span><span class="rv">' + r.v + '</span>' +
          '<span class="rd">' + (r.p ? shortDate(r.p.date) : '') + '</span></div>';
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

  /* Prefer the exact curve collected from the Silicon Data portal; fall back
     to the digitized values shipped in gpu_prices.json if it is unavailable. */
  function effectiveForward(data, live) {
    var f = live && live.sd_forward;
    if (!f || !f.gpus || !f.gpus.h100 || !f.gpus.h100.term) {
      return { fwd: data.forward, exact: false, asOf: null };
    }
    var n = 7, out = { tenors: [] };
    for (var i = 0; i < n; i++) out.tenors.push(i === 0 ? 'Spot' : i + 'M');
    var ok = true;
    ['h100', 'b200', 'a100'].forEach(function (g) {
      var src = f.gpus[g];
      if (!src) { ok = false; return; }
      out[g] = { term: src.term.slice(0, n), fwd: src.fwd.slice(0, n) };
      if (out[g].term.some(function (v) { return v == null; })) ok = false;
    });
    return ok ? { fwd: out, exact: true, asOf: f.as_of }
              : { fwd: data.forward, exact: false, asOf: null };
  }

  /* ---------- panel takeaways ----------
     One sentence per card stating what the data says, computed live so it
     cannot drift from the numbers drawn beside it. */
  function setHTML(id, html) {
    var n = document.getElementById(id);
    if (n) n.innerHTML = html;
  }

  function takeaways(data, D, X, volH) {
    var pSpread = lastPrint(D.dates, X.spread);
    var b = function (v) { return '<b>' + v + '</b>'; };
    var money = function (v) { return '$' + v.toFixed(2); };
    var lh = latest(D.sd_h100_usd), lo = latest(D.ornn_h100_usd), sp = latest(X.spread);
    var rb = latest(D.ratio_b200), ra = latest(D.ratio_a100);
    var pb = data.spot.b200.parity_train, pa = data.spot.a100.parity_train;
    var wk = deltaCells(D.dates, D.sd_h100_usd, 'pct')[0];

    if (lh != null) {
      setHTML('c-take-levels',
        'H100 — the chip every listed contract references — marks ' + b(money(lh)) +
        ', ' + b(wk.txt) + ' on the week, at ' + b((latest(volH) || 0).toFixed(0) + '%') +
        ' annualised realized vol. <span class="muted">Everything below is priced off this line.</span>');
    }

    if (sp != null) {
      var vals = X.spread.filter(function (v) { return v != null; });
      var lowest = Math.min.apply(null, vals), highest = Math.max.apply(null, vals);
      setHTML('c-take-basis',
        'The two benchmarks disagree by ' + b((sp >= 0 ? '+' : '') + sp.toFixed(1) + '%') +
        (pSpread ? ' as of ' + shortDate(pSpread.date) : '') +
        ' — settled deals are clearing ' + (sp >= 0 ? 'above' : 'below') +
        ' the assessed rate. Over the past year that gap has run from ' +
        b(lowest.toFixed(0) + '%') + ' to ' + b('+' + highest.toFixed(0) + '%') +
        '. <span class="muted">Mark against one and hedge in the other, and this is the risk you keep.</span>');
    }

    if (rb != null && ra != null) {
      var offB = (rb / pb - 1) * 100, offA = (ra / pa - 1) * 100;
      setHTML('c-take-rv',
        'B200 trades at ' + b(rb.toFixed(2) + 'x') + ' an H100 against a ' + b(pb + 'x') +
        ' performance ratio — ' + b(Math.abs(offB).toFixed(0) + '% ' + (offB < 0 ? 'under' : 'over')) +
        ' parity. A100 sits ' + b(Math.abs(offA).toFixed(0) + '% ' + (offA > 0 ? 'above' : 'below')) +
        ' its ' + pa + 'x line. <span class="muted">Below the dashed line is compute bought under what it delivers.</span>');
    }

    var effB = lh != null && rb != null ? rb * lh / pb : null;
    var effA = lh != null && ra != null ? ra * lh / pa : null;
    if (effB != null && effA != null && lh != null) {
      var cheaper = (1 - effB / effA) * 100;
      var hourly = (ra != null && rb != null) ? (rb / ra) : null;
      setHTML('c-take-eff',
        'Per unit of the same work, B200 is the cheapest at ' + b(money(effB)) + ' — ' +
        b(cheaper.toFixed(0) + '% below') + ' the A100 at ' + b(money(effA)) +
        (hourly ? ', despite costing ' + b(hourly.toFixed(1) + 'x more') + ' per hour' : '') +
        '. <span class="muted">The cheapest chip to rent is the dearest way to buy compute.</span>');
    }

    var EFT = effectiveForward(data, LIVE);
    var f = EFT.fwd;
    if (f) {
      // No-arbitrage check, computed from the shipped curve: a term rate is the
      // average price of the months it covers, so the mean of the forward path
      // must reproduce the published term rate.
      var checks = ['h100', 'b200', 'a100'].map(function (g) {
        var mean = f[g].fwd.reduce(function (a, c) { return a + c; }, 0) / f[g].fwd.length;
        return Math.abs(mean - f[g].term[6]);
      });
      var worstCheck = Math.max.apply(null, checks);
      var kmeta = LIVE && LIVE.kalshi_meta;
      var kh = LIVE && LIVE.kalshi && LIVE.kalshi.H100;
      if (kmeta && kh) {
        var koi = Object.keys(kh).reduce(function (a, m) { return a + (kh[m].open_interest || 0); }, 0);
        setHTML('c-kalshi-method',
          'How the Kalshi line is obtained: Kalshi lists binary contracts — "will the monthly average be above $X" ' +
          'at a ladder of strikes for each month. Each contract price is the market-implied probability that ' +
          'settlement exceeds its strike, so the ladder traces the survival function S(k) = P(price &gt; k). ' +
          'We take the mid of the yes bid/ask (falling back to the last trade), clamp S to non-increasing ' +
          '(quote noise can violate it), and read the <b>median</b> as the strike where S crosses 0.50, ' +
          'interpolating between the bracketing strikes: <em>m* = k₁ + (S(k₁) − 0.5)·(k₂ − k₁) ⁄ (S(k₁) − S(k₂))</em>. ' +
          'The median rather than the mean because the ladder is bounded — the tails beyond the end strikes are ' +
          'unobserved, so a mean would require assuming a tail shape. ' +
          '<b>Basis warning:</b> these contracts settle on the <b>Ornn</b> index, not Silicon Data. ' +
          'Their dollar level therefore is not comparable to the Silicon Data curve — on A100 the basis alone ' +
          'is roughly 38% — so the Kalshi line is drawn only in the % view, where each curve is rebased to its ' +
          'own spot anchor and the comparison is like-for-like. Kalshi quotes a monthly <em>average</em>; the Silicon Data forward is a ' +
          'point-in-time expected spot. Open interest across the H100 ladder is ' + koi.toLocaleString() + ' contracts.');
      }
      setHTML('c-fwd-method',
        'How the forward line is obtained: Silicon Data publishes both curves and we now collect them ' +
        (EFT.exact
          ? '<b>exactly</b> from its public portal every day — every tenor, to four decimals' +
            (EFT.asOf ? ', as of ' + EFT.asOf : '') + ' (no chart read-off, no staleness). '
          : 'from its published charts (six-month values exact, intermediate tenors digitized). ') +
        'Silicon Data backs the forwards out of the term structure by no-arbitrage — a term rate is ' +
        'the average price of the months it covers, so locking a term must cost the same as rolling ' +
        'through the implied monthly forwards. That identity holds on the published numbers: averaging ' +
        'each curve reproduces its own six-month term rate to within <b>' +
        (worstCheck * 100).toFixed(0) + ' cents</b>. We do not derive these ourselves, and the ' +
        'month-by-month path carries read-off error of a few cents.');

      var pct6 = function (g) { return (f[g].fwd[6] / f[g].fwd[0] - 1) * 100; };
      var mags = [pct6('h100'), pct6('b200'), pct6('a100')].map(Math.abs).sort(function (a, c) { return a - c; });
      setHTML('c-take-fwd',
        'Six-month forwards sit ' + b(mags[0].toFixed(0) + '–' + mags[2].toFixed(0) + '% below') +
        ' spot, after a tightness hump two to four months out. Term rates land at roughly the average of that path. ' +
        '<span class="muted">Locking capacity today costs about what the market expects to pay anyway — the lock buys certainty and squeeze protection, not carry.</span>');
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
        '<a href="https://github.com/Kadentato/Compute-and-LLM-Dashboard/tree/main/compute/dataFiles">all data</a> · Site v0.33.2';
    }
  }

  Promise.all([
    fetch('dataFiles/gpu_prices.json').then(function (r) { return r.json(); }),
    fetch('dataFiles/gpu_live.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ])
    .then(function (loaded) {
      var data = loaded[0], live = loaded[1];
      LIVE = live;
      if (live) {
        try { mergeLive(data, live); } catch (e) { console.error('live merge: ' + e.message); }
      }
      renderAll(data);
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
          forwardChart(host, effectiveForward(data, LIVE).fwd, b.dataset.mode, LIVE);
        });
      });

      // the viewBox is sized to the container, so re-render on resize/rotate
      var rt = null, lastW = innerWidth;
      addEventListener('resize', function () {
        if (innerWidth === lastW) return;
        lastW = innerWidth;
        clearTimeout(rt);
        rt = setTimeout(function () { renderAll(data); }, 200);
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
