# Compute & LLM Dashboard

Two daily-updating, zero-maintenance dashboards on the AI compute economy, published as a
static site on GitHub Pages: **[kadentato.github.io/Compute-and-LLM-Dashboard](https://kadentato.github.io/Compute-and-LLM-Dashboard/)**

| | What it tracks | Pages |
|---|---|---|
| **Compute price tracker** | What a data-center GPU-hour costs — the benchmark rates the announced futures contracts reference, the basis between them, where they sit inside the physical market, price against delivered compute, and the published forward curve. | [dashboard](https://kadentato.github.io/Compute-and-LLM-Dashboard/compute/prices.html) · [full analysis](https://kadentato.github.io/Compute-and-LLM-Dashboard/compute/prices-full.html) |
| **LLM usage share tracker** | The daily share of tokens going to open-weight versus closed-frontier models across public AI gateways. | [dashboard](https://kadentato.github.io/Compute-and-LLM-Dashboard/) · [full analysis](https://kadentato.github.io/Compute-and-LLM-Dashboard/full.html) |

Methodology for both — sources, data grading, constants and limitations — is on the
[methodology page](https://kadentato.github.io/Compute-and-LLM-Dashboard/methodology.html).

## Data grading

Sources are not of equal quality, so every panel on the compute dashboard states which kind
it is rather than presenting them all alike:

- **Settlement-grade** — standardized daily benchmarks published as financial products, each
  with a Bloomberg ticker; the series the announced contracts name. Use for marks and basis.
- **Indicative** — public rate cards and marketplace listings with heterogeneous contract
  terms. Use for range and direction, never as a price.
- **Derived / part-digitized** — computed from a fixed benchmark constant, or read off a
  published chart. Carries the stated model or read-off error.

## How it works

Two independent collectors, both standard-library Python, both storing raw responses verbatim
under `data/raw/<source>/<date>.json` before any processing, and both committing only when new
data actually arrived:

- `collector/collect_gpu.py` → GPU prices. Sources: the Silicon Data indices page (daily index
  prints), the Ornn public index API (settled OCPI values, rolling 3-month window), and the
  gpus.io public catalogue (~26 neo-cloud providers' listings, used for price dispersion). No
  API keys. Runs via `.github/workflows/collect-gpu.yml`; derives `compute/dataFiles/gpu_live.json`.
- `collector/collect.py` → LLM token share. Five sources (Vercel AI Gateway, OpenRouter,
  Cloudflare Radar, Hugging Face, LMArena); two need API keys held as repo secrets. Runs via
  `.github/workflows/collect.yml`; derives `data/derived/*.json`.

Both fail loudly: a broken source doesn't stop the others, but the run exits non-zero so the
failure is visible rather than silent. `tests/` covers the LLM collector's classification and
backfill logic and runs on push.

The frontend is vanilla HTML/CSS/JS with no build step — `assets/engine.js` renders the LLM
charts, `compute/scripts/charts.js` the compute ones. Pages deploys straight from `main`.

## Caveats worth reading first

- The compute daily series are a Bloomberg export through 25 Aug 2026, extended from 26 Aug by
  the public feeds. Silicon Data and gpus.io publish no history, so those two accrue only from
  first collection; Ornn backfills itself.
- No GPU futures contract had final regulatory approval at the data date. The indices are the
  *designated* settlement references for the announced CME and ICE contracts, not live ones.
- Performance constants used to convert price into price-per-unit-of-work are point estimates
  from dated MLPerf rounds; the A100 ratio is frozen at 2023 vintage.
- The LLM headline is a proxy for *gateway* traffic, not the market share of open models
  overall — consumer chat never touches a gateway. See [ROADMAP.md](ROADMAP.md).
