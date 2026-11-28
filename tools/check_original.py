"""
The tool against the original release code, run independently.

    python tools/check_original.py --release ../MS-Vibration-Code [--lhs 100] [--boundary 100] [--out docs/ORIGINAL_CODE_CHECK.md]

ORIGINAL side: the notebooks in the MS-Vibration-Code release folder, their code cells executed in a fresh namespace
from that folder, with nothing from this repository (no proxy, no patch, no capture code). sizer_and_calc() is called
directly. For a member check, the values at one infill/girder pair are read with sys.setprofile at the return of
mitigation_method() and indexed here, a different mechanism from the tool's sys.monitoring capture.

TOOL side: server/service.py, the code path the web page and the in-browser engine use.

1. Latin hypercube (--lhs N), Optimize: N points over every input (system, both spans 6-60 ft, concrete, deck,
   composite %, occupancy, deck construction spans, floor size 20-2000 ft). Every design state the original returns
   (members, studs, topping, a_p, f_n, EC ..., every scalar column of the selected row, and every step of the upsizing
   paths) and the method code are compared with the tool's.
2. Boundary conditions (--boundary N), Custom design:
   a. inputs at their limits with the lightest, heaviest and mid-range members: every captured value at the pair is
      compared with the original's;
   b. the tool's overrides (beam count, slab depth, camber, studs) set to the solver's own values: the result must
      equal the original's (the override patch changes nothing else);
   c. overrides at their limits: the original cannot set these; the tool must apply exactly the value given, and its
      line-by-line re-run of the solver must reproduce every value.
"""
import argparse
import contextlib
import io
import json
import math
import os
import sys
import time
import warnings

import numpy as np
import pandas as pd

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
from server import service as svc  # noqa: E402

NOTEBOOKS = {'composite': 'Composite MS Code.ipynb', 'noncomposite': 'Non-Composite MS Code.ipynb'}
STATE_NAMES = ['initial', 'infill', 'girder', 'conc', 'steel', 'best']
STATE_ROW = {'initial': 0, 'infill': -1, 'girder': -1, 'conc': -1, 'steel': 0, 'best': -1}   # the row each frame reports


# ---------------------------------------------------------------------------------------------------------------------
# the original code, untouched
class Original:
    def __init__(self, release, system):
        self.release = release
        with open(os.path.join(release, NOTEBOOKS[system]), encoding='utf-8') as fh:
            nb = json.load(fh)
        cells = []
        for c in nb['cells']:
            if c.get('cell_type') == 'code':
                cells.append(''.join(c['source']))
                if 'def sizer_and_calc' in cells[-1]:
                    break
        self.ns = {'__name__': f'original_{system}'}
        with self._here(), warnings.catch_warnings():
            warnings.simplefilter('ignore')
            exec(compile('\n'.join(cells), f'<original {NOTEBOOKS[system]}>', 'exec'), self.ns)
        db = pd.read_csv(os.path.join(release, 'AISC STEEL MANUAL V16 (Modified) Sorted.csv'), encoding='latin1')
        self.shapes = [str(x) for x in db[db['Type'] == 'W']['AISC_Manual_Label']]
        self.composite = system == 'composite'

    @contextlib.contextmanager
    def _here(self):
        cwd = os.getcwd()
        os.chdir(self.release)                          # the notebooks read their tables by bare file name
        try:
            yield
        finally:
            os.chdir(cwd)

    def call(self, kw, watch_pair=None):
        """Run sizer_and_calc; with watch_pair=(infill, girder) also return mitigation_method's locals at that pair
        (first call with no added topping), read with sys.setprofile."""
        seen = []

        def prof(frame, event, arg):
            if event == 'return' and frame.f_code.co_name == 'mitigation_method' and not seen:
                loc = frame.f_locals
                if float(np.asarray(loc.get('Additional_Topping', 0)).ravel()[0]) == 0.0:
                    seen.append(dict(loc))
        with self._here(), warnings.catch_warnings(), contextlib.redirect_stdout(io.StringIO()), np.errstate(all='ignore'):
            warnings.simplefilter('ignore')
            if watch_pair:
                sys.setprofile(prof)
            try:
                res = self.ns['sizer_and_calc'](**kw)
            finally:
                sys.setprofile(None)
        pair = None
        if watch_pair and seen:
            r, c = self.shapes.index(watch_pair[0]), self.shapes.index(watch_pair[1])
            pair = {}
            for k, v in seen[0].items():
                x = reduce_at(v, r, c, len(self.shapes))
                if x is not None:
                    pair[k] = x
        return res, pair


