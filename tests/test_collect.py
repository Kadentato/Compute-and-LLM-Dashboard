"""Tests for the collector's load-bearing logic.

Runs entirely offline: classification rules against the real mapping table,
backfill range math, and a full derive() pass over fixture raw data.
"""
import datetime as dt
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "collector"))
import collect  # noqa: E402

TABLE = collect.load_classification()


# ---------------- classification (real table) ----------------

@pytest.mark.parametrize("slug,expected", [
    ("anthropic/claude-3.5-sonnet", "closed"),
    ("openai/gpt-4o", "closed"),
    ("openai/gpt-oss-120b", "open"),          # decision: gpt-oss is open
    ("openai/gpt-oss-120b:free", "open"),     # :variant stripped
    ("google/gemini-2.5-pro", "closed"),
    ("google/gemma-3-27b-it", "open"),        # decision: gemma is open
    ("deepseek/deepseek-v4-flash-20260423", "open"),
    ("mistralai/mistral-large-2411", "closed"),   # API-only Mistral
    ("mistralai/mistral-small", "closed"),        # exact: legacy API alias
    ("mistralai/mistral-small-24b-instruct-2501", "open"),  # released weights
    ("mistralai/mistral-tiny", "open"),
    ("cohere/command-r", "open"),
    ("cohere/north-mini-code-20260617:free", "closed"),
    ("openrouter/sherlock-think-alpha", "unknown"),  # cloaked
    ("stealth/ox-alpha", "unknown"),
    ("thinkingmachines/inkling-20260715:free", "open"),  # weights on HF (table v3)
    ("dots-studio/dots-3-note-preview-20260813:free", "open"),
    ("other", "other"),                        # reserved remainder bucket
])
def test_classify_openrouter(slug, expected):
    assert collect.classify_openrouter(slug, TABLE, set()) == expected


def test_classify_openrouter_unmapped_recorded():
    unmapped = set()
    assert collect.classify_openrouter("nobody/mystery-model", TABLE, unmapped) == "unknown"
    assert "nobody/mystery-model" in unmapped


@pytest.mark.parametrize("name,expected", [
    ("Claude Opus 5", "closed"),
    ("GPT OSS 120B", "open"),
    ("GPT-9 Mega", "closed"),                 # prefix fallback for future names
    ("DeepSeek V9", "open"),
    ("MiniMax M4", "open"),                   # capitalization variant (table v2)
    ("Other", "other"),
    ("xai/grok-code-fast-1", "closed"),       # slug-style name routes via org rules
    ("inclusionai/ling-3.0-flash-free", "open"),
])
def test_classify_vercel(name, expected):
    assert collect.classify_vercel(name, TABLE, set()) == expected


def test_explanations_name_the_matching_rule():
    assert collect.explain_openrouter("openai/gpt-oss-120b", TABLE).startswith("prefix rule")
    assert collect.explain_openrouter("anthropic/claude-3.5-sonnet", TABLE).startswith("org default")
    assert collect.explain_openrouter("mistralai/mistral-small", TABLE).startswith("exact rule")
    assert collect.explain_vercel("Claude Opus 5", TABLE).startswith("exact rule")
    assert collect.explain_vercel("Unheard-of Model", TABLE) == "unmapped"


def test_table_values_are_valid_classes():
    valid = {"open", "closed", "unknown"}
    assert set(TABLE["openrouter"]["org_defaults"].values()) <= valid
    assert set(TABLE["openrouter"]["exact"].values()) <= valid
    assert set(TABLE["openrouter"]["prefix"].values()) <= valid
    assert set(TABLE["vercel"]["exact"].values()) <= valid
    assert {c for _, c in TABLE["vercel"]["prefix_rules"]} <= valid
    assert isinstance(TABLE["version"], int)


# ---------------- backfill range math ----------------

def _setup_raw(tmp_path, monkeypatch, source, dates):
    monkeypatch.setattr(collect, "RAW", str(tmp_path / "raw"))
    monkeypatch.setattr(collect, "DERIVED", str(tmp_path / "derived"))
    for iso in dates:
        collect.write_raw(source, iso, {"date": iso, "rows": []})


def test_missing_ranges_contiguity_and_chunking(tmp_path, monkeypatch):
    _setup_raw(tmp_path, monkeypatch, "vercel", ["2026-01-03", "2026-01-04"])
    ranges = collect.missing_ranges(
        "vercel", dt.date(2026, 1, 1), dt.date(2026, 1, 12), chunk=4)
    # missing: 1,2 then 5..12 split into 4-day chunks
    assert [(a.isoformat(), b.isoformat()) for a, b in ranges] == [
        ("2026-01-01", "2026-01-02"),
        ("2026-01-05", "2026-01-08"),
        ("2026-01-09", "2026-01-12"),
    ]


def test_missing_ranges_empty_when_complete(tmp_path, monkeypatch):
    _setup_raw(tmp_path, monkeypatch, "vercel", ["2026-01-01", "2026-01-02"])
    assert collect.missing_ranges(
        "vercel", dt.date(2026, 1, 1), dt.date(2026, 1, 2), chunk=10) == []


