#!/usr/bin/env python3
"""Daily collector for the compute price dashboard (compute/).

Sources (both public, no keys required):

  - Ornn public index API (data.ornn.com/api/public-index/...) — settled
    daily OCPI values per GPU. Each index-history call returns a rolling
    ~3-month daily window, so occasional missed runs cost nothing.
  - Kalshi public markets API — binary "monthly average above $X" strike
    ladders for H100/B200/A100, used to derive a market-implied median path.
    NOTE these contracts settle on the ORNN index, so their levels carry the
    cross-benchmark basis against anything quoted on the Silicon Data basis.
  - gpus.io public catalogue (gpus.io/en) — every listed offer from ~26
    neo-cloud and marketplace providers, with rental type and availability.
    Used for price DISPERSION: where the settlement index sits inside the
    physical market it references. Neo-cloud only, matching the index basis.
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
RAW_GPUSIO = ROOT / "data" / "raw" / "gpusio_public"
RAW_KALSHI = ROOT / "data" / "raw" / "kalshi_public"
OUT = ROOT / "compute" / "dataFiles" / "gpu_live.json"

UA = "Mozilla/5.0 (compatible; Compute-and-LLM-Dashboard/1.0; +https://github.com/Kadentato/Compute-and-LLM-Dashboard)"
TIMEOUT = 30

ORNN_BASE = "https://data.ornn.com/api/public-index"
ORNN_GPUS = ["H100 SXM", "B200", "A100 SXM4", "H200", "RTX 5090"]
SD_URL = "https://www.silicondata.com/products/silicon-index"
GPUSIO_URL = "https://gpus.io/en"

# gpus.io model slugs we price. Neo-cloud/marketplace providers only (no
# hyperscalers), which is the same population the Silicon Data neo-cloud
# index references — so the dispersion is comparable to the index, not a
# different market.
GPUSIO_SLUGS = {"h100": "H100", "b200": "B200", "a100": "A100", "h200": "H200", "mi300": "MI300X"}

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


def flight_text(html):
    """Concatenate and unescape the Next.js flight payload chunks."""
    parts = re.findall(r'self\.__next_f\.push\(\[1,\s*(".*?")\]\)', html, re.S)
    out = []
    for p in parts:
        try:
            out.append(json.loads(p))
        except Exception:
            pass
    return "".join(out)


def slice_json(text, start):
    """Return the complete JSON value beginning at `start` (a [ or {)."""
    open_ch = text[start]
    close_ch = "]" if open_ch == "[" else "}"
    depth, i, in_str, esc = 0, start, False, False
    while i < len(text):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
        i += 1
    raise ValueError("unterminated JSON in gpus.io payload")


def fetch_gpusio():
    """Per-provider offer prices for the GPUs we track, from the public
    catalogue embedded in the gpus.io page payload."""
    text = flight_text(http_get(GPUSIO_URL))
    m = re.search(r'"providers":\s*\[', text)
    if not m:
        raise RuntimeError("gpus.io: providers array not found (page structure changed?)")
    providers = json.loads(slice_json(text, m.end() - 1))
    rows = []
    for prov in providers:
        for slug, lst in (prov.get("gpuOfferings") or {}).items():
            if slug not in GPUSIO_SLUGS:
                continue
            for o in lst:
                price = (o.get("pricePerGpuHour") or {}).get("usd")
                if price is None:
                    continue
                rows.append({
                    "provider": prov.get("name"),
                    "gpu": GPUSIO_SLUGS[slug],
                    "rental_type": o.get("rentalType"),
                    "usd_per_gpu_hour": price,
                    "availability": o.get("availability"),
                    "commitment_months": o.get("commitmentTermMonths"),
                })
    if len(rows) < 50:
        raise RuntimeError("gpus.io: only %d offers parsed; refusing a thin capture" % len(rows))
    RAW_GPUSIO.mkdir(parents=True, exist_ok=True)
    path = RAW_GPUSIO / (today_utc() + ".json")
    path.write_text(json.dumps({
        "fetched_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "url": GPUSIO_URL,
        "provider_count": len({r["provider"] for r in rows}),
        "offers": rows,
    }, separators=(",", ":")), encoding="utf-8")
    return path


KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"
# Monthly-average price ladders. These contracts settle on the ORNN index, not
# Silicon Data — so the implied levels are comparable to the Ornn series, and
# carry the cross-benchmark basis against everything quoted on the SD basis.
KALSHI_SERIES = {"KXH100MS": "H100", "KXB200MS": "B200", "KXA100MS": "A100"}


def fetch_kalshi():
    """Open strike ladders for the GPU monthly-average markets."""
    out = {"fetched_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(),
           "source": KALSHI_BASE, "series": {}}
    total = 0
    for ticker, gpu in KALSHI_SERIES.items():
        url = KALSHI_BASE + "/markets?limit=200&status=open&series_ticker=" + ticker
        markets = json.loads(http_get(url)).get("markets", [])
        keep = []
        for m in markets:
            keep.append({k: m.get(k) for k in (
                "ticker", "event_ticker", "close_time", "strike_type", "floor_strike",
                "previous_yes_bid_dollars", "previous_yes_ask_dollars",
                "last_price_dollars", "open_interest_fp", "rules_secondary")})
        out["series"][ticker] = {"gpu": gpu, "markets": keep}
        total += len(keep)
    if total < 30:
        raise RuntimeError("kalshi: only %d markets parsed; refusing a thin capture" % total)
    RAW_KALSHI.mkdir(parents=True, exist_ok=True)
    path = RAW_KALSHI / (today_utc() + ".json")
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    return path


def _num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def implied_median(strikes):
    """Median of the market-implied distribution from a ladder of binary
    'above $k' contracts.

    Each contract's price is the risk-neutral probability that settlement
    exceeds its strike, so the ladder traces the survival function
    S(k) = P(X > k). Quote noise can make it non-monotone, so it is clamped
    to non-increasing. The median is the strike where S crosses 0.50, found by
    linear interpolation between the bracketing strikes:

        m* = k1 + (S(k1) - 0.5) * (k2 - k1) / (S(k1) - S(k2))

    The median rather than the mean because the ladder is bounded: the tails
    beyond the lowest and highest strikes are unobserved, so a mean would
    require assuming a tail shape. The median is identified whenever the
    crossing falls inside the ladder, and is None when it does not.
    """
    pts = sorted(strikes)
    if len(pts) < 3:
        return None
    surv, prev = [], 1.0
    for k, p in pts:
        p = min(p, prev)
        surv.append((k, p))
        prev = p
    for i in range(len(surv) - 1):
        (k1, p1), (k2, p2) = surv[i], surv[i + 1]
        if p1 >= 0.5 >= p2 and p1 != p2:
            return round(k1 + (p1 - 0.5) * (k2 - k1) / (p1 - p2), 3)
    return None


def kalshi_curve(raw):
    """Implied median per GPU per contract month, with open interest."""
    out = {}
    for ticker, block in raw.get("series", {}).items():
        gpu = block["gpu"]
        events = {}
        for m in block["markets"]:
            events.setdefault(m["event_ticker"], []).append(m)
        months = {}
        for ev, rows in events.items():
            pts, oi = [], 0.0
            for r in rows:
                if r.get("strike_type") != "greater":
                    continue
                k = _num(r.get("floor_strike"))
                bid = _num(r.get("previous_yes_bid_dollars"))
                ask = _num(r.get("previous_yes_ask_dollars"))
                p = (bid + ask) / 2 if (bid is not None and ask is not None and ask > 0) \
                    else _num(r.get("last_price_dollars"))
                oi += _num(r.get("open_interest_fp")) or 0.0
                if k is not None and p is not None:
                    pts.append((k, p))
            med = implied_median(pts)
            if med is None:
                continue
            close = (rows[0].get("close_time") or "")[:10]
            months[close] = {"median": med, "strikes": len(pts),
                             "open_interest": round(oi)}
        if months:
            out[gpu] = months
    return out


def pctile(vals, p):
    vals = sorted(vals)
    if not vals:
        return None
    k = (len(vals) - 1) * p / 100.0
    lo, hi = int(k), min(int(k) + 1, len(vals) - 1)
    return round(vals[lo] + (vals[hi] - vals[lo]) * (k - lo), 3)


def dispersion(raw):
    """Provider-level price dispersion per GPU and rental type.

    Percentiles are taken across PROVIDER MEDIANS, not across raw offers:
    one marketplace (Vast.ai) lists ~45% of all offers, so an offer-level
    percentile would mostly describe that one venue rather than the market.
    """
    by = {}
    for o in raw["offers"]:
        if o["availability"] == "unavailable":
            continue
        by.setdefault((o["gpu"], o["rental_type"]), {}).setdefault(o["provider"], []).append(
            o["usd_per_gpu_hour"])
    out = {}
    for (gpu, rt), provs in by.items():
        med = sorted(sum(v) / len(v) if len(v) == 1 else pctile(v, 50) for v in provs.values())
        if len(med) < 2:
            continue
        out.setdefault(gpu, {})[rt] = {
            "providers": len(med),
            "offers": sum(len(v) for v in provs.values()),
            "min": round(med[0], 3), "p25": pctile(med, 25), "median": pctile(med, 50),
            "p75": pctile(med, 75), "max": round(med[-1], 3),
        }
    return out


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

    disp, disp_meta = {}, {}
    files = sorted(RAW_GPUSIO.glob("*.json"))
    if files:
        raw = json.loads(files[-1].read_text(encoding="utf-8"))
        disp = dispersion(raw)
        disp_meta = {"date": files[-1].stem, "providers": raw.get("provider_count"),
                     "source": raw.get("url")}

    kalshi, kalshi_meta = {}, {}
    kfiles = sorted(RAW_KALSHI.glob("*.json"))
    if kfiles:
        kraw = json.loads(kfiles[-1].read_text(encoding="utf-8"))
        kalshi = kalshi_curve(kraw)
        kalshi_meta = {"date": kfiles[-1].stem, "source": kraw.get("source"),
                       "settles_on": "Ornn index (per contract rules)"}

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "note":"Post-report daily values from public feeds. Ornn: settled OCPI via data.ornn.com public API (rolling window, accumulated). Silicon Data: latest daily prints as displayed on the public indices page, recorded under the UTC fetch date. The static series in gpu_prices.json (Bloomberg export) ends at static_end; charts extend from the day after.",
        "static_end": STATIC_END,
        "ornn": ornn,
        "sd": sd,
        "dispersion": disp,
        "dispersion_meta": disp_meta,
        "kalshi": kalshi,
        "kalshi_meta": kalshi_meta,
    }
    OUT.write_text(json.dumps(out, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    n_dates = len(set().union(*[set(v) for v in ornn.values()])) if ornn else 0
    print("derived %s: ornn gpus=%d (%d dates), sd keys=%s, dispersion gpus=%d, kalshi gpus=%d" % (
        OUT.name, len(ornn), n_dates, sorted(sd.keys()), len(disp), len(kalshi)))


def main():
    no_fetch = "--no-fetch" in sys.argv
    failures = []
    if not no_fetch:
        for name, fn in (("ornn", fetch_ornn), ("silicondata", fetch_sd),
                         ("gpusio", fetch_gpusio), ("kalshi", fetch_kalshi)):
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
