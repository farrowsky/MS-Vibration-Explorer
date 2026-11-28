"""The thesis hand calcs (Appendix pp. 158-196) against the tool: every value matches, except the hand-calc slips
listed in tools/check_hand_calcs.py (KNOWN), each explained there and in docs/HAND_CALCS.md."""
import importlib.util
import os

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('check_hand_calcs', os.path.join(REPO, 'tools', 'check_hand_calcs.py'))
hc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hc)


@pytest.fixture(scope='module')
def rows():
    return hc.compare()[0]


def test_hand_calcs_match_the_tool(rows):
    unexplained = [r for r in rows if r[4] != '✓' and not r[5]]
    assert not unexplained, unexplained
    assert sum(r[4] == '✓' for r in rows) >= 360


def test_known_slips_are_still_slips(rows):
    # if one of these ever starts to match, the note in KNOWN is stale and should go
    for key in hc.KNOWN:
        row = next(r for r in rows if (r[0], r[1]) == key)
        assert row[4] != '✓', key