# ---------------- derive() end-to-end on fixtures ----------------

@pytest.fixture
def fixture_env(tmp_path, monkeypatch):
    monkeypatch.setattr(collect, "RAW", str(tmp_path / "raw"))
    monkeypatch.setattr(collect, "DERIVED", str(tmp_path / "derived"))
    iso = "2026-01-08"
    collect.write_raw("openrouter", iso, {"date": iso, "rows": [
        {"model_permaslug": "anthropic/claude-3.5-sonnet", "total_tokens": "600"},
        {"model_permaslug": "openai/gpt-oss-120b", "total_tokens": "300"},
        {"model_permaslug": "other", "total_tokens": "100"},
    ]})
    collect.write_raw("vercel", iso, {"date": iso, "rows": [
        {"name": "Claude Sonnet 4", "metric": "tokens", "share_percent": 50.0},
        {"name": "DeepSeek V4 Flash", "metric": "tokens", "share_percent": 30.0},
        {"name": "Other", "metric": "tokens", "share_percent": 20.0},
        {"name": "Claude Sonnet 4", "metric": "spend", "share_percent": 90.0},
        {"name": "DeepSeek V4 Flash", "metric": "spend", "share_percent": 10.0},
    ]})
    collect.write_raw("huggingface", iso, {"date": iso, "rows": [
        {"id": "Qwen/Qwen3-8B", "downloads": 500, "likes": 5},
        {"id": "trl-internal-testing/tiny-model", "downloads": 900, "likes": 1},
    ]})
    collect.write_raw("lmarena", iso, {"date": iso, "rows": [
        {"model_name": "b-model", "organization": "labB", "rating": 1400.2,
         "vote_count": 10, "rank": 2, "license": "Proprietary"},
        {"model_name": "a-model", "organization": "labA", "rating": 1500.7,
         "vote_count": 20, "rank": 1, "license": "Apache 2.0"},
    ]})
    # 8 daily cloudflare files: day 1 has an early leader + an old alias;
    # days 2-8 have the current naming. Weekly sampling picks days 1 and 8.
    for i in range(1, 9):
        d = f"2026-01-{i:02d}"
        rows = ([{"rank": 1, "service": "ChatGPT / OpenAI"},
                 {"rank": 2, "service": "Character.AI"},
                 {"rank": 3, "service": "Codeium / Windsurf AI"}] if i == 1 else
                [{"rank": 1, "service": "ChatGPT / OpenAI"},
                 {"rank": 2, "service": "Claude / Anthropic"},
                 {"rank": 3, "service": "Windsurf AI"}])
        collect.write_raw("cloudflare", d, {"date": d, "rows": rows})
    collect.derive()
    return tmp_path / "derived"


def _load(derived, name):
    with open(derived / f"{name}.json", encoding="utf-8") as f:
        return json.load(f)


def test_derive_open_share_math(fixture_env):
    day = _load(fixture_env, "open_share_daily")["days"][0]
    assert day["openrouter"] == {"open": 30.0, "closed": 60.0, "unknown": 0.0,
                                 "other": 10.0, "total_tokens": 1000, "open_models": 1}
    v = day["vercel"]
    assert (v["open"], v["closed"], v["other"], v["unknown"]) == (30.0, 50.0, 20.0, 0.0)
    assert v["spend_open"] == 10.0  # open share of classifiable spend


def test_derive_models_latest_with_why(fixture_env):
    m = _load(fixture_env, "models_latest")["openrouter"]["models"]
    assert m[0]["name"] == "anthropic/claude-3.5-sonnet"
    assert m[0]["share"] == 60.0 and m[0]["class"] == "closed"
    assert m[0]["why"].startswith("org default")
    assert all(x["name"] != "other" for x in m)  # remainder bucket excluded


def test_derive_model_histories_cover_rank_lists(fixture_env):
    h = _load(fixture_env, "model_histories")
    assert h["openrouter"]["models"]["anthropic/claude-3.5-sonnet"] == [60.0]
    assert "DeepSeek V4 Flash" in h["vercel"]["models"]


def test_derive_hf_filters_test_repos(fixture_env):
    ids = [m["id"] for m in _load(fixture_env, "hf_top")["models"]]
    assert ids == ["Qwen/Qwen3-8B"]


def test_derive_lmarena_sorted_by_rank(fixture_env):
    models = _load(fixture_env, "lmarena_top")["models"]
    assert [m["name"] for m in models] == ["a-model", "b-model"]
    assert models[0]["rating"] == 1501  # rounded


def test_derive_consumer_aliases_and_history(fixture_env):
    c = _load(fixture_env, "consumer_rankings")
    names = [s["name"] for s in c["series"]]
    assert "Character.AI" in names                # past top-4 leader kept
    assert "Windsurf AI" in names                 # Codeium alias merged
    assert "Codeium" not in names
    windsurf = next(s for s in c["series"] if s["name"] == "Windsurf AI")
    assert windsurf["ranks"] == [3, 3]            # rank carried across the alias
    assert "Claude" in names


def test_derive_writes_no_status(fixture_env):
    # status.json is written by fetch runs only, never by derive
    assert not (fixture_env / "status.json").exists()
