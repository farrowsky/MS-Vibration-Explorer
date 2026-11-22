"""
Cross-check the tool's engine against the published datasets.

    python tools/verify_release.py --release <path to MS-Vibration-Code> [--n 200] [--seed 1]

For N random rows of each published imperial CSV, runs the solver through the tool's engine
(server/engine.py, the same path the web page uses) and compares every design state's members,
peak acceleration, frequency, scaled embodied carbon and the method code. Prints a summary and
every mismatch; exits non-zero if any value differs by more than 1e-9 (relative).
"""
import argparse
import os
import random
import sys
import time

import pandas as pd

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
from server import engine as eng  # noqa: E402

STATES = [('Initial', 'initial'), ('Mitigated Infill', 'infill'), ('Mitigated Girder', 'girder'),
          ('Mitigated Conc', 'conc'), ('Mitigated Steel', 'steel'), ('Best', 'best')]


def member(label):
    s = str(label).split(' [')[0].strip()
    return None if s in ('0', '', 'nan') else s


def close(a, b, rel=1e-9):
    return abs(a - b) <= rel * max(1.0, abs(a), abs(b))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--release', required=True)
    ap.add_argument('--n', type=int, default=100)
    ap.add_argument('--seed', type=int, default=1)
    a = ap.parse_args()
    bad = 0
    for system in ('composite', 'noncomposite'):
        df = pd.read_csv(os.path.join(a.release, 'data', 'imperial', f'{system}_results_imperial.csv'))
        df.columns = [c.split(' (')[0] for c in df.columns]
        e = eng.get_engine(system)
        rows = random.Random(a.seed).sample(range(len(df)), min(a.n, len(df)))
        t0, compared = time.time(), 0
        for k, r in enumerate(rows):
            row = df.iloc[r]
            p = dict(girder_span=int(row['Girder Span']), infill_span=int(row['Infill Span']),
                     conc_type=int(row['Conc_Type_num']), deck_type=float(row['Deck_Type']), clear_spans=3,
                     building_use=3, percent_comp=int(row.get('Percent Composite Connection', 50)),
                     floor_length=200, floor_width=200)
            out = e.design(p, capture=False)
            for prefix, key in STATES:
                st = out['states'][key]
                inf_col = {'infill': 'Mitigated Infill Size', 'girder': 'Mitigated Girder Infill Size'}.get(key, f'{prefix} Infill Size')
                gir_col = {'infill': 'Mitigated Infill Girder Size', 'girder': 'Mitigated Girder Size'}.get(key, f'{prefix} Girder Size')
                pub_inf, pub_gir = member(row[inf_col]), member(row[gir_col])
                if not st['_applies']:
                    if pub_inf is not None:
                        bad += 1
                        print(f'{system} row {r} {key}: solver has no design, published {pub_inf}/{pub_gir}')
                    continue
                checks = [('infill', st['Infill Sizes'], pub_inf, None), ('girder', st['Girder Sizes'], pub_gir, None),
                          ('PA', st['Peak Acceleration'], row[f'{prefix} Peak Acceleration'], 1),
                          ('fn', st['Fundamental Frequency'], row[f'{prefix} Fundamental Frequency'], 1),
                          ('EC', st['Embodied Carbon Scaled'] / eng.LB_TO_KG, row[f'{prefix} EC_Scaled'], 1)]
                for name, got, want, num in checks:
                    compared += 1
                    ok = close(float(got), float(want)) if num else got == want
                    if not ok:
                        bad += 1
                        print(f'{system} row {r} {key} {name}: tool {got} vs published {want}')
            compared += 1
            if out['condition_class'] != int(row['Best Method old']):
                bad += 1
                print(f'{system} row {r}: method {out["condition_class"]} vs {row["Best Method old"]}')
            if (k + 1) % 25 == 0:
                print(f'  {system}: {k + 1}/{len(rows)} rows ({time.time() - t0:.0f} s)', flush=True)
        print(f'{system}: {len(rows)} rows, {compared} values compared')
    print('ALL MATCH' if bad == 0 else f'{bad} MISMATCHES')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
