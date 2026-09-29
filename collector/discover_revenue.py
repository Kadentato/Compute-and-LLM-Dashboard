#!/usr/bin/env python3
"""Find newly reported lab revenue run-rates and open one GitHub issue per new figure.

Nothing here writes to the site. The chart on the LLM pages reads
data/reported/lab_revenue.json, which a person edits after reading the report; this job only
makes sure no report is missed. It searches a public news feed for the last week of
run-rate headlines about each lab, keeps the ones that state a company-wide figure, drops
figures already on file, groups the same figure across outlets, and opens an issue with the
sources and a pre-filled row. The headline filter is deliberately conservative about what
it calls a candidate and says nothing is certain: the same feed carries segment figures
("ad business hits $1B run rate"), projections ("to top $100B in 2026"), calendar-year
revenue and losses, which is why a person decides.

Standard library only. Runs locally as a dry run (prints candidates) when GITHUB_TOKEN is
unset. Exits non-zero only if every feed query failed, so a quiet week is not an error.
"""
import datetime as dt
import email.utils
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "reported" / "lab_revenue.json"
UA = "Mozilla/5.0 (compatible; Compute-and-LLM-Dashboard/1.0; +https://github.com/Kadentato/Compute-and-LLM-Dashboard)"
FEED = "https://news.google.com/rss/search"
LABEL = "lab-revenue"

LABS = {
    "anthropic": {"name": "Anthropic", "match": r"\bAnthropic",
                  "queries": ['Anthropic "run rate" revenue', "Anthropic annualized revenue"]},
    "openai": {"name": "OpenAI", "match": r"\bOpenAI",
               "queries": ['OpenAI "run rate" revenue', "OpenAI annualized revenue", 'OpenAI "annual recurring revenue"']},
}

RUN_RATE = re.compile(r"run[- ]?rate|annuali[sz]ed|annual recurring|\bARR\b|annual pace", re.I)
FIGURE = re.compile(r"(?:US)?\$\s?(\d+(?:\.\d+)?)\s?(billion|bn|b)\b", re.I)
# A figure for part of the business, not the company.
SEGMENT = re.compile(r"\bads?\b|advertis|segment|claude code|\bcodex\b|\bapi business|chatgpt (?:plus|pro|go|enterprise)|"
                     r"enterprise business|consumer business|\bunit\b", re.I)
# A figure about the future, or not a run-rate at all.
FORWARD = re.compile(r"\bexpects?\b|forecast|project(?:s|ed|ion)|\btargets?\b|\baims?\b|\bcould\b|\bmay\b|\bwould\b|"
                     r"\bplans?\b|\bgoal\b|\bby 20\d\d\b|\bto (?:top|hit|reach|surpass|exceed)\b|\blost\b|\bloss\b", re.I)
QUALIFIER = [(re.compile(r"\bnears?\b|\bnearing\b|\bapproach", re.I), "nears"),
             (re.compile(r"\btops?\b|\btopped\b|\bcross(?:es|ed)?\b|\bsurpass|\bexceed|\bpasse[sd]\b|more than|over\b", re.I), "tops")]


def classify(title, lab):
    """(value in $bn, qualifier) if `title` states a company-wide run-rate for `lab`, else (None, reason)."""
    spec = LABS[lab]
    m_lab = re.search(spec["match"], title)
    if not m_lab:
        return None, "lab not named"
    if not RUN_RATE.search(title):
        return None, "no run-rate wording"
    if SEGMENT.search(title):
        return None, "segment figure"
    if FORWARD.search(title):
        return None, "projection or not a run-rate"
    # The figure that belongs to this lab: the first one after its name. "Anthropic's run
    # rate reaches $45B, surpassing OpenAI's $25B" gives 45 for one and 25 for the other.
    after = [m for m in FIGURE.finditer(title) if m.start() > m_lab.start()]
    if not after:
        return None, "no figure after the lab's name"
    fig = after[0]
    # The same figure may belong to a lab named earlier: "Anthropic overtakes OpenAI in
    # revenue, hitting $30B" is Anthropic's $30B, not OpenAI's.
    for other, ospec in LABS.items():
        if other == lab:
            continue
        m_other = re.search(ospec["match"], title)
        if m_other and m_other.start() < m_lab.start():
            theirs = [m for m in FIGURE.finditer(title) if m.start() > m_other.start()]
            if theirs and theirs[0].start() == fig.start():
                return None, "figure belongs to %s" % ospec["name"]
    # "$3.7B in 2024" is a calendar year's revenue, not a run-rate.
    if re.match(r"\s*(?:of\s+)?(?:revenue\s+)?in\s+20\d\d", title[fig.end():], re.I):
        return None, "calendar-year figure"
    value = float(fig.group(1))
    if value < 1:
        return None, "figure below $1bn"
    qual = "hits"
    for rx, q in QUALIFIER:
        if rx.search(title):
            qual = q
            break
    return (value, qual), None


def known(value, lab, published, rows):
    """True if a row for `lab` already carries this figure near this date: within 3% over 75
    days, or within 6% over three weeks, because "nears $20B" and "$19B" a day apart are one
    piece of news reported twice."""
    d = dt.date.fromisoformat(published)
    for r in rows:
        if r["lab"] != lab:
            continue
        gap = abs((dt.date.fromisoformat(r["published"]) - d).days)
        diff = abs(r["usd_bn"] - value) / max(value, r["usd_bn"])
        if (diff <= 0.03 and gap <= 75) or (diff <= 0.06 and gap <= 21):
            return True
    return False


