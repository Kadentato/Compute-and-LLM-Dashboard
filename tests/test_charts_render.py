"""Runs the compute renderer across forced data states (tests/charts_render.test.js) under pytest."""
import shutil, subprocess, pathlib, pytest


def test_compute_renderer_runs_in_every_data_state():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not on the path")
    root = pathlib.Path(__file__).resolve().parent.parent
    r = subprocess.run([node, str(root / "tests" / "charts_render.test.js")], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stdout[-1500:] + r.stderr[-1500:]
    assert "render states passed" in r.stdout
