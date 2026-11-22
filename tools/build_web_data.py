"""
Build the static data files the front end reads (web/data/ and web/assets/figures/).

    python tools/build_web_data.py --release <path to MS-Vibration-Code> --figures <path to figures folder>

Outputs
    web/data/shapes.json            AISC W-shape dimensions/properties used by the 3D model
                                    (from engine/paper/AISC STEEL MANUAL V16 (Modified) Sorted.csv)
    web/data/{system}.bin + .json   the published design-space dataset, packed as typed arrays:
                                    every row of data/imperial/{system}_results_imperial.csv, no
                                    values changed (floats stored as float32)
    web/assets/figures/             the paper's Figures 1-15, resized for the web (WebP), and the
                                    SVG versions of Figures 2-5
    web/data/figures.json           figure captions (from the manuscript's caption list)

The dataset rows are the published imperial files. Carbon stays in lb CO2e/ft2 here;
the page converts to kg CO2e/m2 with the factors documented in the release's data/README.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys

import numpy as np
import pandas as pd

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAPER = os.path.join(REPO, 'engine', 'paper')
WEB_DATA = os.path.join(REPO, 'web', 'data')
WEB_FIG = os.path.join(REPO, 'web', 'assets', 'figures')

STATES = [('Initial', 'initial'), ('Mitigated Infill', 'infill'), ('Mitigated Girder', 'girder'),
          ('Mitigated Conc', 'conc'), ('Mitigated Steel', 'steel'), ('Best', 'best')]

FIGURES = [
    (1, 'Geometric variables used in the parametric study', 'method'),
    (2, 'Flowchart of deck and slab sizing', 'method'),
    (3, 'Flowchart of steel member sizing', 'method'),
    (4, 'Flowchart of vibration model', 'method'),
    (5, 'Flowchart of vibration mitigation process', 'method'),
    (6, 'Bay area, girder span, and infill span vs initial peak acceleration and initial scaled embodied carbon of sampled residential composite designs with linear piecewise average', 'results'),
    (7, 'Girder span vs infill span colored by average initial peak acceleration over the 0.5%g tolerance limit and average initial scaled embodied carbon of sampled residential composite designs', 'results'),
    (8, 'Peak acceleration vs fundamental frequency of sampled residential composite designs colored by bay area', 'results'),
    (9, 'Bay area vs initial peak acceleration and initial scaled embodied carbon of sampled residential composite designs colored by deck depth with linear piecewise averages', 'results'),
    (10, 'Bay area vs initial peak acceleration and scaled embodied carbon of sampled residential composite and non-composite designs colored by PCC with linear piecewise average', 'results'),
    (11, 'Infill span vs girder span colored by the most efficient mitigation method averaged across sampled residential composite and non-composite designs', 'results'),
    (12, 'Girder span vs infill span colored by average scaled embodied carbon for initial composite designs and controlling mitigated designs', 'results'),
    (13, 'Girder span vs infill span colored by scaled embodied carbon for initial non-composite designs and controlling mitigated designs', 'results'),
    (14, 'Summary of initial and mitigated scaled embodied carbon values of sampled composite designs for different regions of the design space', 'results'),
    (15, 'Damping ratio sensitivity study from 1% to 5% for sampled composite and non-composite designs, showing (a) median initial peak acceleration, (b) share of designs meeting the 0.5%g tolerance limit without mitigation, (c) controlling mitigation method, and (d) mean controlling scaled embodied carbon', 'results'),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 16), b''):
            h.update(b)
    return h.hexdigest()


# ---------------------------------------------------------------------------
def build_shapes():
    db = pd.read_csv(os.path.join(PAPER, 'AISC STEEL MANUAL V16 (Modified) Sorted.csv'), encoding='latin1')
    w = db[db['Type'] == 'W']
    cols = {'W': 'W', 'A': 'A', 'd': 'd', 'bf': 'bf', 'tf': 'tf', 'tw': 'tw', 'kdes': 'kdes', 'kdet': 'kdet',
            'Ix': 'Ix', 'Sx': 'Sx', 'Iy': 'Iy', 'ry': 'ry', 'Zx': 'Zx'}
    out = {}
    for _, r in w.iterrows():
        rec = {}
        for k, c in cols.items():
            try:
                rec[k] = float(r[c])
            except (KeyError, ValueError, TypeError):
                rec[k] = None
        for k, c in (('economic', 'Economic'), ('group', 'Grouping #')):
            try:
                rec[k] = int(r[c])
            except (KeyError, ValueError, TypeError):
                rec[k] = None
        out[str(r['AISC_Manual_Label'])] = rec
    with open(os.path.join(WEB_DATA, 'shapes.json'), 'w') as fh:
        json.dump({'source': 'engine/paper/AISC STEEL MANUAL V16 (Modified) Sorted.csv',
                   'units': 'in, in2, in4, lb/ft', 'shapes': out}, fh, separators=(',', ':'))
    print(f'shapes.json: {len(out)} W-shapes')
    return list(out)


# ---------------------------------------------------------------------------
LABEL_RE = re.compile(r'^\s*(W\d+X[\d.]+)\s*(?:\[(\d+)\])?\s*(?:\+\s*\[?\s*([\d.]+)\s*\.?\]?\s*")?')


def parse_label(s):
    """'W14X22 [19] + [1.25]"' -> ('W14X22', 19, 1.25); '0 [0] + 0"' -> (None, 0, 0)."""
    if not isinstance(s, str):
        return None, 0, 0.0
    m = LABEL_RE.match(s)
    if not m:
        return None, 0, 0.0
    studs = int(m.group(2)) if m.group(2) else 0
    camber = float(m.group(3)) if m.group(3) else 0.0
    return m.group(1), studs, camber


def strip_units(col):
    return re.sub(r'\s*\(.*\)\s*$', '', col).strip()


class Packer:
    def __init__(self, n):
        self.n, self.cols, self.blobs, self.offset = n, [], [], 0

    def add(self, name, arr, dtype, scale=1.0, note=None):
        a = np.asarray(arr)
        if dtype == 'f32':
            data = a.astype(np.float32)
        elif dtype == 'u8':
            data = np.round(a * scale).astype(np.int64)
            assert data.min() >= 0 and data.max() <= 255, (name, data.min(), data.max())
            data = data.astype(np.uint8)
        elif dtype == 'u16':
            data = np.round(a * scale).astype(np.int64)
            assert data.min() >= 0 and data.max() <= 65535, (name, data.min(), data.max())
            data = data.astype(np.uint16)
        else:
            raise ValueError(dtype)
        if dtype != 'f32':
            back = data.astype(np.float64) / scale
            assert np.allclose(back, a.astype(np.float64), atol=1e-9), f'{name}: lossy packing'
        b = data.tobytes()
        pad = (-len(b)) % 4
        self.cols.append({'name': name, 'dtype': dtype, 'scale': scale, 'offset': self.offset,
                          **({'note': note} if note else {})})
        self.blobs.append(b + b'\0' * pad)
        self.offset += len(b) + pad

    def write(self, base, meta):
        with open(base + '.bin', 'wb') as fh:
            for b in self.blobs:
                fh.write(b)
        meta = dict(meta, rows=self.n, bytes=self.offset, columns=self.cols)
        with open(base + '.json', 'w') as fh:
            json.dump(meta, fh, separators=(',', ':'))


def build_dataset(release, system, shapes):
    src = os.path.join(release, 'data', 'imperial', f'{system}_results_imperial.csv')
    df = pd.read_csv(src)
    df.columns = [strip_units(c) for c in df.columns]
    n = len(df)
    composite = system == 'composite'
    shape_idx = {s: i for i, s in enumerate(shapes)}
    NONE = 65535
    pk = Packer(n)
    pk.add('g', df['Girder Span'], 'u8')
    pk.add('i', df['Infill Span'], 'u8')
    pk.add('conc', df['Conc_Type_num'], 'u8')
    pk.add('deck', df['Deck_Type'], 'u8', scale=2)
    pk.add('pcc', df['Percent Composite Connection'] if composite else np.zeros(n), 'u8')
    pk.add('damping', df['Damping Ratio'], 'u8', scale=1000)
    for prefix, key in STATES:
        pk.add(f'{key}.ec', df[f'{prefix} EC_Scaled'], 'f32', note='lb CO2e/ft2')
        pk.add(f'{key}.pa', df[f'{prefix} Peak Acceleration'], 'f32', note='%g')
        pk.add(f'{key}.fn', df[f'{prefix} Fundamental Frequency'], 'f32', note='Hz')
        for mem, col in (('inf', f'{prefix} Infill Size'), ('gir', f'{prefix} Girder Size')):
            if key == 'infill' and mem == 'gir':
                col = 'Mitigated Infill Girder Size'
            if key == 'girder' and mem == 'inf':
                col = 'Mitigated Girder Infill Size'
            if key == 'girder' and mem == 'gir':
                col = 'Mitigated Girder Size'
            if key == 'infill' and mem == 'inf':
                col = 'Mitigated Infill Size'
            parsed = [parse_label(s) for s in df[col]]
            idx = [shape_idx.get(p[0], NONE) if p[0] else NONE for p in parsed]
            bad = [p[0] for p in parsed if p[0] and p[0] not in shape_idx]
            assert not bad, f'unknown shapes {bad[:5]}'
            pk.add(f'{key}.{mem}', idx, 'u16')
            if composite:
                pk.add(f'{key}.{mem}_studs', [p[1] for p in parsed], 'u8')
                pk.add(f'{key}.{mem}_camber', [p[2] for p in parsed], 'u8', scale=8)
    pk.add('initial.top', df['Initial Topping'], 'u8', scale=8)
    pk.add('best.top', df['Best Topping'], 'u8', scale=8)
    pk.add('conc.top', df['Mitigated Conc Topping'], 'u8', scale=8)
    pk.add('conc.add', df['Mitigated Conc Additional Topping'], 'u8', scale=8)
    pk.add('infill.ups', df['Mitigated Infill # of Upsizes'], 'u8')
    pk.add('girder.ups', df['Mitigated Girder # of Upsizes'], 'u8')
    pk.add('method', df['Best Method'], 'u8')
    pk.add('method_raw', df['Best Method old'], 'u8')
    for prefix, key in (('Initial', 'initial'), ('Best', 'best')):
        for comp in ('Infill', 'Girder', 'Deck', 'Concrete', 'Studs'):
            if comp == 'Studs' and not composite:
                continue
            pk.add(f'{key}.ec_{comp.lower()}', df[f'{prefix} EC_{comp}'], 'f32', note='lb CO2e per bay')

    base = os.path.join(WEB_DATA, system)
    pk.write(base, {
        'system': system,
        'source': f'MS-Vibration-Code/data/imperial/{system}_results_imperial.csv',
        'source_sha256': sha256(src),
        'shapes': 'shapes.json key order; 65535 = no member (state does not apply)',
        'units': {'ec': 'lb CO2e/ft2', 'pa': '%g', 'fn': 'Hz', 'top': 'in', 'ec_parts': 'lb CO2e per bay'},
        'methods': {'1': 'Passes as built', '4': 'Add concrete topping', '5': 'No feasible mitigation',
                    '6': 'Upsize steel (infills and/or girders)'},
    })
    kb = os.path.getsize(base + '.bin') / 1024
    print(f'{system}: {n} rows, {len(pk.cols)} columns, {kb:.0f} KB')


# ---------------------------------------------------------------------------
def build_figures(folder):
    from PIL import Image
    os.makedirs(WEB_FIG, exist_ok=True)
    items = []
    for num, caption, kind in FIGURES:
        png = os.path.join(folder, f'Figure_{num}.png')
        svg = os.path.join(folder, f'Figure_{num}.svg')
        rec = {'num': num, 'caption': caption, 'kind': kind}
        if os.path.exists(svg):
            shutil.copyfile(svg, os.path.join(WEB_FIG, f'figure_{num}.svg'))
            rec['svg'] = f'assets/figures/figure_{num}.svg'
        im = Image.open(png)
        im.load()
        if im.mode not in ('RGB', 'RGBA'):
            im = im.convert('RGBA')
        w, h = im.size
        rec['aspect'] = round(w / h, 4)
        for tag, width, q in (('full', 2600, 86), ('thumb', 640, 80)):
            ww = min(width, w)
            out = im.resize((ww, round(h * ww / w)), Image.LANCZOS) if ww < w else im
            path = os.path.join(WEB_FIG, f'figure_{num}_{tag}.webp')
            out.save(path, 'WEBP', quality=q, method=6)
            rec[tag] = f'assets/figures/figure_{num}_{tag}.webp'
        rec['source_sha256'] = sha256(png)
        items.append(rec)
        print(f'Figure {num}: {w}x{h} -> {os.path.getsize(os.path.join(WEB_FIG, f"figure_{num}_full.webp")) // 1024} KB')
    with open(os.path.join(WEB_DATA, 'figures.json'), 'w') as fh:
        json.dump({'source': 'Figures 1-15 of the manuscript', 'figures': items}, fh, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--release', required=True, help='path to the MS-Vibration-Code repository')
    ap.add_argument('--figures', help='folder holding Figure_1.png ... Figure_15.png (+ SVGs)')
    a = ap.parse_args()
    os.makedirs(WEB_DATA, exist_ok=True)
    shapes = build_shapes()
    for system in ('composite', 'noncomposite'):
        build_dataset(a.release, system, shapes)
    if a.figures:
        build_figures(a.figures)


if __name__ == '__main__':
    sys.exit(main())