def reduce_at(v, r, c, n):
    """A local at one infill (row r) / girder (column c) pair, when its shape says unambiguously which entry that is."""
    if isinstance(v, (bool, np.bool_)):
        return bool(v)
    if isinstance(v, (int, float, np.integer, np.floating)):
        return float(v)
    if isinstance(v, np.ndarray) and v.dtype.kind in 'biuf':
        if v.ndim == 0:
            return v.item()
        if v.shape == (n, n):
            return v[r, c].item()
        if v.shape == (n, 1):
            return v[r, 0].item()
        if v.shape == (1, n):
            return v[0, c].item()
        if v.size == 1:
            return v.ravel()[0].item()
    return None


def kwargs(p):
    kw = dict(Girder_Span=int(p['girder_span']), Infill_Span=int(p['infill_span']), Conc_Type_num=int(p['conc_type']),
              Deck_Type=p['deck_type'], Clear_Spans=int(p['clear_spans']), Building_Use_num=int(p['building_use']),
              floor_length=float(p['floor_length']), floor_width=float(p['floor_width']))
    kw['Deck_Type'] = 1.5 if p['deck_type'] == 1.5 else int(p['deck_type'])
    if p['system'] == 'composite':
        kw['percent_comp'] = int(p['percent_comp'])
    return kw


# ---------------------------------------------------------------------------------------------------------------------
def same(a, b, rel=1e-9):
    nanlike = lambda x: x is None or (isinstance(x, float) and math.isnan(x))   # noqa: E731  NaN is written as null in JSON
    if nanlike(a) and nanlike(b):
        return True
    if isinstance(a, (bool, np.bool_)) or isinstance(b, (bool, np.bool_)):
        return bool(a) == bool(b)
    if isinstance(a, str) or isinstance(b, str):
        return str(a) == str(b)
    try:
        fa, fb = float(a), float(b)
    except (TypeError, ValueError):
        return a == b
    if math.isnan(fa) and math.isnan(fb):
        return True
    return abs(fa - fb) <= rel * max(1.0, abs(fa), abs(fb))


def clean(x):
    if isinstance(x, np.generic):
        x = x.item()
    if isinstance(x, float) and math.isnan(x):
        return None
    return x


def tool_design(p, **extra):
    req = svc.check_request(svc.DesignRequest(**{**p, **extra}))
    return json.loads(svc.run(req))


def compare_optimize(orig, p):
    """Original sizer_and_calc vs the tool, Optimize. Returns (n_compared, [mismatches], note)."""
    res, _ = orig.call(kwargs(p))
    t = tool_design(p, mode='optimize')
    if res is None or not t.get('ok'):
        agree = (res is None) == (not t.get('ok'))
        return 1, ([] if agree else [('no design', res is None, t.get('ok'))]), 'no design (both)' if agree and res is None else ''
    n, bad = 0, []
    frames = dict(zip(STATE_NAMES, res[:6]))
    for nm in STATE_NAMES:
        df, rec = frames[nm], t['states'][nm]
        row = df.iloc[STATE_ROW[nm]]
        for col in df.columns:
            v = row[col]
            if isinstance(v, (list, dict, np.ndarray)) or col not in rec:
                continue
            n += 1
            if not same(clean(v), rec[col]):
                bad.append((nm, col, clean(v), rec[col]))
        if '_path' in rec:                               # every step of the upsizing path
            n += 1
            if len(rec['_path']) != len(df):
                bad.append((nm, 'path length', len(df), len(rec['_path'])))
            for i, (_, rr) in enumerate(df.iterrows()):
                for k, tv in rec['_path'][i].items() if i < len(rec['_path']) else []:
                    n += 1
                    if not same(clean(rr.get(k)), tv):
                        bad.append((nm, f'path[{i}].{k}', clean(rr.get(k)), tv))
    n += 1
    if int(res[6]) != t['condition_class']:
        bad.append(('method', 'condition class', int(res[6]), t['condition_class']))
    return n, bad, f"{t['method']}: best {t['states']['best']['Infill Sizes']} / {t['states']['best']['Girder Sizes']}"