def issue_key(lab, value):
    return "rev:%s:%g" % (lab, value)


def group(candidates):
    """One entry per (lab, figure) with every outlet that reported it, earliest first."""
    out = {}
    for c in sorted(candidates, key=lambda c: c["published"]):
        k = issue_key(c["lab"], c["value"])
        out.setdefault(k, {"key": k, "lab": c["lab"], "value": c["value"], "qualifier": c["qualifier"], "items": []})
        if all(i["title"] != c["title"] for i in out[k]["items"]):
            out[k]["items"].append(c)
    return list(out.values())


def issue_body(g):
    first = g["items"][0]
    row = {"lab": g["lab"], "date": first["published"], "published": first["published"], "usd_bn": g["value"],
           "qualifier": g["qualifier"], "attribution": "reported", "period": None, "outlet": first["outlet"],
           "headline": first["title"], "url": first["link"]}
    lines = [
        "A news headline states a run-rate for **%s** of **$%gB** that is not on file." % (LABS[g["lab"]]["name"], g["value"]),
        "",
        "| Published | Outlet | Headline |", "|---|---|---|",
    ] + ["| %s | %s | [%s](%s) |" % (i["published"], i["outlet"], i["title"].replace("|", "/"), i["link"]) for i in g["items"]] + [
        "",
        "**Before adding it**, open the report and check that the figure is a company-wide annualized",
        "run-rate stated for now or a named recent month -- not a segment, not a projection, not",
        "calendar-year revenue. Set `attribution` to `company` if the company itself said it, and",
        "`date`/`period` if the report names the month the figure refers to. Prefer the earliest",
        "primary outlet above.",
        "",
        "**To add it**, paste this row into `rows` in `data/reported/lab_revenue.json`, commit, and",
        "close this issue. **If it is not a run-rate**, close the issue without adding anything.",
        "",
        "```json",
        json.dumps(row, ensure_ascii=False, indent=1),
        "```",
        "",
        "<sub>Opened by collector/discover_revenue.py. Key: `%s`</sub>" % g["key"],
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- network

def fetch_feed(query, days=7):
    url = FEED + "?" + urllib.parse.urlencode({"q": "%s when:%dd" % (query, days), "hl": "en-US", "gl": "US", "ceid": "US:en"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode("utf-8", "replace")
    items = []
    for it in re.findall(r"<item>(.*?)</item>", body, re.S):
        get = lambda tag: (re.search(r"<%s[^>]*>(.*?)</%s>" % (tag, tag), it, re.S) or [None, ""])[1]
        src = re.search(r"<source[^>]*>(.*?)</source>", it, re.S)
        title = html.unescape(get("title"))
        outlet = html.unescape(src.group(1)) if src else ""
        if outlet and title.endswith(" - " + outlet):
            title = title[: -len(" - " + outlet)]
        try:
            published = email.utils.parsedate_to_datetime(get("pubDate")).date().isoformat()
        except (TypeError, ValueError):
            continue
        items.append({"title": title, "outlet": outlet, "link": html.unescape(get("link")), "published": published})
    return items


def github(method, path, token, payload=None):
    repo = os.environ["GITHUB_REPOSITORY"]
    req = urllib.request.Request("https://api.github.com/repos/%s%s" % (repo, path), method=method,
                                 data=json.dumps(payload).encode() if payload is not None else None,
                                 headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
                                          "User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode() or "null")


def existing_keys(token):
    keys, page = set(), 1
    while True:
        batch = github("GET", "/issues?labels=%s&state=all&per_page=100&page=%d" % (LABEL, page), token)
        for i in batch:
            m = re.search(r"Key: `([^`]+)`", i.get("body") or "")
            if m:
                keys.add(m.group(1))
        if len(batch) < 100:
            return keys
        page += 1


def main():
    rows = json.loads(DATA.read_text(encoding="utf-8"))["rows"]
    token = os.environ.get("GITHUB_TOKEN")
    candidates, ok, failed = [], 0, 0
    for lab, spec in LABS.items():
        for q in spec["queries"]:
            try:
                items = fetch_feed(q)
                ok += 1
            except Exception as e:                       # a feed hiccup is not a failure of the job
                failed += 1
                print("WARN feed %r: %r" % (q, e), file=sys.stderr)
                continue
            for it in items:
                hit, why = classify(it["title"], lab)
                if not hit:
                    continue
                value, qual = hit
                if known(value, lab, it["published"], rows):
                    continue
                candidates.append(dict(it, lab=lab, value=value, qualifier=qual))
    if not ok:
        print("every feed query failed", file=sys.stderr)
        sys.exit(1)
    groups = group(candidates)
    print("%d feed queries, %d new figure(s)" % (ok, len(groups)))
    if not token:
        for g in groups:
            print("\n[dry run] %s\n%s" % (g["key"], issue_body(g)))
        return
    try:
        github("POST", "/labels", token, {"name": LABEL, "color": "d4a72c",
                                          "description": "Reported lab revenue figure to review"})
    except urllib.error.HTTPError as e:
        if e.code != 422:                                # 422: the label already exists
            raise
    seen = existing_keys(token)
    for g in groups:
        if g["key"] in seen:
            continue
        title = "Revenue report: %s $%gB (%s, %s)" % (LABS[g["lab"]]["name"], g["value"], g["items"][0]["outlet"],
                                                     g["items"][0]["published"])
        github("POST", "/issues", token, {"title": title, "body": issue_body(g), "labels": [LABEL]})
        print("opened:", title)


if __name__ == "__main__":
    main()
