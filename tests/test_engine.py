"""
The tool shows the paper's solver's own numbers.

    python -m pytest -q
    MSVE_RELEASE=<path to MS-Vibration-Code> python -m pytest -q     (adds the published-CSV check)
"""
import hashlib
import math
import os
import random

import pandas as pd
import pytest

from server import engine as eng
from tests.packed import Packed

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = dict(girder_span=30, infill_span=30, conc_type=0, deck_type=3, clear_spans=3, building_use=3,
            percent_comp=50, floor_length=200, floor_width=200)
STATES = ['initial', 'infill', 'girder', 'conc', 'steel', 'best']


def close(a, b, rel):
    return abs(a - b) <= rel * max(1.0, abs(a), abs(b))


# ---------------------------------------------------------------------------
def test_engine_files_are_the_published_ones():
    with open(os.path.join(REPO, 'engine', 'paper', 'SHA256SUMS')) as fh:
        for line in fh:
            digest, name = line.strip().split('  ', 1)
            with open(os.path.join(REPO, 'engine', 'paper', name), 'rb') as f:
                assert hashlib.sha256(f.read()).hexdigest() == digest, name


def test_solver_cell_is_loaded_unmodified():
    import json
    for system, nb in eng.NOTEBOOKS.items():
        e = eng.get_engine(system)
        with open(os.path.join(REPO, 'engine', 'paper', nb), encoding='utf-8') as fh:
            cells = [''.join(c['source']) for c in json.load(fh)['cells'] if c['cell_type'] == 'code']
        solver = next(c for c in cells if 'def sizer_and_calc' in c)
        assert e.source == solver


CASES = [
    ('composite', {}),
    ('composite', dict(girder_span=44, infill_span=26, deck_type=1.5, conc_type=1, percent_comp=25, building_use=1)),
    ('composite', dict(girder_span=18, infill_span=40, deck_type=2, percent_comp=75)),
    ('composite', dict(girder_span=55, infill_span=40)),
    # best design comes from added topping: the known Infill Case Label quirk shows on 'best' too
    ('composite', dict(girder_span=34, infill_span=46, deck_type=1.5, percent_comp=75)),
    ('noncomposite', {}),
    ('noncomposite', dict(girder_span=36, infill_span=24, deck_type=1.5, conc_type=1)),
    ('noncomposite', dict(girder_span=12, infill_span=48, deck_type=2)),
]


@pytest.mark.parametrize('system,patch', CASES)
def test_capture_validates(system, patch):
    p = dict(BASE, **patch)
    out = eng.get_engine(system).design(p)
    assert out['ok']
    for name, st in out['states'].items():
        if st['_applies']:
            assert name in out['captured'], name
    for name, cap in out['captured'].items():
        v = cap['validation']
        assert v['all_ok'], (name, [c for c in v['checks'] if c['ok'] is False and not c.get('known_quirk')])
        assert v['n'] >= 10
        rc = cap['recheck']
        assert rc['n_bad'] == 0, (name, {k: r for k, r in rc['lines'].items() if r[0] is False})
        assert rc['n_ok'] > (200 if system == 'composite' else 100)


def test_check_mode_reads_the_requested_pair():
    out = eng.get_engine('composite').design(BASE, mode='check', infill_shape='W16X26', girder_shape='W24X55')
    cap = out['captured']['check']
    assert eng.get_engine('composite').shapes[cap['r']] == 'W16X26'
    assert eng.get_engine('composite').shapes[cap['c']] == 'W24X55'
    assert cap['recheck']['n_bad'] == 0
    # the conc-path state of this design selects the same pair, so the two captures must agree
    conc = out['captured'].get('conc')
    if conc and conc['additional_topping'] == 0:
        assert math.isclose(conc['values']['peak_acceleration'], cap['values']['peak_acceleration'])


def _compare_state(out, ds, r, key):
    st = out['states'][key]
    pub_inf = ds.shape(f'{key}.inf', r)
    if not st['_applies']:
        assert pub_inf is None, key
        return 0
    assert st['Infill Sizes'] == pub_inf, key
    assert st['Girder Sizes'] == ds.shape(f'{key}.gir', r), key
    assert close(st['Peak Acceleration'], ds.get(f'{key}.pa', r), 2e-6), key
    assert close(st['Fundamental Frequency'], ds.get(f'{key}.fn', r), 2e-6), key
    assert close(st['Embodied Carbon Scaled'] / eng.LB_TO_KG, ds.get(f'{key}.ec', r), 2e-6), key
    return 1


@pytest.mark.parametrize('system', ['composite', 'noncomposite'])
def test_matches_packed_published_dataset(system):
    ds = Packed(system)
    rng = random.Random(2026)
    e = eng.get_engine(system)
    n = 0
    for r in rng.sample(range(ds.n), 5):
        p = dict(BASE, girder_span=int(ds.get('g', r)), infill_span=int(ds.get('i', r)), conc_type=int(ds.get('conc', r)),
                 deck_type=ds.get('deck', r), percent_comp=int(ds.get('pcc', r)) or 50)
        out = e.design(p, capture=False)
        for key in STATES:
            n += _compare_state(out, ds, r, key)
        assert out['condition_class'] == int(ds.get('method_raw', r))
    assert n >= 10


