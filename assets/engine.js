/* Shared chart engine + UI helpers for the LLM Usage Share Tracker.
   Used by index.html and dashboard.html — one renderer, every page. */
window.Tracker = (function () {
  const COLORS = ["var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)",
    "var(--c5)", "var(--c6)", "var(--c7)", "var(--c8)"];
  const fmtDay = d => new Date(d).toLocaleDateString("en-US",
    { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
  const fmtPT = t => new Date(t).toLocaleString("en-US",
    { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
  const fmtMo = d => new Date(d).toLocaleDateString("en",
    { timeZone: "UTC", month: "short", year: "2-digit" });
  const pretty = n => (n.includes("/") ? n.split("/")[1] : n).replace(/-\d{8}$/, "");
  const fmtNum = n => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "K" : n;
  const key = si => `<i class="key" style="border-color:${COLORS[si]};display:inline-block;width:12px"></i>`;
  const RANGES = [["1M", 30], ["3M", 90], ["6M", 180], ["1Y", 365], ["All", null]];

  let tip = null;
  const hideTip = () => { tip.style.display = "none"; tip.style.whiteSpace = "nowrap"; };
  const showTipFor = t => {
    tip.style.display = "block";
    tip.style.maxWidth = "290px";
    tip.style.whiteSpace = "normal";
    const r = t.getBoundingClientRect();
    tip.style.left = Math.min(r.left, innerWidth - 310) + "px";
    tip.style.top = (r.bottom + 8) + "px";
    tip.textContent = t.dataset.tip;
  };

  function init(tipEl) {
    tip = tipEl;
    document.addEventListener("mouseover", ev => {
      const t = ev.target.closest("[data-tip]");
      if (t) showTipFor(t);
    });
    document.addEventListener("mouseout", ev => {
      if (ev.target.closest("[data-tip]")) hideTip();
    });
    document.addEventListener("focusin", ev => {
      const t = ev.target.closest("[data-tip]");
      if (t) showTipFor(t);
    });
    document.addEventListener("focusout", ev => {
      if (ev.target.closest("[data-tip]")) hideTip();
    });
    document.addEventListener("click", ev => {
      const t = ev.target.closest("[data-tip]");
      if (!t) return;
      if (tip.style.display === "block" && tip.textContent === t.dataset.tip) hideTip();
      else showTipFor(t);
    });
  }

  // Make every [data-tip] reachable by keyboard and screen readers.
  function finishTips() {
    document.querySelectorAll("[data-tip]").forEach(t => {
      t.tabIndex = 0;
      t.setAttribute("role", "note");
      t.setAttribute("aria-label", t.dataset.tip);
    });
  }

  // cfg: { svg, type: "line"|"stack"|"bump", dates, series: [{name, color?, tip?, values}],
  //   w, h, rightPad, yMax ("auto" | number), band: [i,j]|null, gradient, endLabel:
  //   "chip"|"name"|null, tabs: element|true|false, legend: element|null,
  //   legendMode: "line"|"swatch", tooltip: fn(i)->html|null, onHover }
  function chart(cfg) {
    const svg = cfg.svg;
    if (!svg || !cfg.dates?.length) return;
    const W = cfg.w || 700, H = cfg.h || 300;
    const M = { t: 14, r: cfg.rightPad || 16, b: 26, l: 40 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const color = si => cfg.series[si].color || COLORS[si];
    let dates = cfg.dates, offset = 0, x, y, ymax;

    function render(rangeDays) {
      offset = 0; dates = cfg.dates;
      if (rangeDays) {
        const cutoff = Date.parse(cfg.dates[cfg.dates.length - 1]) - rangeDays * 864e5;
        offset = Math.max(0, cfg.dates.findIndex(d => Date.parse(d) >= cutoff));
        dates = cfg.dates.slice(offset);
      }
      const val = (s2, i) => s2.values[offset + i];
      const t0 = Date.parse(dates[0]), t1 = Date.parse(dates[dates.length - 1]);
      x = d => M.l + iw * (Date.parse(d) - t0) / ((t1 - t0) || 1);
      const xi = i => x(dates[i]);

      if (cfg.type === "bump") {
        ymax = Math.min(12, Math.max(...cfg.series.flatMap(s2 => s2.values.filter(v => v != null))));
        y = r => M.t + ih * (r - 1) / (ymax - 1);
      } else if (cfg.yMax === "auto") {
        const mx = Math.max(...cfg.series.flatMap(s2 =>
          dates.map((d, i) => val(s2, i)).filter(v => v != null)), 1);
        ymax = Math.min(100, Math.ceil(mx / 10) * 10);
        y = v => M.t + ih * (1 - v / ymax);
      } else {
        ymax = cfg.yMax || 100;
        y = v => M.t + ih * (1 - v / ymax);
      }

      let el = "";
      if (cfg.gradient) el += "<defs>" + cfg.series.map((s2, si) =>
        `<linearGradient id="g-${svg.id}-${si}" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" style="stop-color:${color(si)};stop-opacity:0.16"/>` +
        `<stop offset="1" style="stop-color:${color(si)};stop-opacity:0"/></linearGradient>`).join("") + "</defs>";

      if (cfg.type === "bump") {
        for (let r = 1; r <= ymax; r++) {
          el += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(r)}" y2="${y(r)}" stroke="var(--grid)" stroke-width="1"/>`;
          el += `<text x="${M.l - 7}" y="${y(r) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">#${r}</text>`;
        }
      } else {
        const yl = cfg.yFmt || (v => Math.round(v) + "%");
        for (let k = 0; k <= 4; k++) {
          const v = ymax * k / 4;
          el += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>`;
          el += `<text x="${M.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" style="font-variant-numeric:tabular-nums">${yl(v)}</text>`;
        }
      }
      const spanDays = (t1 - t0) / 864e5;
      const step = spanDays > 500 ? 3 : spanDays > 200 ? 2 : 1;
      let prevMo = "";
      dates.forEach((d, i) => {
        const mo = d.slice(0, 7);
        const firstSeen = mo !== prevMo; prevMo = mo;
        const isFirst = cfg.type === "bump" ? firstSeen : d.slice(8) === "01";
        if (isFirst && (d.slice(5, 7) - 1) % step === 0)
          el += `<text x="${xi(i)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${fmtMo(d)}</text>`;
      });
      if (cfg.type !== "bump")
        el += `<line x1="${M.l}" x2="${W - M.r}" y1="${y(0)}" y2="${y(0)}" stroke="var(--baseline)" stroke-width="1"/>`;

      if (cfg.type === "stack") {
        const cum = dates.map((d, i) => {
          let acc = 0;
          return cfg.series.map(s2 => (acc += val(s2, i) || 0));
        });
        cfg.series.forEach((s2, si) => {
          const up = dates.map((d, i) => `${xi(i).toFixed(1)},${y(cum[i][si]).toFixed(1)}`).join(" ");
          const dn = dates.map((d, i) => `${xi(i).toFixed(1)},${y(si ? cum[i][si - 1] : 0).toFixed(1)}`).reverse().join(" ");
          el += `<polygon points="${up} ${dn}" fill="${color(si)}" opacity="0.82"/>`;
          if (si < cfg.series.length - 1)
            el += `<polyline points="${up}" fill="none" stroke="var(--surface)" stroke-width="2"/>`;
        });
      } else {
        const endLabels = [];
        if (cfg.band) {
          const [a, b] = cfg.band;
          const both = dates.map((d, i) => ({ d, va: val(cfg.series[a], i), vb: val(cfg.series[b], i) }))
            .filter(o => o.va != null && o.vb != null);
          if (both.length > 1)
            el += `<polygon points="${both.map(o => `${x(o.d)},${y(o.va)}`).join(" ")} ${[...both].reverse().map(o => `${x(o.d)},${y(o.vb)}`).join(" ")}" fill="${color(a)}" opacity="0.10"/>`;
        }
        cfg.series.forEach((s2, si) => {
          let dd = "", pen = false, lastI = -1, lastV = null;
          dates.forEach((d, i) => {
            const v = val(s2, i);
            if (v == null || (cfg.type === "bump" && v > ymax)) { pen = false; return; }
            dd += `${pen ? "L" : "M"}${xi(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
            lastI = i; lastV = v;
          });
          if (lastI < 0) return;
          if (cfg.gradient && cfg.type === "line") {
            const firstI = dates.findIndex((d, i) => val(s2, i) != null);
            el += `<path d="${dd}L${xi(lastI).toFixed(1)},${y(0)}L${xi(firstI).toFixed(1)},${y(0)}Z" fill="url(#g-${svg.id}-${si})" stroke="none"/>`;
          }
          el += `<path d="${dd}" fill="none" stroke="${color(si)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
          el += `<circle cx="${xi(lastI)}" cy="${y(lastV)}" r="4" fill="${color(si)}" stroke="var(--surface)" stroke-width="2"/>`;
          if (cfg.endLabel)
            endLabels.push({ kind: cfg.endLabel, oy: y(lastV), y: y(lastV),
                             c: color(si), txt: cfg.endLabel === "chip" ? lastV.toFixed(1) + "%" : s2.name });
        });
        // spread colliding end labels apart; leader lines mark any that moved
        endLabels.sort((p, q) => p.y - q.y);
        const lGap = cfg.endLabel === "chip" ? 20 : 13;
        for (let k = 1; k < endLabels.length; k++)
          if (endLabels[k].y - endLabels[k - 1].y < lGap) endLabels[k].y = endLabels[k - 1].y + lGap;
        const yFloor = M.t + ih - 2;
        for (let k = endLabels.length - 1; k >= 0; k--) {
          const cap = k === endLabels.length - 1 ? yFloor : endLabels[k + 1].y - lGap;
          if (endLabels[k].y > cap) endLabels[k].y = cap;
        }
        endLabels.forEach(L => {
          if (Math.abs(L.y - L.oy) > 3)
            el += `<line x1="${W - M.r + 1}" y1="${L.oy}" x2="${W - M.r + 8}" y2="${L.y}" stroke="var(--baseline)" stroke-width="1"/>`;
          if (L.kind === "chip")
            el += `<rect x="${W - M.r + 6}" y="${L.y - 9}" width="48" height="18" rx="9" fill="${L.c}"/>` +
              `<text x="${W - M.r + 30}" y="${L.y + 4}" text-anchor="middle" font-size="11" font-weight="650" fill="#fff" style="font-variant-numeric:tabular-nums">${L.txt}</text>`;
          else
            el += `<text x="${W - M.r + 10}" y="${L.y + 4}" font-size="11" font-weight="600" fill="var(--ink-2)">${L.txt}</text>`;
        });
      }
      (cfg.annotations || []).forEach(an => {
        const at = Date.parse(an.date);
        if (at < t0 || at > t1) return;
        const ax = x(an.date), ay = y(an.yv);
        el += `<circle cx="${ax}" cy="${ay}" r="3" fill="var(--muted)"/>` +
          `<text x="${ax}" y="${ay - 9}" text-anchor="middle" font-size="10" font-style="italic" fill="var(--muted)" ` +
          `data-tip="${an.tip}" tabindex="0" role="note" aria-label="${an.tip}">${an.label}</text>`;
      });
      el += `<line class="xh" y1="${M.t}" y2="${M.t + ih}" stroke="var(--baseline)" stroke-width="1" visibility="hidden"/>`;
      svg.innerHTML = el;
      if (cfg.onHover) cfg.onHover(offset + dates.length - 1);
    }

    const legendSeries = cfg.type === "stack"
      ? cfg.series.map((s2, si) => [s2, si]).reverse()
      : cfg.series.map((s2, si) => [s2, si]);
    if (cfg.legend) cfg.legend.innerHTML = legendSeries.map(([s2, si]) => {
      const tipAttr = s2.tip ? ` data-tip="${s2.tip}"` : "";
      const swatch = cfg.legendMode === "swatch"
        ? `<i class="key swatch" style="background:${color(si)}"></i>`
        : `<i class="key" style="border-color:${color(si)}"></i>`;
      return `<span${tipAttr}>${swatch}${pretty(s2.name)}</span>`;
    }).join("");

    let tabsEl = cfg.tabs === true ? null : cfg.tabs;
    if (cfg.tabs === true) {
      tabsEl = document.createElement("div");
      tabsEl.className = "ranges";
      svg.parentNode.insertBefore(tabsEl, svg);
    }
    if (tabsEl) {
      const lastT = Date.parse(cfg.dates[cfg.dates.length - 1]);
      const totalSpan = (lastT - Date.parse(cfg.dates[0])) / 864e5;
      const usable = RANGES.filter(([, d]) => {
        if (d == null) return true;
        if (d >= totalSpan * 0.95) return false;
        const cutoff = lastT - d * 864e5;
        return cfg.dates.filter(dd => Date.parse(dd) >= cutoff).length >= 10;
      });
      tabsEl.innerHTML = usable.map(([l], i) =>
        `<button type="button" data-i="${i}"${l === "All" ? ' class="on"' : ""}>${l}</button>`).join("");
      tabsEl.addEventListener("click", ev => {
        const b = ev.target.closest("button"); if (!b) return;
        tabsEl.querySelectorAll("button").forEach(q => q.classList.remove("on"));
        b.classList.add("on");
        render(usable[+b.dataset.i][1]);
      });
    }

    const defaultTooltip = i => {
      const rows = cfg.series.map((s2, si) => ({ s2, si, v: s2.values[i] })).filter(o => o.v != null);
      rows.sort(cfg.type === "bump" ? (p, q) => p.v - q.v : (p, q) => q.v - p.v);
      return `<div>${dates[i - offset] ?? cfg.dates[i]}</div>` + rows.map(o => cfg.type === "bump"
        ? `<div>#${o.v} ${key(o.si)} ${o.s2.name}</div>`
        : `<div>${key(o.si)} ${pretty(o.s2.name)} <b>${o.v.toFixed(1)}%</b></div>`).join("");
    };
    svg.addEventListener("mousemove", ev => {
      const r = svg.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, ((ev.clientX - r.left) * W / r.width - M.l) / iw));
      const i = Math.round(frac * (dates.length - 1));
      const xh = svg.querySelector(".xh");
      if (xh) { xh.setAttribute("x1", xi2(i)); xh.setAttribute("x2", xi2(i)); xh.setAttribute("visibility", "visible"); }
      tip.style.display = "block";
      tip.style.left = Math.min(ev.clientX + 14, innerWidth - 250) + "px";
      tip.style.top = (ev.clientY + 14) + "px";
      tip.innerHTML = (cfg.tooltip || defaultTooltip)(offset + i);
      if (cfg.onHover) cfg.onHover(offset + i);
    });
    svg.addEventListener("mouseleave", () => {
      tip.style.display = "none";
      const xh = svg.querySelector(".xh"); if (xh) xh.setAttribute("visibility", "hidden");
      if (cfg.onHover) cfg.onHover(offset + dates.length - 1);
    });
    const xi2 = i => x(dates[i]);
    render(null);
  }

  function addTools(card, filename, headers, rows) {
    if (!card) return;
    const host = card.querySelector(".ranges");
    const tools = document.createElement(host ? "span" : "div");
    tools.className = "cardTools";
    tools.innerHTML = `<button type="button" class="tbtn">View as table</button>` +
      `<button type="button" class="cbtn">Download CSV</button>`;
    (host || card).appendChild(tools);
    tools.querySelector(".cbtn").addEventListener("click", () => {
      const esc = v => v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
      const txt = [headers.join(","), ...rows.map(r => r.map(esc).join(","))].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([txt], { type: "text/csv" }));
      a.download = filename; a.click(); URL.revokeObjectURL(a.href);
    });
    let tbl = null;
    tools.querySelector(".tbtn").addEventListener("click", ev => {
      if (tbl) { tbl.remove(); tbl = null; ev.target.textContent = "View as table"; return; }
      tbl = document.createElement("div");
      tbl.className = "dataTable";
      tbl.innerHTML = "<table><thead><tr>" + headers.map(h => `<th>${h}</th>`).join("") +
        "</tr></thead><tbody>" + rows.map(r => "<tr>" + r.map(v =>
          `<td>${v == null ? "–" : v}</td>`).join("") + "</tr>").join("") + "</tbody></table>";
      card.appendChild(tbl); ev.target.textContent = "Hide table";
    });
  }

  // Levels & changes table. rows: [{label, tip?, latest, d: [{txt, dir}]}]
  function movers(el, rows) {
    if (!el) return;
    el.innerHTML = '<table class="mvT"><thead><tr><th>Series</th><th class="num">Latest</th>' +
      '<th class="num">7d</th><th class="num">30d</th><th class="num">90d</th></tr></thead><tbody>' +
      rows.map(r => `<tr><td${r.tip ? ` data-tip="${r.tip}"` : ""}>${r.label}</td>` +
        `<td class="num lat">${r.latest}</td>` +
        r.d.map(x => `<td class="num ${x.dir > 0 ? "up" : x.dir < 0 ? "dn" : ""}">${x.txt}</td>`).join("") +
        "</tr>").join("") + "</tbody></table>";
  }

  return { init, finishTips, chart, addTools, movers, COLORS, fmtDay, fmtPT, fmtMo, fmtNum, pretty, key };
})();
