"""Tests for the GPU collector's load-bearing logic.

Runs entirely offline against synthetic offer sets. The panel logic is what keeps
a roster change from being reported as a price change, so it is tested directly
rather than through the file it produces.
"""
import json
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "collector"))
import collect_gpu as G  # noqa: E402


def offer(prov, px, gpu="H100", rt="on_demand", avail="available"):
    return {"provider": prov, "usd_per_gpu_hour": px, "gpu": gpu,
            "rental_type": rt, "availability": avail}


def capture(offers):
    return {"offers": offers}


# ---------------- provider panel ----------------

def test_panel_keeps_steady_drops_churner():
    steady = [offer("A", 3.0), offer("B", 2.0), offer("C", 4.0)]
    raws = [capture(steady + [offer("Churn", 1.0)]) if i % 2 else capture(steady)
            for i in range(6)]
    panels, dropped = G.provider_panels(raws, min_frac=0.8)
    assert panels[("H100", "on_demand")] == {"A", "B", "C"}
    assert dropped[("H100", "on_demand")] == ["Churn (3/6)"]


def test_panel_threshold_is_inclusive():
    """Present on exactly min_frac of captures stays in — the boundary is a keep."""
    raws = [capture([offer("A", 3.0)] + ([offer("B", 2.0)] if i < 4 else []))
            for i in range(5)]
    panels, _ = G.provider_panels(raws, min_frac=0.8)
    assert panels[("H100", "on_demand")] == {"A", "B"}


def test_panel_denominator_is_captures_of_that_market():
    """A GPU listed for the first time halfway through is judged on its own
    captures, not the length of the run, so a new market is not empty for months."""
    raws = [capture([offer("A", 3.0)]) for _ in range(4)]
    raws += [capture([offer("A", 3.0), offer("N", 9.0, gpu="B200")]) for _ in range(2)]
    panels, _ = G.provider_panels(raws, min_frac=0.8)
    assert panels[("B200", "on_demand")] == {"N"}


def test_panel_ignores_unavailable_listings():
    raws = [capture([offer("A", 3.0), offer("Ghost", 1.0, avail="unavailable")])
            for _ in range(5)]
    panels, _ = G.provider_panels(raws, min_frac=0.8)
    assert panels[("H100", "on_demand")] == {"A"}


# ---------------- dispersion ----------------

def test_dispersion_keep_filters_to_panel():
    raw = capture([offer("A", 3.0), offer("B", 2.0), offer("C", 4.0), offer("Out", 0.5)])
    panel = {("H100", "on_demand"): {"A", "B", "C"}}
    d = G.dispersion(raw, keep=panel)["H100"]["on_demand"]
    assert d["providers"] == 3
    assert d["min"] == 2.0          # the 0.5 outlier is excluded
    assert d["median"] == 3.0


def test_dispersion_unfiltered_matches_full_panel():
    raw = capture([offer("A", 3.0), offer("B", 2.0), offer("C", 4.0)])
    everyone = {("H100", "on_demand"): {"A", "B", "C"}}
    assert G.dispersion(raw) == G.dispersion(raw, keep=everyone)


def test_dispersion_percentiles_are_over_provider_medians():
    """One venue listing many offers must not dominate the percentile — the
    reason these are taken across provider medians rather than raw offers."""
    raw = capture([offer("Vast", 1.0) for _ in range(20)] + [offer("A", 3.0), offer("B", 5.0)])
    d = G.dispersion(raw)["H100"]["on_demand"]
    assert d["providers"] == 3
    assert d["offers"] == 22
    assert d["median"] == 3.0       # not ~1.0, which offer-level would give


# ---------------- forward curve shape ----------------

def test_forward_shape_backwardation():
    curve = {"tenors_months": [0, 12, 36],
             "gpus": {"h100": {"fwd": [2.00, 1.60, 1.00], "term": [0, 0, 0]}}}
    s = G.forward_shape(curve)["h100"]
    assert s["spot"] == 2.00
    assert s["bw12_pct"] == -20.0
    assert s["bw36_pct"] == -50.0


def test_forward_shape_handles_missing_tenor_and_dead_spot():
    curve = {"tenors_months": [0, 12],
             "gpus": {"h100": {"fwd": [2.0, 1.5]}, "dead": {"fwd": [0, 1.0]}}}
    out = G.forward_shape(curve)
    assert out["h100"]["m36"] is None and out["h100"]["bw36_pct"] is None
    assert "dead" not in out        # no spot, no basis for a percentage


