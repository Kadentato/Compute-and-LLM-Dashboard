"""The reported lab-revenue file and the job that finds new figures for it.

Headlines below are real ones from the news feed, including the kinds the job must not
mistake for a company-wide run-rate."""
import datetime as dt
import json
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "collector"))
import discover_revenue as d  # noqa: E402

DOC = json.loads((ROOT / "data" / "reported" / "lab_revenue.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------- the data file

def test_every_row_is_complete_and_sourced():
    need = {"lab", "date", "published", "usd_bn", "qualifier", "attribution", "period", "outlet", "headline", "url"}
    for r in DOC["rows"]:
        assert need <= set(r), r
        assert r["lab"] in DOC["labs"] and r["lab"] in d.LABS
        dt.date.fromisoformat(r["date"]), dt.date.fromisoformat(r["published"])
        assert r["date"] <= r["published"], "a figure cannot refer to a period after it was published"
        assert isinstance(r["usd_bn"], (int, float)) and 0 < r["usd_bn"] < 10000
        assert r["qualifier"] in ("hits", "tops", "nears")
        assert r["attribution"] in ("company", "reported")
        assert r["url"].startswith("https://") and r["outlet"] and r["headline"]


def test_no_row_is_on_file_twice():
    keys = [(r["lab"], r["date"], r["usd_bn"]) for r in DOC["rows"]]
    assert len(keys) == len(set(keys))


def test_the_headline_states_the_figure():
    """Every row's figure is written in its own headline -- nothing entered from memory."""
    for r in DOC["rows"]:
        v = r["usd_bn"]
        forms = {"$%g" % v, "$%g billion" % v, "$%gB" % v, "$%g Billion" % v}
        assert any(f in r["headline"] for f in forms), (v, r["headline"])


# ---------------------------------------------------------------- the classifier

@pytest.mark.parametrize("title,lab,want", [
    ("Anthropic revenue run rate tops $65 billion, source says", "anthropic", (65, "tops")),
    ("Scoop: OpenAI's annual recurring revenue nears $70B", "openai", (70, "nears")),
    ("Anthropic Revenue Hits $4 Billion Annual Pace as Competition With Cursor Intensifies", "anthropic", (4, "hits")),
    ("Anthropic's annualized revenue reaches $45B, surpassing OpenAI's $25B", "anthropic", (45, "tops")),
    ("Anthropic's annualized revenue reaches $45B, surpassing OpenAI's $25B", "openai", (25, "tops")),
])
def test_classify_accepts_company_run_rates(title, lab, want):
    hit, why = d.classify(title, lab)
    assert hit == want, why


@pytest.mark.parametrize("title,lab,reason", [
    ("OpenAI's ChatGPT Ads Hits $1 Billion Annualized Revenue Run Rate", "openai", "segment"),
    ("Anthropic acquires Bun as Claude Code hits $1B run rate", "anthropic", "segment"),
    ("Anthropic's Annualized Revenue to Top $100 Billion in 2026, NYT Says", "anthropic", "projection"),
    ("Anthropic Projects $70 Billion in Revenue by 2028", "anthropic", "run-rate"),
    ("Anthropic Reportedly Generated $4.6 Billion in Revenue and Lost $42 Billion in 2025", "anthropic", "run-rate"),
    ("Anthropic Overtakes OpenAI in Revenue, Hitting $30 Billion Run Rate", "openai", "belongs"),
    ("OpenAI Revenue: $3.7B in 2024 to a $40B+ Run Rate", "openai", "calendar"),
    ("OpenAI annualized revenue climbs", "openai", "figure"),
    ("Anthropic annualized revenue hits $40 billion", "openai", "lab not named"),
])
def test_classify_rejects_what_is_not_a_company_run_rate(title, lab, reason):
    hit, why = d.classify(title, lab)
    assert hit is None and reason in why, (hit, why)


def test_known_suppresses_figures_already_on_file():
    rows = [{"lab": "anthropic", "usd_bn": 20, "published": "2026-03-03"}]
    assert d.known(20, "anthropic", "2026-03-10", rows)
    assert d.known(19, "anthropic", "2026-03-04", rows)        # "nears $20B" and "$19B", a day apart
    assert not d.known(19, "anthropic", "2026-05-04", rows)    # the same 5% gap two months on is news
    assert not d.known(30, "anthropic", "2026-03-10", rows)
    assert not d.known(20, "openai", "2026-03-10", rows)


def test_the_file_as_committed_raises_nothing_for_its_own_headlines():
    """A quiet week on the feed must open no issues for figures already on file."""
    for r in DOC["rows"]:
        hit, _ = d.classify(r["headline"], r["lab"])
        if hit:
            assert d.known(hit[0], r["lab"], r["published"], DOC["rows"]), r["headline"]


def test_group_and_issue_body():
    items = [dict(title="OpenAI's annual recurring revenue nears $70B", outlet="Axios", link="https://a", published="2026-09-29",
                  lab="openai", value=70.0, qualifier="nears"),
             dict(title="OpenAI's annualized recurring revenue nears $70 billion, source says", outlet="Reuters", link="https://r",
                  published="2026-09-29", lab="openai", value=70.0, qualifier="nears")]
    groups = d.group(items)
    assert len(groups) == 1 and len(groups[0]["items"]) == 2
    body = d.issue_body(groups[0])
    assert "Key: `rev:openai:70`" in body and '"usd_bn": 70.0' in body and "https://r" in body
