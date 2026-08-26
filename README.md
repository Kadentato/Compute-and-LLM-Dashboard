# LLM Usage Share Tracker

A daily-updating, zero-maintenance dashboard tracking the share of tokens going
to open-weight models versus closed frontier models across two public AI
gateways (OpenRouter and Vercel AI Gateway). See [ROADMAP.md](ROADMAP.md) for
scope and caveats — the headline number is a proxy for gateway traffic, not the
market share of open models overall.

## How it works

- `collector/collect.py` (stdlib-only Python) fetches each source, stores raw
  per-day responses under `data/raw/<source>/<date>.json`, and derives
  chart-ready files under `data/derived/`. Idempotent; backfills missing days.
- `.github/workflows/collect.yml` runs it daily at 06:00 UTC and commits changes.
- `index.html` is a static page (GitHub Pages) reading the derived JSON.
- `data/model_classification.json` is the versioned open/closed mapping table.

## Setup (one-time)

1. Create a GitHub repo (any name — nothing depends on it) and push.
2. Add repository secret `OPENROUTER_API_KEY` (Settings → Secrets → Actions).
3. Enable Pages: Settings → Pages → Deploy from branch → `main` / root.

Local run: `OPENROUTER_API_KEY=... python collector/collect.py`

## Data licenses

Vercel AI Gateway leaderboard data is CC BY 4.0 (© Vercel). OpenRouter data is
fetched via their public datasets API.