RELEASE = os.environ.get('MSVE_RELEASE')


@pytest.mark.skipif(not RELEASE, reason='set MSVE_RELEASE to the MS-Vibration-Code folder')
@pytest.mark.parametrize('system', ['composite', 'noncomposite'])
def test_matches_published_csv(system):
    df = pd.read_csv(os.path.join(RELEASE, 'data', 'imperial', f'{system}_results_imperial.csv'))
    df.columns = [c.split(' (')[0] for c in df.columns]
    e = eng.get_engine(system)
    for _, row in df.sample(6, random_state=7).iterrows():
        p = dict(BASE, girder_span=int(row['Girder Span']), infill_span=int(row['Infill Span']),
                 conc_type=int(row['Conc_Type_num']), deck_type=float(row['Deck_Type']),
                 percent_comp=int(row.get('Percent Composite Connection', 50)))
        out = e.design(p, capture=False)
        for key, prefix in (('initial', 'Initial'), ('best', 'Best')):
            st = out['states'][key]
            assert close(st['Peak Acceleration'], row[f'{prefix} Peak Acceleration'], 1e-9)
            assert close(st['Embodied Carbon Scaled'] / eng.LB_TO_KG, row[f'{prefix} EC_Scaled'], 1e-9)
            assert str(row[f'{prefix} Infill Size']).startswith(st['Infill Sizes'])
        assert out['condition_class'] == int(row['Best Method old'])


# ---------------------------------------------------------------------------
# user overrides (beam count, slab depth): a separate copy of the solver
def test_user_variant_is_published_solver_when_unset():
    base = eng.get_engine('composite').design(BASE, capture=False)
    user = eng.get_engine('composite', 'user').design(dict(BASE), capture=False)
    for key in STATES:
        a, b = base['states'][key], user['states'][key]
        assert a['_applies'] == b['_applies']
        if a['_applies']:
            assert a['Infill Sizes'] == b['Infill Sizes'] and a['Girder Sizes'] == b['Girder Sizes']
            assert a['Peak Acceleration'] == b['Peak Acceleration']
            assert a['Embodied Carbon Scaled'] == b['Embodied Carbon Scaled']


@pytest.mark.parametrize('system', ['composite', 'noncomposite'])
def test_user_overrides_apply_and_validate(system):
    e = eng.get_engine(system, 'user')
    out = e.design(dict(BASE, num_infill=3, slab_total=6.5))
    assert out['ok'] and out['variant']['infill_count'] == 3 and out['variant']['slab_total'] == 6.5
    v = out['captured']['initial']['values']
    assert v['NumInfill'] == 3 and v['selected_deck_slab_thickness'] == 6.5
    for cap in out['captured'].values():
        assert cap['recheck']['n_bad'] == 0
        if 'validation' in cap:
            assert cap['validation']['all_ok']


# member check: camber and studs set by the user (composite)
PAIR = dict(infill_shape='W16X26', girder_shape='W24X55')


def test_member_overrides_unset_match_published():
    a = eng.get_engine('composite').design(BASE, mode='check', **PAIR)['captured']['check']['values']
    b = eng.get_engine('composite', 'user').check_pair(dict(BASE), **PAIR)['captured']['check']['values']
    for k, v in a.items():
        if not isinstance(v, (dict, list)):
            assert eng._same(v, b[k]), k


def test_member_overrides_apply_and_recheck():
    e = eng.get_engine('composite', 'user')
    out = e.check_pair(dict(BASE, camber_infill=0.5, camber_girder=0, studs_infill=20, studs_girder=30), **PAIR)
    cap = out['captured']['check']
    v = cap['values']
    assert v['camber_II'] == 0.5 and v['camber_IG'] == 0
    assert v['min_req_studs_II'] == 20 and v['min_req_studs_IG'] == 30
    # sum Qn = half the studs x Qn for the studs-per-rib the solver's rib rule gives, capped at V'
    qn = v['Qn_II'][int(v['min_studs_per_rib_II']) - 1]
    assert math.isclose(v['Sigma_Qn_II'], min(10 * qn, v['V_prime_II']))
    assert math.isclose(v['DEF_CDL_II'], v['DEF_Con_II'] - 0.5)
    assert cap['recheck']['n_bad'] == 0
    # too few studs for 25 % composite, and more than the ribs hold
    assert e.check_pair(dict(BASE, studs_infill=0), **PAIR)['captured']['check']['values']['PCC_check_II'] is False
    assert e.check_pair(dict(BASE, studs_infill=200), **PAIR)['captured']['check']['values']['min_req_studs_II'] is None
