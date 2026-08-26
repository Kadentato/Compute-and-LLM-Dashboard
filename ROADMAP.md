# LLM Usage Share Tracker: Roadmap and Expectations

Status: design stage, 26 August 2026
Goal: a daily updating, zero maintenance dashboard on GitHub Pages that tracks the top consumer facing LLMs and the share of tokens going to open weight models versus closed frontier models.

## 1. What this will and will not tell you

Set expectations here first, because the headline number is a proxy and the page should say so in its own words.

What it measures: the share of tokens routed through two large public AI gateways (OpenRouter and Vercel AI Gateway), split into open weight versus closed, daily, with history back to January 2025 (OpenRouter) and October 2025 (Vercel). This is developer and application traffic: agents, coding tools, SaaS products, hobby projects.

What it does not measure: consumer chat usage. ChatGPT, Gemini, Claude.ai, and Grok consumer traffic never touches a gateway, and no lab publishes model level token counts. There is no public source for "share of all tokens in the world," and the tracker will not pretend to have one.

Why the two gateways disagree: OpenRouter skews toward cost sensitive and hobbyist traffic (open weight share in the range of 55 to 65 percent in mid 2026), Vercel skews toward production apps paying for frontier models (open weight share around 29 percent in July 2026). The spread between them is a finding in itself. The dashboard shows both series and the spread rather than blending them into a single fake number.

Consumer side: the closest fully automatic consumer signal is Cloudflare Radar's ranking of generative AI services by DNS traffic on 1.1.1.1. It gives daily rank order of ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek and others, but rank only, not volume or share. Similarweb has better consumer numbers but no free API and is dropped to honour the no manual entry constraint.

Classification is a judgment call: "open weight" means weights downloadable under any licence (Llama, Qwen, DeepSeek, Mistral open models, Kimi, GLM, gpt-oss, Gemma). Mistral's proprietary API models and similar mixed lab cases are tagged per model, not per lab. The mapping table is versioned in the repo so any reclassification is visible in history.

## 2. Data sources

| Source | What it gives | Access | Cadence | History | Role |
| --- | --- | --- | --- | --- | --- |
| Vercel AI Gateway leaderboard export | Daily percent share per model and per lab, for tokens, requests, spend | Open JSON endpoint, no key, CC BY 4.0 | Daily, cached 24h | 2025-10-01 | Primary series A for open vs closed share; spend share is a bonus (volume vs money) |
| OpenRouter rankings-daily dataset | Daily total tokens for top 50 models plus "other"; filters by category, context bucket, modality | Free API key, 500 req/day | Daily | 2025-01-01 | Primary series B; only source with absolute token counts and the longest history |
| Cloudflare Radar internet services ranking | Daily rank of generative AI services by DNS popularity | Free Cloudflare API token | Daily | 2024 onward | Consumer facing panel (rank order only) |
| Hugging Face Hub API | Downloads and likes per model | No key needed | Daily snapshot | Point in time (tracker builds its own history) | Ranking within the open weight camp |
| LMArena leaderboard | Elo style preference scores | Scrape or HF dataset mirror; brittle | Whenever it changes | Point in time | Optional quality context panel; lowest priority |

Nothing else publishes usage. Poe, Portkey, LiteLLM and the labs themselves do not.

## 3. Architecture

One repository, three parts.

Collector: a small script (Python, runs in GitHub Actions) that calls each source, saves the raw response verbatim under `data/raw/<source>/<date>.json`, then writes normalised, chart ready files under `data/derived/`. Raw retention matters: if a source changes terms or disappears, the history already lives in the repo.

Scheduler: a GitHub Actions workflow on a daily cron (06:00 UTC, after both gateways finalise the previous day) that runs the collector, commits any changed data, and triggers the Pages deploy. GitHub cron can drift by up to an hour or skip under load, so the collector is idempotent and also backfills any missing days it finds.

Frontend: a static site deployed to GitHub Pages that reads the derived JSON at load time. No backend, no database. Vite + React + shadcn + Recharts (consistent with the compute tracker) is the default; a plain HTML and JS page is the fallback if the build step feels like overkill for phase 1.

Secrets: OpenRouter key and Cloudflare token stored as repository secrets. Vercel and Hugging Face need none.

Cost: zero. Public repo Actions minutes are free and the job runs under a minute.

## 4. Phases

### Phase 0: Verify the sources (half a day)

Pull one day from each endpoint by hand, confirm the schemas match the docs, confirm the Cloudflare Radar endpoint returns the generative AI category, and check whether LMArena is fetchable without a browser. Output: a one page source notes file with a sample response per source. Anything that fails verification is cut, not worked around.

### Phase 1: Headline metric end to end (2 to 3 days)

Vercel and OpenRouter collectors, the model classification table, the daily workflow, and a single page with one chart: open weight share over time, two lines plus spread, with the caveat text beside it. Backfill full history from both sources. Exit criterion: the site updates itself three days in a row with no intervention.

### Phase 2: Model and lab panels (2 to 3 days)

Top models by token share (each gateway), top labs, closed frontier breakdown (OpenAI vs Anthropic vs Google vs xAI), open weight breakdown (DeepSeek vs Qwen vs Llama vs Mistral vs Kimi vs others), and Vercel spend share next to token share so the volume versus money picture is visible. An "unmapped models" box on the page that lists anything not yet in the classification table, so the table maintains itself by exception.

### Phase 3: Consumer panel (1 to 2 days)

Cloudflare Radar daily service rankings as a bump chart, and Hugging Face download rankings for open weight models. Both labelled with what they measure.

### Phase 4: Polish and hardening (ongoing, small)

Alerting when a collector fails (Actions failure notification is enough), a data freshness stamp on the page, CSV download of the derived data, and a short methodology page. LMArena only if phase 0 showed it can be fetched reliably.

Total to a complete v1: roughly two working weeks of part time effort, with the useful headline chart live after phase 1.

## 5. Decisions needed before phase 1

1. Frontend: Vite + React + shadcn (default) or plain HTML and JS.
2. Classification edge cases: whether gpt-oss counts as open weight for OpenAI (proposed: yes, tagged per model), and whether Mistral's closed API models are closed (proposed: yes).
3. Which single number is the page headline: Vercel share, OpenRouter share, or the midpoint with the spread shown. Proposed: show both, no midpoint, headline text reads "X percent to Y percent of gateway tokens go to open weight models."
4. Repo name and whether it lives under a personal account or an org.

## 6. Risks

Source changes: either gateway can change or paywall its endpoint. Mitigation is raw retention in the repo and a collector that fails loudly rather than silently writing empty days.

Proxy misread: readers may quote the number as the market share of open models. Mitigation is caveat text placed next to the chart, not in a footnote, and no blended headline.

Classification drift: new models weekly. Mitigation is the unmapped box on the page plus the versioned table.

GitHub cron unreliability: mitigated by backfill logic; a missed day is filled the next morning.

Top 50 truncation on OpenRouter: the "other" bucket cannot be classified. It is shown as a third category rather than allocated.