# ---------------- history file ----------------

def test_build_history_is_dated_and_carries_both_bases(tmp_path):
    steady = [offer("A", 3.0), offer("B", 2.0), offer("C", 4.0)]
    for i, day in enumerate(["2026-09-01", "2026-09-02", "2026-09-03"]):
        rows = steady + ([offer("Churn", 0.5)] if i == 2 else [])
        (tmp_path / (day + ".json")).write_text(json.dumps(capture(rows)), encoding="utf-8")
    files = sorted(tmp_path.glob("*.json"))

    out_hist = tmp_path / "gpu_history.json"
    real = G.OUT_HIST
    G.OUT_HIST = out_hist
    try:
        h = G.build_history(files, [])
    finally:
        G.OUT_HIST = real

    assert sorted(h["dispersion"]) == ["2026-09-01", "2026-09-02", "2026-09-03"]
    last = h["dispersion"]["2026-09-03"]["H100"]["on_demand"]
    # the panel excludes the one-day entrant; the all-provider figure still sees it
    assert last["providers"] == 3 and last["min"] == 2.0
    assert last["providers_all"] == 4
    assert json.loads(out_hist.read_text(encoding="utf-8"))["panel_min_frac"] == G.PANEL_MIN_FRAC


# ---------------- write_if_changed ----------------

def test_write_if_changed_ignores_timestamps(tmp_path):
    """Same data, new fetch stamp: the file is left alone and keeps its first
    stamp. This is what lets the workflow's `git diff --cached --quiet` be true."""
    p = tmp_path / "x.json"
    assert G.write_if_changed(p, {"fetched_at_utc": "05:19", "v": 1}) is True
    before = p.read_text(encoding="utf-8")
    assert G.write_if_changed(p, {"fetched_at_utc": "21:41", "v": 1}) is False
    assert p.read_text(encoding="utf-8") == before


def test_write_if_changed_writes_real_changes(tmp_path):
    p = tmp_path / "x.json"
    G.write_if_changed(p, {"generated_at": "t1", "v": 1})
    assert G.write_if_changed(p, {"generated_at": "t2", "v": 2}) is True
    assert json.loads(p.read_text(encoding="utf-8"))["v"] == 2


def test_write_if_changed_overwrites_corrupt_file(tmp_path):
    p = tmp_path / "x.json"
    p.write_text("{not json", encoding="utf-8")
    assert G.write_if_changed(p, {"v": 1}) is True
    assert json.loads(p.read_text(encoding="utf-8")) == {"v": 1}


# ---------------- derive() isolation ----------------

@pytest.fixture
def empty_archive(tmp_path, monkeypatch):
    for name in ("RAW_ORNN", "RAW_SD", "RAW_GPUSIO", "RAW_KALSHI", "RAW_SDFWD"):
        d = tmp_path / name.lower()
        d.mkdir()
        monkeypatch.setattr(G, name, d)
    monkeypatch.setattr(G, "OUT", tmp_path / "gpu_live.json")
    monkeypatch.setattr(G, "OUT_HIST", tmp_path / "gpu_history.json")
    return tmp_path


def test_derive_survives_history_failure(empty_archive, monkeypatch, capsys):
    """A bug in the derived history must not turn the run red: the live snapshot
    is already written, and the next run rebuilds history from raw anyway."""
    def boom(*a, **k):
        raise RuntimeError("history broke")
    monkeypatch.setattr(G, "build_history", boom)
    G.derive()
    assert (empty_archive / "gpu_live.json").exists()
    assert "FAIL gpu_history" in capsys.readouterr().err


def test_derive_on_empty_archive(empty_archive):
    """First run ever: no raw at all still produces both files."""
    G.derive()
    assert (empty_archive / "gpu_live.json").exists()
    assert (empty_archive / "gpu_history.json").exists()


# ---------------- workflow ----------------

def test_workflow_stages_directories_not_files():
    """A file named in `git add` is committed only while someone remembers to list
    it. Twice an output was written by every run and committed by none: the raw
    tree on 2026-09-01, and gpu_history.json would have been next."""
    wf = os.path.join(os.path.dirname(__file__), "..", ".github", "workflows", "collect-gpu.yml")
    with open(wf, encoding="utf-8") as f:
        adds = re.findall(r"^\s*git add (.+)$", f.read(), re.M)
    assert adds, "no git add line in collect-gpu.yml"
    for line in adds:
        for tok in line.split():
            assert "." not in os.path.basename(tok), "workflow stages a named file: " + tok