def compare_check(orig, p, infill, girder, extra=None, expect=None):
    """Member check. Original locals at the pair (sys.setprofile) vs the tool's captured values."""
    res, pair = orig.call(kwargs(p), watch_pair=(infill, girder))
    t = tool_design(p, mode='check', infill_shape=infill, girder_shape=girder, **(extra or {}))
    if not t.get('ok') or pair is None:
        agree = (res is None) == (not t.get('ok'))
        return 1, ([] if agree else [('run', 'no design', res is None, t.get('ok'))]), 'no design (both)' if agree else ''
    vals = t['captured']['check']['values']
    n, bad = 0, []
    for k, ov in pair.items():
        if k not in vals:
            continue
        tv = vals[k]
        if isinstance(tv, list):
            if len(tv) != 1:
                continue
            tv = tv[0]
        if isinstance(tv, (dict, str)):
            continue
        n += 1
        if not same(ov, tv):
            bad.append(('pair', k, ov, tv))
    rc = t['captured']['check']['recheck']
    note = f"{n} values at the pair; re-run {rc['n_ok']} ok / {rc['n_bad']} differ"
    return n, bad, note


def compare_override_limits(p, infill, girder, extra):
    """No original exists for these: the tool must apply exactly the value given and reproduce every line."""
    t = tool_design(p, mode='check', infill_shape=infill, girder_shape=girder, **extra)
    if not t.get('ok'):
        return 1, [], 'no design: ' + (t.get('error') or '')[:90]
    v = t['captured']['check']['values']
    one = lambda x: x[0] if isinstance(x, list) and len(x) == 1 else x   # noqa: E731
    n, bad = 0, []
    applied = {
        'num_infill': ('NumInfill', lambda want, got: got == want),
        'slab_total': ('Final_Deck_Slab_Thickness', lambda want, got: same(want, got)),
        'camber_infill': ('camber_II', lambda want, got: same(want, got)),
        'camber_girder': ('camber_IG', lambda want, got: same(want, got)),
        'studs_infill': ('min_req_studs_II', lambda want, got: same(want, got)),
        'studs_girder': ('min_req_studs_IG', lambda want, got: same(want, got)),
    }
    for k, want in extra.items():
        var, ok = applied[k]
        got = one(v.get(var))
        n += 1
        if not ok(want, got):
            bad.append(('override', f'{k} -> {var}', want, got))
    for m, k in (('II', 'studs_infill'), ('IG', 'studs_girder')):     # typed studs set SigmaQn = min(studs/2 x Qn, V')
        if k in extra:
            n += 1
            want = min(extra[k] / 2 * one(v[f'selected_Qn_{m}']), one(v[f'V_prime_{m}']))
            if not same(want, one(v[f'Sigma_Qn_{m}']), 1e-6):
                bad.append(('override', f'SigmaQn_{m} = min(studs/2 x Qn, Vprime)', want, one(v[f'Sigma_Qn_{m}'])))
    if 'num_infill' in extra:
        n += 1
        if not same(v['infill_spacing'], p['girder_span'] / (extra['num_infill'] + 1)):
            bad.append(('override', 'infill spacing = Lg / (N + 1)', p['girder_span'] / (extra['num_infill'] + 1), v['infill_spacing']))
    rc = t['captured']['check']['recheck']
    n += 1
    if rc['n_bad']:
        bad.append(('re-run', 'lines that differ', 0, rc['n_bad']))
    return n, bad, f"applied; re-run {rc['n_ok']} ok / {rc['n_bad']} differ"


