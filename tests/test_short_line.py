"""Runs the overview's accruing-series scenarios (tests/short_line.test.js) under pytest."""
import shutil, subprocess, pathlib, pytest


def test_short_line_scenarios():
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not on the path")
    root = pathlib.Path(__file__).resolve().parent.parent
    r = subprocess.run([node, str(root / "tests" / "short_line.test.js")], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stdout[-1500:] + r.stderr[-1500:]
    assert "scenarios passed" in r.stdout
