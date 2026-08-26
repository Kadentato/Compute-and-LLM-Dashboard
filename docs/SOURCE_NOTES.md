# Phase 0: Source Verification Notes

Verified 26 August 2026. One sample response per source under `raw/`. Verdicts against the roadmap's five sources: all 5 verified, none cut, 0 cut.

## 1. Vercel AI Gateway leaderboard export — VERIFIED

- Endpoint: `GET https://vercel.com/api/ai/leaderboard-export`
- Params: `dataset` (`models`|`labs`|`apps`|`providers`), `modality` (`all`|`text`|`image`|`video`), `format` (`json`|`csv`), `from`/`to` (`YYYY-MM-DD`)
- No key. CC BY 4.0 (license echoed in every response). Cached 24h.
- Schema (models/labs): rows of `{date, group, name, metric, modality, share_percent}`; metrics are `requests`, `tokens`, `spend` (plus `imageCount`/`videoCount` for those modalities).
- Default window is a rolling 2 months. **Backfill confirmed**: `from=2025-10-01` works and responses echo `earliest_available_date: 2025-10-01` — matches the roadmap.
- Note: share_percent only, no absolute volumes (as expected). An "Other" row exists per day, top ~19 named models in the current window.
- Samples: `raw/vercel-sample.json` (rolling window), `raw/vercel-historic-sample.json` (Oct 2025), `raw/vercel-labs-sample.json` (labs).

## 2. OpenRouter rankings-daily — VERIFIED

- Endpoint: `GET https://openrouter.ai/api/v1/datasets/rankings-daily` with `Authorization: Bearer <key>`
- Schema: `{data: [{date, model_permaslug, total_tokens}]}` — `total_tokens` is a **string** (values exceed int32; parse as int64). 51 rows per day: top 50 models + `other`, with `other` always last within its date, as documented.
- Params confirmed: `start_date`/`end_date` (YYYY-MM-DD, UTC), `period` (`day`|`week`|`month`), plus exact filters (`modality`, `context_bucket`) and sampled filters (`category`, `language_type`) which are mutually exclusive.
- Default window: rolling 30 days. **Backfill confirmed**: `start_date=2025-01-01` returns data (earlier values clamp to that floor) — matches the roadmap.
- Limits: 30 req/min, 500 req/day. Key stored as repo secret `OPENROUTER_API_KEY`.
- Samples: `raw/openrouter-sample.json` (rolling 30d), `raw/openrouter-historic-sample.json` (Jan 2025).
## 3. Cloudflare Radar internet services ranking — VERIFIED

- Endpoint: `GET https://api.cloudflare.com/client/v4/radar/ranking/internet_services/top?serviceCategory=Generative%20AI&limit=N` with `Authorization: Bearer <token>` (token permission: Account → Radar → Read).
- Schema: `{result: {top_0: [{rank, service}], meta: {dateRange, ...}}}` — rank order only, no volumes, as expected.
- Category confirmed: returns ChatGPT / OpenAI, Claude / Anthropic, Perplexity, Google Gemini, DeepSeek, Grok / xAI, plus tools (Copilot, Cursor, ElevenLabs...) — the tracker should filter to chat assistants for the consumer panel.
- **Backfill confirmed**: `date=YYYY-MM-DD` works (tested 2025-01-15; a day resolves to the preceding 24h window). Service names can change over time (e.g. "Codeium / Windsurf AI" → "Windsurf AI"), so the collector needs a small alias map.
- Token stored as repo secret `CLOUDFLARE_API_TOKEN`.
- Samples: `raw/cloudflare-sample.json` (current), `raw/cloudflare-historic-sample.json` (Jan 2025).
## 4. Hugging Face Hub API — VERIFIED

- Endpoint: `GET https://huggingface.co/api/models?sort=downloads&direction=-1&limit=N&filter=text-generation`
- No key. Returns `{id, downloads, likes, tags, createdAt, pipeline_tag, ...}` per model.
- Point-in-time only, as the roadmap says — the tracker snapshots daily to build history.
- Caveat seen in the sample: raw download sort surfaces tiny models (e.g. Qwen3-0.6B at #1) and test repos; the collector should filter/curate (e.g. by param-class or an allowlist from the classification table).
- Sample: `raw/hf-sample.json`.

## 5. LMArena — VERIFIED (better than expected: no scraping)

- The lmarena.ai site is a JS app and its `/api/leaderboard` redirects to a 403 — scraping is indeed brittle. But LMArena publishes an **official HF dataset mirror**: `lmarena-ai/leaderboard-dataset`, parquet, updated daily (last modified 2026-08-26 03:01 UTC).
- Fetchable as plain JSON, no key, via the dataset-viewer API:
  `GET https://datasets-server.huggingface.co/rows?dataset=lmarena-ai%2Fleaderboard-dataset&config=text&split=latest&offset=0&length=100`
- Schema: `{model_name, organization, license, rating, rating_lower, rating_upper, variance, vote_count, rank, ...}`. Configs exist per arena (text, text_to_image, agent, ...), each with `latest` and `full` (historical) splits.
- Verdict: promote from "lowest priority, if fetchable" to safely includable in phase 4.
- Samples: `raw/lmarena-hf-dataset-meta.json`, `raw/lmarena-rows-sample.json`.

## Environment note

No Python or Node on this PC — local verification used curl + PowerShell. The collector targets GitHub Actions (ubuntu-latest has Python), so this doesn't affect the architecture; it only means local collector test runs need Actions or a Python install.