# ---------------------------------------------------------------------------------------------------------------------
def lhs(n, dims, seed):
    """Latin hypercube: n points in [0, 1)^dims, one per stratum in every dimension."""
    rng = np.random.default_rng(seed)
    u = (rng.random((n, dims)) + np.arange(n)[:, None]) / n
    for j in range(dims):
        u[:, j] = u[rng.permutation(n), j]
    return u


def pick(u, options):
    return options[min(len(options) - 1, int(u * len(options)))]


def lhs_points(n, seed=2026):
    pts = []
    for row in lhs(n, 10, seed):
        system = pick(row[0], ['composite', 'noncomposite'])
        pts.append(dict(system=system, girder_span=int(round(6 + row[1] * 54)), infill_span=int(round(6 + row[2] * 54)),
                        conc_type=pick(row[3], [0, 1]), deck_type=pick(row[4], [1.5, 2, 3]),
                        percent_comp=pick(row[5], list(range(25, 95, 5))), building_use=pick(row[6], [1, 2, 3, 4]),
                        clear_spans=pick(row[7], [1, 2, 3]), floor_length=float(round(20 * 100 ** row[8])),
                        floor_width=float(round(20 * 100 ** row[9]))))
    return pts


def boundary_cases(origs, n):
    """Custom-design cases at the limits: inputs, members and the tool's overrides."""
    shapes = origs['composite'].shapes
    db = pd.read_csv(os.path.join(origs['composite'].release, 'AISC STEEL MANUAL V16 (Modified) Sorted.csv'), encoding='latin1')
    w = db[db['Type'] == 'W'].set_index('AISC_Manual_Label')['W']
    light, heavy = w.idxmin(), w.idxmax()
    cases = []
    # a. inputs at their limits, lightest / heaviest / mid members
    corners = []
    for system in ['composite', 'noncomposite']:
        for g in [6, 10, 50, 60]:
            for i in [6, 60]:
                for deck in [1.5, 3]:
                    corners.append(dict(system=system, girder_span=g, infill_span=i, conc_type=(g + i) // 6 % 2, deck_type=deck,
                                        percent_comp=25 if g < 30 else 90, building_use=1 if i < 30 else 4,
                                        clear_spans=1 if deck == 1.5 else 3, floor_length=20.0 if g == 6 else 2000.0,
                                        floor_width=2000.0 if i == 60 else 20.0))
    for system in ['composite', 'noncomposite']:          # 2" deck at the span extremes
        for g in [6, 60]:
            for i in [6, 60]:
                corners.append(dict(system=system, girder_span=g, infill_span=i, conc_type=1, deck_type=2, percent_comp=50,
                                    building_use=2, clear_spans=2, floor_length=200.0, floor_width=200.0))
    members = [(light, light), (heavy, heavy), (light, heavy), ('W16X26', 'W24X55')]
    for k, p in enumerate(corners[:40]):
        inf, gir = members[k % len(members)]
        cases.append(('a', p, inf, gir, None))
    # b. overrides equal to the solver's own values (patched copy must equal the original)
    base = [dict(system='composite', girder_span=g, infill_span=i, conc_type=c, deck_type=d, percent_comp=pc, building_use=3,
                 clear_spans=3, floor_length=200.0, floor_width=200.0)
            for g, i, c, d, pc in [(10, 10, 0, 1.5, 25), (50, 50, 1, 3, 75), (30, 30, 0, 3, 50), (20, 45, 1, 2, 50), (45, 20, 0, 3, 25),
                                   (12, 48, 1, 1.5, 75), (48, 12, 0, 2, 50), (25, 35, 1, 3, 25), (35, 25, 0, 2, 75), (40, 40, 1, 3, 50)]]
    for p in base:
        cases.append(('b', p, None, None, 'own'))
    for p in base:
        cases.append(('b', {**p, 'system': 'noncomposite'}, None, None, 'own'))
    for p in base:
        cases.append(('b', p, None, None, 'own-member'))
    # c. overrides at their limits
    limit_sets = [{'num_infill': 1}, {'num_infill': 14}, {'camber_infill': 0, 'camber_girder': 0}, {'camber_infill': 4, 'camber_girder': 4},
                  {'studs_infill': 0, 'studs_girder': 0}, {'studs_infill': 'max', 'studs_girder': 'max'}, {'slab_total': 'min'},
                  {'slab_total': 'max'}, {'num_infill': 14, 'slab_total': 'max'}, {'num_infill': 1, 'camber_infill': 4, 'studs_girder': 'max'}]
    for p in base[:3]:
        for ov in limit_sets:
            cases.append(('c', p, None, None, ov))
    return cases[:n]


