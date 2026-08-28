#!/usr/bin/env python3
"""Collector for the LLM usage share tracker.

Fetches daily model-share data from the Vercel AI Gateway leaderboard export
and the OpenRouter rankings-daily dataset, stores raw per-day slices under
data/raw/<source>/<date>.json, and derives chart-ready files under
data/derived/.

Stdlib only. Idempotent: existing raw days are never refetched, and any
missing days between each source's floor and yesterday (UTC) are backfilled.
Fails loudly on fetch errors rather than writing empty days.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error
import datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
DERIVED = os.path.join(ROOT, "data", "derived")
CLASSIFICATION = os.path.join(ROOT, "data", "model_classification.json")

VERCEL_FLOOR = dt.date(2025, 10, 1)  # earliest_available_date per the export API
OPENROUTER_FLOOR = dt.date(2025, 1, 1)  # dataset floor per OpenRouter docs
VERCEL_CHUNK = 60
OPENROUTER_CHUNK = 90
OPENROUTER_SLEEP = 2.5  # stay well under 30 req/min
CLOUDFLARE_FLOOR = dt.date(2025, 1, 1)  # aligned with the OpenRouter series
HF_URL = ("https://huggingface.co/api/models"
          "?sort=downloads&direction=-1&limit=50&filter=text-generation")
LMARENA_URL = ("https://datasets-server.huggingface.co/rows"
               "?dataset=lmarena-ai%2Fleaderboard-dataset&config=text&split=latest"
               "&offset=0&length=100")


def http_get_json(url, headers=None, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers or {})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last = e
            if isinstance(e, urllib.error.HTTPError) and e.code in (400, 401, 403):
                break  # not transient
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"fetch failed after {retries} attempts: {url}: {last}")


def daterange(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


def existing_dates(source):
    p = os.path.join(RAW, source)
    if not os.path.isdir(p):
        return set()
    return {f[:-5] for f in os.listdir(p) if f.endswith(".json")}


def missing_ranges(source, floor, until, chunk):
    """Contiguous runs of missing dates, split into <=chunk-day ranges."""
    have = existing_dates(source)
    missing = [d for d in daterange(floor, until) if d.isoformat() not in have]
    ranges = []
    for d in missing:
        if ranges and (d - ranges[-1][1]).days == 1 and (ranges[-1][1] - ranges[-1][0]).days < chunk - 1:
            ranges[-1][1] = d
        else:
            ranges.append([d, d])
    return ranges


def write_raw(source, date_iso, payload):
    os.makedirs(os.path.join(RAW, source), exist_ok=True)
    path = os.path.join(RAW, source, f"{date_iso}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))


def collect_vercel(until):
    fetched = 0
    for a, b in missing_ranges("vercel", VERCEL_FLOOR, until, VERCEL_CHUNK):
        url = (f"https://vercel.com/api/ai/leaderboard-export"
               f"?dataset=models&modality=text&from={a}&to={b}")
        data = http_get_json(url)
        by_date = {}
        for row in data.get("rows", []):
            by_date.setdefault(row["date"], []).append(row)
        for d in daterange(a, b):
            iso = d.isoformat()
            rows = by_date.get(iso)
            if not rows:
                print(f"vercel: no rows for {iso}, skipping", file=sys.stderr)
                continue
            write_raw("vercel", iso, {
                "source": "vercel-ai-gateway-leaderboard",
                "license": data.get("license"),
                "date": iso,
                "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "rows": rows,
            })
            fetched += 1
    print(f"vercel: wrote {fetched} day(s)")


def collect_openrouter(until):
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    headers = {"Authorization": f"Bearer {key}"}
    fetched = 0
    for a, b in missing_ranges("openrouter", OPENROUTER_FLOOR, until, OPENROUTER_CHUNK):
        url = (f"https://openrouter.ai/api/v1/datasets/rankings-daily"
               f"?start_date={a}&end_date={b}")
        data = http_get_json(url, headers)
        by_date = {}
        for row in data.get("data", []):
            by_date.setdefault(row["date"], []).append(row)
        for d in daterange(a, b):
            iso = d.isoformat()
            rows = by_date.get(iso)
            if not rows:
                print(f"openrouter: no rows for {iso}, skipping", file=sys.stderr)
                continue
            write_raw("openrouter", iso, {
                "source": "openrouter-rankings-daily",
                "date": iso,
                "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "rows": rows,
            })
            fetched += 1
        time.sleep(OPENROUTER_SLEEP)
    print(f"openrouter: wrote {fetched} day(s)")


def collect_huggingface():
    """Point-in-time snapshot of top text-generation models by downloads.

    No backfill possible — the tracker builds its own history, one day at a time.
    Snapshots are dated by fetch day (UTC)."""
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    if today in existing_dates("huggingface"):
        print("huggingface: today's snapshot already exists")
        return
    rows = http_get_json(HF_URL)
    write_raw("huggingface", today, {
        "source": "huggingface-models-by-downloads",
        "date": today,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "rows": rows,
    })
    print("huggingface: wrote 1 snapshot")


def collect_cloudflare(until):
    """Daily Cloudflare Radar ranking of generative AI services (rank only).

    One request per missing day; `date=` resolves to the preceding 24h window."""
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        raise RuntimeError("CLOUDFLARE_API_TOKEN is not set")
    headers = {"Authorization": f"Bearer {token}"}
    have = existing_dates("cloudflare")
    missing = [d for d in daterange(CLOUDFLARE_FLOOR, until) if d.isoformat() not in have]
    fetched = 0
    for d in missing:
        url = ("https://api.cloudflare.com/client/v4/radar/ranking/internet_services/top"
               f"?serviceCategory=Generative%20AI&limit=30&date={d}")
        data = http_get_json(url, headers)
        if not data.get("success") or not data.get("result", {}).get("top_0"):
            print(f"cloudflare: no ranking for {d}, skipping", file=sys.stderr)
            continue
        write_raw("cloudflare", d.isoformat(), {
            "source": "cloudflare-radar-genai-services",
            "date": d.isoformat(),
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "rows": data["result"]["top_0"],
            "meta": data["result"].get("meta"),
        })
        fetched += 1
        if len(missing) > 5:
            time.sleep(0.15)
    print(f"cloudflare: wrote {fetched} day(s)")


def collect_lmarena():
    """Daily snapshot of the official LMArena text leaderboard (HF dataset mirror)."""
    today = dt.datetime.now(dt.timezone.utc).date().isoformat()
    if today in existing_dates("lmarena"):
        print("lmarena: today's snapshot already exists")
        return
    data = http_get_json(LMARENA_URL)
    rows = [r["row"] for r in data.get("rows", [])]
    if not rows:
        raise RuntimeError("lmarena: dataset-server returned no rows")
    write_raw("lmarena", today, {
        "source": "lmarena-leaderboard-dataset-text-latest",
        "date": today,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "rows": rows,
    })
    print("lmarena: wrote 1 snapshot")


# ---------------- classification ----------------

def load_classification():
    with open(CLASSIFICATION, encoding="utf-8") as f:
        return json.load(f)


def classify_openrouter(slug, table, unmapped):
    base = slug.split(":")[0]  # strip :free / :extended variants
    t = table["openrouter"]
    if base == t["other_slug"]:
        return "other"
    if base in t["exact"]:
        return t["exact"][base]
    hits = [p for p in t["prefix"] if base.startswith(p)]
    if hits:
        return t["prefix"][max(hits, key=len)]
    org = base.split("/")[0]
    if org in t["org_defaults"]:
        return t["org_defaults"][org]
    unmapped.add(slug)
    return "unknown"


def classify_vercel(name, table, unmapped):
    t = table["vercel"]
    if name == t["other_name"]:
        return "other"
    if name in t["exact"]:
        return t["exact"][name]
    if "/" in name:  # slug-style display name; reuse the openrouter rules
        cls = classify_openrouter(name, table, set())
        if cls != "unknown":
            return cls
    for prefix, cls in t["prefix_rules"]:
        if name.startswith(prefix):
            return cls
    unmapped.add(name)
    return "unknown"


def explain_openrouter(slug, table):
    base = slug.split(":")[0]
    t = table["openrouter"]
    if base == t["other_slug"]:
        return "aggregated remainder bucket"
    if base in t["exact"]:
        return f"exact rule for '{base}'"
    hits = [p for p in t["prefix"] if base.startswith(p)]
    if hits:
        return f"prefix rule '{max(hits, key=len)}'"
    org = base.split("/")[0]
    if org in t["org_defaults"]:
        return f"org default for '{org}'"
    return "unmapped"


def explain_vercel(name, table):
    t = table["vercel"]
    if name == t["other_name"]:
        return "aggregated remainder bucket"
    if name in t["exact"]:
        return f"exact rule for '{name}'"
    if "/" in name:
        r = explain_openrouter(name, table)
        if r != "unmapped":
            return r
    for prefix, _cls in t["prefix_rules"]:
        if name.startswith(prefix):
            return f"prefix rule '{prefix}'"
    return "unmapped"


# ---------------- derive ----------------

CLASSES = ("open", "closed", "unknown", "other")

# Org -> lab grouping for the lab breakdown panels (OpenRouter slugs).
LABS = {
    "openai": "OpenAI", "anthropic": "Anthropic", "google": "Google", "x-ai": "xAI",
    "deepseek": "DeepSeek", "qwen": "Qwen", "alibaba": "Qwen",
    "meta": "Llama", "meta-llama": "Llama", "mistralai": "Mistral",
    "moonshotai": "Kimi", "z-ai": "GLM",
}


def derive():
    table = load_classification()
    unmapped = {"vercel": set(), "openrouter": set()}
    days = {}
    model_shares = {"openrouter": {}, "vercel": {}}  # iso -> {model: pct}
    lab_shares = {}    # iso -> {(camp, lab): pct of all tokens}  (openrouter only)
    vc_spend = {}      # iso -> {model: spend share pct}

    for iso in sorted(existing_dates("openrouter")):
        with open(os.path.join(RAW, "openrouter", f"{iso}.json"), encoding="utf-8") as f:
            payload = json.load(f)
        totals = dict.fromkeys(CLASSES, 0)
        by_model = {}
        open_models = set()
        for row in payload["rows"]:
            cls = classify_openrouter(row["model_permaslug"], table, unmapped["openrouter"])
            tok = int(row["total_tokens"])
            totals[cls] += tok
            base = row["model_permaslug"].split(":")[0]
            by_model[base] = by_model.get(base, 0) + tok
            if cls == "open":
                open_models.add(base)
        total = sum(totals.values())
        if total:
            days.setdefault(iso, {})["openrouter"] = {
                c: round(100 * totals[c] / total, 2) for c in CLASSES
            }
            days[iso]["openrouter"]["total_tokens"] = total
            days[iso]["openrouter"]["open_models"] = len(open_models)
            model_shares["openrouter"][iso] = {
                m: round(100 * t / total, 3) for m, t in by_model.items()
            }
            labs = {}
            for row in payload["rows"]:
                base = row["model_permaslug"].split(":")[0]
                cls = classify_openrouter(base, table, set())
                if cls not in ("open", "closed"):
                    continue
                lab = LABS.get(base.split("/")[0], f"Other {cls}")
                # Mixed labs: name the open-weight lines by their open family.
                if cls == "open":
                    lab = {"Google": "Gemma", "OpenAI": "gpt-oss"}.get(lab, lab)
                labs[(cls, lab)] = labs.get((cls, lab), 0) + int(row["total_tokens"])
            lab_shares[iso] = {k: round(100 * v / total, 3) for k, v in labs.items()}

    for iso in sorted(existing_dates("vercel")):
        with open(os.path.join(RAW, "vercel", f"{iso}.json"), encoding="utf-8") as f:
            payload = json.load(f)
        totals = dict.fromkeys(CLASSES, 0.0)
        by_model = {}
        spend_cls = dict.fromkeys(CLASSES, 0.0)
        for row in payload["rows"]:
            if row.get("metric") == "spend":
                spend_cls[classify_vercel(row["name"], table, set())] += row["share_percent"]
            if row.get("metric") != "tokens":
                continue
            cls = classify_vercel(row["name"], table, unmapped["vercel"])
            totals[cls] += row["share_percent"]
            by_model[row["name"]] = by_model.get(row["name"], 0.0) + row["share_percent"]
        total = sum(totals.values())
        if total:
            days.setdefault(iso, {})["vercel"] = {
                c: round(100 * totals[c] / total, 2) for c in CLASSES
            }
            model_shares["vercel"][iso] = {m: round(s, 3) for m, s in by_model.items()}
            att = spend_cls["open"] + spend_cls["closed"]
            if att > 0:
                days[iso]["vercel"]["spend_open"] = round(100 * spend_cls["open"] / att, 2)

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    series = [{"date": iso, **days[iso]} for iso in sorted(days)]

    os.makedirs(DERIVED, exist_ok=True)
    with open(os.path.join(DERIVED, "open_share_daily.json"), "w", encoding="utf-8") as f:
        json.dump({"updated_at": now,
                   "classes": list(CLASSES),
                   "days": series}, f, ensure_ascii=False, separators=(",", ":"))

    # Per-model panels: top movers over time + latest-day ranking, per gateway.
    EXCLUDE = {"other", "Other"}  # aggregated remainder buckets, not models

    def classify_any(source, name):
        if source == "openrouter":
            return classify_openrouter(name, table, set())
        return classify_vercel(name, table, set())

    models_out = {"updated_at": now}
    latest_out = {"updated_at": now}
    for source, shares in model_shares.items():
        dates = sorted(shares)
        if not dates:
            continue
        last = shares[dates[-1]]
        ranked = sorted((m for m in last if m not in EXCLUDE), key=lambda m: -last[m])
        # chart series: today's top 6 plus every ~monthly top-3 across history,
        # so models that led in the past remain drawn (no survivorship bias)
        sel = set(ranked[:6])
        for d in dates[::30] + [dates[-1]]:
            day = shares[d]
            for m in sorted((k for k in day if k not in EXCLUDE), key=lambda k: -day[k])[:3]:
                sel.add(m)
        peak = {m: max(shares[d].get(m, 0) for d in dates) for m in sel}
        # today's top 6 keep their slots; the last two go to the biggest
        # historical peaks, so past eras stay visible
        rest = sorted((m for m in sel if m not in ranked[:6]), key=lambda m: -peak[m])
        top = ranked[:6] + rest[:2]
        models_out[source] = {
            "dates": dates,
            "series": [{
                "name": m,
                "class": classify_any(source, m),
                "values": [shares[d].get(m) for d in dates],
            } for m in top],
        }
        latest_out[source] = {
            "date": dates[-1],
            "models": [{
                "name": m,
                "share": last[m],
                "class": classify_any(source, m),
                "why": (explain_openrouter if source == "openrouter" else explain_vercel)(m, table),
            } for m in ranked[:12]],
        }

    # Lab breakdown (OpenRouter): share of ALL daily tokens, grouped by camp.
    if lab_shares:
        ldates = sorted(lab_shares)
        keys = sorted({k for day in lab_shares.values() for k in day})
        by_camp = {"closed": [], "open": []}
        for camp in by_camp:
            camp_keys = [k for k in keys if k[0] == camp]
            # order labs by latest-day share, named labs first, "Other" last
            camp_keys.sort(key=lambda k: (k[1].startswith("Other "), -lab_shares[ldates[-1]].get(k, 0)))
            # cap at 7 lab_series; fold the rest into the camp's "Other" line
            named = [k for k in camp_keys if not k[1].startswith("Other ")][:6]
            folded = [k for k in camp_keys if k not in named]
            lab_series = [{"name": k[1], "values": [lab_shares[d].get(k) for d in ldates]}
                      for k in named]
            if folded:
                lab_series.append({"name": f"Other {camp}", "values": [
                    round(sum(lab_shares[d].get(k) or 0 for k in folded), 3) or None
                    for d in ldates]})
            by_camp[camp] = lab_series
        with open(os.path.join(DERIVED, "labs_timeseries.json"), "w", encoding="utf-8") as f:
            json.dump({"updated_at": now, "source": "openrouter", "dates": ldates,
                       "closed": by_camp["closed"], "open": by_camp["open"]},
                      f, ensure_ascii=False, separators=(",", ":"))

    with open(os.path.join(DERIVED, "models_timeseries.json"), "w", encoding="utf-8") as f:
        json.dump(models_out, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(DERIVED, "models_latest.json"), "w", encoding="utf-8") as f:
        json.dump(latest_out, f, ensure_ascii=False, separators=(",", ":"))

    # Consumer panel: Cloudflare Radar service ranks, weekly-sampled bump-chart data.
    CF_ALIASES = {"Codeium": "Windsurf AI"}  # service names drift over time
    cf_days = sorted(existing_dates("cloudflare"))
    if cf_days:
        sample = cf_days[::-1][::7][::-1]  # every 7th day, latest always included
        ranks = {}
        for iso in sample:
            with open(os.path.join(RAW, "cloudflare", f"{iso}.json"), encoding="utf-8") as f:
                payload = json.load(f)
            day = {}
            for row in payload["rows"]:
                name = row["service"].split(" / ")[0]
                name = CF_ALIASES.get(name, name)
                day[name] = min(row["rank"], day.get(name, 99))
            ranks[iso] = day
        last = ranks[sample[-1]]
        sel = set(sorted(last, key=lambda k: last[k])[:8])
        for d in sample:
            for name, r in ranks[d].items():
                if r <= 4:
                    sel.add(name)
        best = {n: min(ranks[d].get(n, 99) for d in sample) for n in sel}
        top = sorted(sel, key=lambda n: (best[n], last.get(n, 99)))[:8]
        with open(os.path.join(DERIVED, "consumer_rankings.json"), "w", encoding="utf-8") as f:
            json.dump({"updated_at": now, "dates": sample,
                       "series": [{"name": n, "ranks": [ranks[d].get(n) for d in sample]}
                                  for n in top]}, f, ensure_ascii=False, separators=(",", ":"))

    # Open-ecosystem popularity: latest Hugging Face snapshot, top models by downloads.
    hf_days = sorted(existing_dates("huggingface"))
    if hf_days:
        with open(os.path.join(RAW, "huggingface", f"{hf_days[-1]}.json"), encoding="utf-8") as f:
            payload = json.load(f)
        with open(os.path.join(DERIVED, "hf_top.json"), "w", encoding="utf-8") as f:
            json.dump({"updated_at": now, "date": hf_days[-1],
                       "models": [{"id": r["id"], "downloads": r.get("downloads", 0),
                                   "likes": r.get("likes", 0)}
                                  for r in payload["rows"]
                                  if not any(t in r["id"].lower()
                                             for t in ("internal", "testing", "tiny-", "dummy"))][:15]},
                      f, ensure_ascii=False, separators=(",", ":"))

    lm_days = sorted(existing_dates("lmarena"))
    if lm_days:
        with open(os.path.join(RAW, "lmarena", f"{lm_days[-1]}.json"), encoding="utf-8") as f:
            payload = json.load(f)
        rows = sorted(payload["rows"], key=lambda r: r.get("rank") or 999)[:12]
        with open(os.path.join(DERIVED, "lmarena_top.json"), "w", encoding="utf-8") as f:
            json.dump({"updated_at": now, "date": lm_days[-1],
                       "models": [{"name": r.get("model_name"), "org": r.get("organization"),
                                   "rating": round(r.get("rating") or 0),
                                   "votes": int(r.get("vote_count") or 0),
                                   "license": r.get("license")}
                                  for r in rows]},
                      f, ensure_ascii=False, separators=(",", ":"))

    def span(source):
        ds = sorted(existing_dates(source))
        return {"first": ds[0], "last": ds[-1], "days": len(ds)} if ds else None

    with open(os.path.join(DERIVED, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "updated_at": now,
            "classification_version": table["version"],
            "sources": {source: span(source) for source in
                        ("openrouter", "vercel", "huggingface", "cloudflare", "lmarena")},
            "unmapped": {k: sorted(v) for k, v in unmapped.items()},
        }, f, ensure_ascii=False, indent=1)

    print(f"derived: {len(series)} day(s); unmapped: "
          f"openrouter={len(unmapped['openrouter'])} vercel={len(unmapped['vercel'])}")
    return unmapped


def main():
    argv = sys.argv[1:]
    until = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)
    errors = []
    statuses = {}
    if "--no-fetch" not in argv:
        # Each source is independent: one failing must not block the others'
        # data from being fetched and committed.
        for name, fn in [("vercel", lambda: collect_vercel(until)),
                         ("openrouter", lambda: collect_openrouter(until)),
                         ("huggingface", collect_huggingface),
                         ("lmarena", collect_lmarena),
                         ("cloudflare", lambda: collect_cloudflare(until))]:
            try:
                fn()
                statuses[name] = "ok"
            except Exception as e:  # noqa: BLE001 — fail loudly, at the end
                errors.append(f"{name}: {e}")
                statuses[name] = str(e)[:200]
                print(f"ERROR {name}: {e}", file=sys.stderr)
    derive()
    if statuses:
        os.makedirs(DERIVED, exist_ok=True)
        with open(os.path.join(DERIVED, "status.json"), "w", encoding="utf-8") as f:
            json.dump({"run_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                       "ok": not errors, "sources": statuses}, f, ensure_ascii=False, indent=1)
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
