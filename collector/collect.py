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


# ---------------- derive ----------------

CLASSES = ("open", "closed", "unknown", "other")


def derive():
    table = load_classification()
    unmapped = {"vercel": set(), "openrouter": set()}
    days = {}

    for iso in sorted(existing_dates("openrouter")):
        with open(os.path.join(RAW, "openrouter", f"{iso}.json"), encoding="utf-8") as f:
            payload = json.load(f)
        totals = dict.fromkeys(CLASSES, 0)
        for row in payload["rows"]:
            cls = classify_openrouter(row["model_permaslug"], table, unmapped["openrouter"])
            totals[cls] += int(row["total_tokens"])
        total = sum(totals.values())
        if total:
            days.setdefault(iso, {})["openrouter"] = {
                c: round(100 * totals[c] / total, 2) for c in CLASSES
            }
            days[iso]["openrouter"]["total_tokens"] = total

    for iso in sorted(existing_dates("vercel")):
        with open(os.path.join(RAW, "vercel", f"{iso}.json"), encoding="utf-8") as f:
            payload = json.load(f)
        totals = dict.fromkeys(CLASSES, 0.0)
        for row in payload["rows"]:
            if row.get("metric") != "tokens":
                continue
            cls = classify_vercel(row["name"], table, unmapped["vercel"])
            totals[cls] += row["share_percent"]
        total = sum(totals.values())
        if total:
            days.setdefault(iso, {})["vercel"] = {
                c: round(100 * totals[c] / total, 2) for c in CLASSES
            }

    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    series = [{"date": iso, **days[iso]} for iso in sorted(days)]

    os.makedirs(DERIVED, exist_ok=True)
    with open(os.path.join(DERIVED, "open_share_daily.json"), "w", encoding="utf-8") as f:
        json.dump({"updated_at": now,
                   "classes": list(CLASSES),
                   "days": series}, f, ensure_ascii=False, separators=(",", ":"))

    def span(source):
        ds = sorted(existing_dates(source))
        return {"first": ds[0], "last": ds[-1], "days": len(ds)} if ds else None

    with open(os.path.join(DERIVED, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "updated_at": now,
            "classification_version": table["version"],
            "sources": {"openrouter": span("openrouter"), "vercel": span("vercel")},
            "unmapped": {k: sorted(v) for k, v in unmapped.items()},
        }, f, ensure_ascii=False, indent=1)

    print(f"derived: {len(series)} day(s); unmapped: "
          f"openrouter={len(unmapped['openrouter'])} vercel={len(unmapped['vercel'])}")
    return unmapped


def main():
    argv = sys.argv[1:]
    until = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=1)
    if "--no-fetch" not in argv:
        collect_vercel(until)
        collect_openrouter(until)
    derive()


if __name__ == "__main__":
    main()