def run_boundary(origs, n, log):
    rows = []
    slab_opts = svc.eng.slab_options()
    for k, (grp, p, inf, gir, ov) in enumerate(boundary_cases(origs, n)):
        t0 = time.perf_counter()
        orig = origs[p['system']]
        if grp == 'a':
            cnt, bad, note = compare_check(orig, p, inf, gir)
            what = f'{inf} / {gir}'
        else:
            opt = tool_design(p, mode='optimize')
            if not opt.get('ok'):
                rows.append((grp, p, '-', 1, [], 'no design for the base inputs')); continue
            best = opt['states']['best'] if opt['states']['best']['_applies'] else opt['states']['initial']
            inf, gir = best['Infill Sizes'], best['Girder Sizes']
            what = f'{inf} / {gir}'
            # the solver's own beam count and deck depth are the initial design's (later states may add topping, which
            # is not a deck-table depth)
            v = opt['captured']['initial']['values']
            if ov in ('own', 'own-member'):
                extra = {'num_infill': int(v['NumInfill']), 'slab_total': float(v['Final_Deck_Slab_Thickness'])}
                if ov == 'own-member' and p['system'] == 'composite':
                    first = json.loads(svc.run(svc.check_request(svc.DesignRequest(**p, mode='check', infill_shape=inf, girder_shape=gir))))
                    cv = first['captured']['check']['values']
                    one = lambda x: x[0] if isinstance(x, list) and len(x) == 1 else x   # noqa: E731
                    # camber set to the solver's own value is an identity. Studs are not by design: the solver rounds the
                    # count up to reach the target composite action, while a typed count sets SigmaQn from the studs given
                    # (group c checks that rule).
                    extra.update(camber_infill=float(one(cv['camber_II'])), camber_girder=float(one(cv['camber_IG'])))
                cnt, bad, note = compare_check(orig, p, inf, gir, extra=extra)
                what += ' · ' + ', '.join(f'{a}={b:g}' for a, b in extra.items())
            else:
                extra = {}
                opts = slab_opts.get(f"{p['conc_type']}|{p['deck_type']}", [])
                for a, b in ov.items():
                    if b == 'max' and a.startswith('studs'):
                        span = p['infill_span'] if a == 'studs_infill' else p['girder_span']
                        b = 2 * math.floor(1.5 * span) - 1
                    if a == 'slab_total':
                        b = (min(opts) if b == 'min' else max(opts)) if opts else None
                    if b is not None:
                        extra[a] = b
                cnt, bad, note = compare_override_limits(p, inf, gir, extra)
                what += ' · ' + ', '.join(f'{a}={b:g}' for a, b in extra.items())
        rows.append((grp, p, what, cnt, bad, note))
        log(f"  boundary {k + 1:3d} [{grp}] {p['system'][:4]} {p['girder_span']}x{p['infill_span']} {what[:60]:60s} {cnt:4d} compared, "
            f"{len(bad)} differ  ({time.perf_counter() - t0:.1f} s)")
    return rows


