#!/usr/bin/env python3
"""Daily collector for the compute price dashboard (compute/).

Sources (both public, no keys required):

  - Ornn public index API (data.ornn.com/api/public-index/...) — settled
    daily OCPI values per GPU. Each index-history call returns a rolling
    ~3-month daily window, so occasional missed runs cost nothing.
  - Silicon Data indices page (silicondata.com/products/silicon-index) —
    the latest daily prints for SDH100RT / SDA100RT / SDB200RT and the
    MI300X index are server-rendered into the public page. One print per
    fetch; values are recorded under the UTC fetch date, as displayed.

Contract (mirrors collector/collect.py): raw responses are stored verbatim
BEFORE any processing, runs are idempotent, sources fail independently, and
the script exits 1 if any source failed while still writing what succeeded.

Derived output: compute/dataFiles/gpu_live.json — per-date value maps that
the charts merge onto the report's static Bloomberg series (which ends
2026-08-25).

Usage:
  python collector/collect_gpu.py             # fetch + derive
  python collector/collect_gpu.py --no-fetch  # derive only, from stored raw
"""

import json
import re
import sys
import datetime as dt
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_ORNN = ROOT / "data" / "raw" / "ornn_public"
RAW_SD = ROOT / "data" / "raw" / "silicondata_public"
OUT = ROOT / "compute" / "dataFiles" / "gpu_live.json"

UA = "Mozilla/5.0 (compatible; Compute-and-LLM-Dashboard/1.0; +https://github.com/Kadentato/Compute-and-LLM-Dashboard)"
TIMEOUT = 30

ORNN_BASE = "https://data.ornn.com/api/public-index"
ORNN_GPUS = ["H100 SXM", "B200", "A100 SXM4", "H200", "RTX 5090"]
SD_URL = "https://www.silicondata.com/products/silicon-index"

# The static Bloomberg series on the site ends here; the charts extend from
# the day after. Kept in the derived file so the frontend needs no constant.
STATIC_END = "2026-08-25"


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read().decode("utf-8")


def today_utc():
    return dt.datetime.now(dt.timezone.utc).date().isoformat()


def fetch_ornn():
    payloads = {"fetched_at_utc": dt.datetime.now(dt.timezone.utc).isoformat()}
    payloads["daily_index_all"] = json.loads(http_get(ORNN_BASE + "/daily-index/all"))
    payloads["index_history"] = {}
    for gpu in ORNN_GPUS:
        url = ORNN_BASE + "/gpu/" + urllib.parse.quote(gpu) + "/index-history"
        payloads["index_history"][gpu] = json.loads(http_get(url))
    RAW_ORNN.mkdir(parents=True, exist_ok=True)
    path = RAW_ORNN / (today_utc() + ".json")
    path.write_text(json.dumps(payloads, separators=(",", ":")), encoding="utf-8")
    return path


SD_CARDS = {
    # key -> (anchor regexes tried in order)
    "h100": [r"SDH100RT"],
    "a100": [r"SDA100RT"],
    "b200": [r"SDB200RT"],
    "mi300x": [r"MI300X Rental Price Index"],
}


def parse_sd(html):
    """Pull the $ print that follows each index card's anchor text."""
    values, fragments = {}, {}
    for key, anchors in SD_CARDS.items():
        for anchor in anchors:
            m = re.search(anchor, html)
            if not m:
                continue
            window = html[m.start(): m.start() + 1200]
            v = re.search(r"\$(\d+\.\d{2})", window)
            if v:
                values[key] = float(v.group(1))
                frag = re.sub(r"<[^>]+>", "|", window[: v.end() + 60])
                fragments[key] = re.sub(r"\|+", "|", frag)[-220:]
                break
    return values, fragments


def fetch_sd():
    html = http_get(SD_URL)
    values, fragments = parse_sd(html)
    if set(values) != set(SD_CARDS):
        missing = sorted(set(SD_CARDS) - set(values))
        raise RuntimeError("silicondata parse missed: %s (page layout changed?)" % missing)
    RAW_SD.mkdir(parents=True, exist_ok=True)
    path = RAW_SD / (today_utc() + ".json")
    path.write_text(json.dumps({
        "fetched_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "url": SD_URL,
        "values_usd_per_gpu_hr": values,
        "matched_fragments": fragments,
    }, separators=(",", ":")), encoding="utf-8")
    return path


def derive():
    ornn = {}   # gpu -> {date: value}
    for f in sorted(RAW_ORNN.glob("*.json")):
        raw = json.loads(f.read_text(encoding="utf-8"))
        hist = raw.get("index_history", {})
        for gpu, payload in hist.items():
            for row in payload.get("data", []):
                date = row["timestamp"][:10]
                ornn.setdefault(gpu, {})[date] = round(float(row["index_value"]), 4)
        for row in raw.get("daily_index_all", {}).get("data", []):
            date = row["date"][:10]
            ornn.setdefault(row["gpu_type"], {})[date] = round(float(row["index_value"]), 4)

    sd = {}     # key -> {date: value}
    for f in sorted(RAW_SD.glob("*.json")):
        raw = json.loads(f.read_text(encoding="utf-8"))
        date = f.stem
        for key, val in raw.get("values_usd_per_gpu_hr", {}).items():
            sd.setdefault(key, {})[date] = val

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "note":"Post-report daily values from public feeds. Ornn: settled OCPI via data.ornn.com public API (rolling window, accumulated). Silicon Data: latest daily prints as displayed on the public indices page, recorded under the UTC fetch date. The static series in gpu_prices.json (Bloomberg export) ends at static_end; charts extend from the day after.",
        "static_end": STATIC_END,
        "ornn": ornn,
        "sd": sd,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    n_dates = len(set().union(*[set(v) for v in ornn.values()])) if ornn else 0
    print("derived %s: ornn gpus=%d (%d dates), sd keys=%s" % (
        OUT.name, len(ornn), n_dates, sorted(sd.keys())))


def main():
    no_fetch = "--no-fetch" in sys.argv
    failures = []
    if not no_fetch:
        for name, fn in (("ornn", fetch_ornn), ("silicondata", fetch_sd)):
            try:
                path = fn()
                print("fetched %s -> %s" % (name, path.relative_to(ROOT)))
            except Exception as e:
                failures.append((name, repr(e)))
                print("FAIL %s: %r" % (name, e), file=sys.stderr)
    derive()
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
