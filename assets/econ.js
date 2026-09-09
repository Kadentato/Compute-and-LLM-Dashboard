/* Ownership economics for one rented H100 — a single copy of the model.

   Read by the compute analysis page (compute/scripts/charts.js: the breakeven ladder
   and sensitivity table) and by the landing page's brief (index.html, rule 4). It
   used to be written out in both; a number changed in one place would have left the
   brief quietly disagreeing with the panel it links to. */
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

  root.Econ = { ECON: ECON, crf: crf, breakeven: breakeven, utilNeeded: utilNeeded };
})(window);