def run_lhs(origs, n, log):
    rows = []
    for k, p in enumerate(lhs_points(n)):
        t0 = time.perf_counter()
        cnt, bad, note = compare_optimize(origs[p['system']], p)
        rows.append(('lhs', p, note, cnt, bad, ''))
        log(f"  lhs {k + 1:3d} {p['system'][:4]} {p['girder_span']:2d}x{p['infill_span']:2d} c{p['conc_type']} d{p['deck_type']} "
            f"pcc{p['percent_comp']} u{p['building_use']} cs{p['clear_spans']} {cnt:5d} compared, {len(bad)} differ  {note[:50]}"
            f"  ({time.perf_counter() - t0:.1f} s)")
    return rows


def describe(p):
    s = f"{'C' if p['system'] == 'composite' else 'NC'} {p['girder_span']}×{p['infill_span']} ft, {'LWC' if p['conc_type'] else 'NWC'}, {p['deck_type']}\" deck"
    if p['system'] == 'composite':
        s += f", {p['percent_comp']} %"
    return s + f", use {p['building_use']}, {p['clear_spans']} span(s), floor {p['floor_length']:g}×{p['floor_width']:g}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--release', required=True)
    ap.add_argument('--lhs', type=int, default=100)
    ap.add_argument('--boundary', type=int, default=100)
    ap.add_argument('--out', default=os.path.join(REPO, 'docs', 'ORIGINAL_CODE_CHECK.md'))
    a = ap.parse_args()
    log = lambda s: print(s, flush=True)   # noqa: E731
    origs = {s: Original(a.release, s) for s in NOTEBOOKS}
    log(f'original code loaded from {a.release}')
    lrows = run_lhs(origs, a.lhs, log) if a.lhs else []
    brows = run_boundary(origs, a.boundary, log) if a.boundary else []
    doc = ['# The tool against the original release code\n',
           'Generated by `tools/check_original.py`. The ORIGINAL side runs the notebooks of the MS-Vibration-Code release, '
           'their code cells executed in a fresh namespace from the release folder with nothing from this repository; '
           'member-check values are read at the pair with `sys.setprofile`, a different mechanism from the tool\'s '
           '`sys.monitoring` capture. The TOOL side is `server/service.py`, the path the web page and the in-browser '
           'engine use. Values must agree to 1e-9 relative.\n']
    for title, rows, blurb in [
            ('Latin hypercube, Optimize', lrows, 'Every scalar column of every design state the original returns, every step of the upsizing paths, and the method code.'),
            ('Boundary conditions, Custom design', brows, '(a) inputs at their limits with the lightest, heaviest and mid members: every value at the pair; '
             "(b) the tool's overrides (beam count, slab depth, camber) set to the solver's own values: must equal the original; "
             '(c) overrides at their limits: the original cannot set these, so the tool must apply exactly the value (a typed stud '
             'count must give SigmaQn = min(studs/2 x Qn, Vprime)) and its line re-run must reproduce every value.')]:
        if not rows:
            continue
        nb = sum(1 for r in rows if r[4])
        tot = sum(r[3] for r in rows)
        doc.append(f'\n## {title}\n\n{blurb}\n\n**{len(rows)} cases, {tot:,} values compared, {nb} cases with a difference.**\n')
        doc.append('| # | | Inputs | Result | Compared | Differ |\n|---|---|---|---|---:|---:|')
        for i, (g, p, what, cnt, bad, note) in enumerate(rows):
            doc.append(f"| {i + 1} | {g} | {describe(p)} | {what}{(' · ' + note) if note else ''} | {cnt:,} | {len(bad)} |")
            for b in bad[:5]:
                doc.append(f'| | | ↳ `{b}` | | | |')
    with open(a.out, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(doc) + '\n')
    nbad = sum(1 for r in lrows + brows if r[4])
    log(f'\nLHS: {len(lrows)} cases, {sum(r[3] for r in lrows):,} values; boundary: {len(brows)} cases, {sum(r[3] for r in brows):,} values; '
        f'{nbad} cases with a difference. Written to {a.out}')
    return 1 if nbad else 0


if __name__ == '__main__':
    sys.exit(main())
