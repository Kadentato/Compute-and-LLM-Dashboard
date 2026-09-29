"""Runs every tests/*.test.js suite under pytest, so CI runs them without listing each one.

Each suite drives code that ships on the site (the overview's accruing-series line, the
compute renderer, the lab-revenue chart) and exits non-zero on failure."""
import pathlib
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
SUITES = sorted((ROOT / "tests").glob("*.test.js"))


@pytest.mark.parametrize("suite", SUITES, ids=[s.name for s in SUITES])
def test_node_suite(suite):
    node = shutil.which("node")
    if not node:
        pytest.skip("node is not on the path")
    r = subprocess.run([node, str(suite)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]
