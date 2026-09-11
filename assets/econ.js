/* Ownership economics for one rented H100 — a single copy of the model.

   Read by the compute analysis page (compute/scripts/charts.js: the breakeven ladder
   and sensitivity table) and by the landing page (index.html: brief rule 4 and the
   standing view). It used to be written out in both; a number changed in one place
   would have left the brief quietly disagreeing with the panel it links to. */
(function (root) {
  'use strict';

  var ECON = {
    capex: 40000,   // $/GPU all-in: 8-GPU HGX at $250-320k is ~$31-40k/GPU, plus fabric and fit-out
    life: 5,        // years
    util: 0.85,     // share of hours sold. The one input with no public source — see utilNeeded()
    kw: 1.75,       // facility-level draw per GPU (700W TDP -> ~1.4kW system, x1.25 PUE)
    elec: 0.08,     // $/kWh
    opex: 1500      // $/GPU-year: staff, bandwidth, licensing, space
  };

  /* The adverse vintage the site compares against: dearer kit bought a year earlier,
     shorter life, softer utilisation, costlier power, high-yield money. Same chip,
     same rental rate, and the thesis is that this fleet and the one above get
     opposite outcomes. One copy, for the same reason as ECON. */
  var ADVERSE = { capex: 50000, life: 4, util: 0.70, kw: 1.75, elec: 0.12, opex: 2500 };

  /* Capital recovery factor: the level annual payment that repays 1 over `life` years at r. */
  function crf(r, life) {
    return r === 0 ? 1 / life : r * Math.pow(1 + r, life) / (Math.pow(1 + r, life) - 1);
  }

  /* $ per SOLD GPU-hour needed to cover capital, opex and power at hurdle r. */
  function breakeven(a, r) {
    return (a.capex * crf(r, a.life) + a.opex) / (8760 * a.util) + a.kw * a.elec;
  }

  /* breakeven() run backwards: the share of hours a fleet must sell to clear hurdle r
     at price p. Utilisation is the one input nobody outside an operator can verify, so
     rather than assume it this makes it the output — the reader tests the number
     against what they believe instead of against what we guessed. Can exceed 1, which
     is the honest reading: more than every hour. */
  function utilNeeded(a, r, p) {
    return (a.capex * crf(r, a.life) + a.opex) / (8760 * (p - a.kw * a.elec));
  }

  /* Per-generation inputs for the cost to deliver an H100-equivalent hour. H100 is the
     central case above. B200 and A100 are stated assumptions of reported grade -- vendor,
     press and marketplace figures, not purchase orders -- and each carries its source and
     the size of its doubt, because a wrong one here is exactly the objection the desk
     raised about comparing generations. The sensitivity figures in the notes are computed
     from breakeven(), not guessed. Utilisation, power price and opex are held at the
     central case for all three so the comparison isolates capex, power draw and life. */
  var CHIPS = {
    h100: { label: 'H100', capex: ECON.capex, life: ECON.life, util: ECON.util, kw: ECON.kw, elec: ECON.elec, opex: ECON.opex,
      src: 'The central case the ladder above uses.',
      capexSrc: '8-GPU HGX H100 systems at $250-320k in 2025-26, about $31-40k a GPU, plus fabric and fit-out. An estimate of a current purchase, not a quote.',
      kwSrc: '700 W TDP; about 1.4 kW as a system with host, memory and fabric; x1.25 PUE at the facility.',
      lifeSrc: 'Five years, the depreciation schedule most operators file.' },
    b200: { label: 'B200', capex: 60000, life: 5, util: ECON.util, kw: 2.2, elec: ECON.elec, opex: ECON.opex,
      src: 'Stated assumptions, reported grade. Every figure on this row can be wrong; hover each for its source and what a miss would do.',
      capexSrc: 'Estimate: 8-GPU HGX B200 systems quoted around $400-500k in 2026, about $50-60k a GPU, plus fabric and fit-out. Vendor and press figures, not a purchase order. Each $10k of error moves the cost to deliver by about $0.17 an hour.',
      kwSrc: 'Estimate: about 1000 W TDP, roughly 1.8 kW as a system, x1.25 PUE. The system figure is the least certain. Power is the small lever: doubling it moves the cost to deliver by about $0.08 an hour.',
      lifeSrc: 'Five years, as for H100: a new part on a standard schedule.' },
    a100: { label: 'A100', capex: 15000, life: 3, util: ECON.util, kw: 1.0, elec: ECON.elec, opex: ECON.opex,
      src: 'Stated assumptions, reported grade. A100s are rarely bought new in 2026, so this is a secondary-market fleet, and the residual value is the least certain input on the page.',
      capexSrc: 'Estimate: secondary-market A100 SXM around $10-15k a GPU in 2026; a fleet bought new in 2022 paid roughly $15-20k and has largely depreciated it. Marketplace listings, not audited prices. Each $5k of error moves the cost to deliver by about $0.62 an hour, because the parity divisor is small.',
      kwSrc: 'Estimate: 400 W TDP, about 0.8 kW as a system, x1.25 PUE.',
      lifeSrc: 'Estimate: three years remaining on a part already about four years old. A shorter life raises the annual capital charge; at five years the cost to deliver falls by about $0.62 an hour.' }
  };

  root.Econ = { ECON: ECON, ADVERSE: ADVERSE, CHIPS: CHIPS, crf: crf, breakeven: breakeven, utilNeeded: utilNeeded };
})(window);
