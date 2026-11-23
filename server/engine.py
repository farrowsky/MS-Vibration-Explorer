"""
The paper's solver, run exactly as published.

Nothing in this file re-implements the structural, vibration or carbon
calculations. At start-up the two published notebooks in ``engine/paper/``
(``Composite MS Code.ipynb`` and ``Non-Composite MS Code.ipynb``, copied
byte-for-byte from the MS-Vibration-Code release) are read, the code cells up to
and including the one that defines ``sizer_and_calc`` are executed into a
private namespace, and that function is called with the user's inputs.

Two things are added around the call. Neither changes a computed number.

1. **Table reads.** The notebooks read ``'AISC STEEL MANUAL V16 (Modified)
   Sorted.csv'`` and ``'DeckData.csv'`` by bare file name, many times per run.
   The namespace's ``pd`` is a thin proxy whose ``read_csv`` resolves those bare
   names inside ``engine/paper/`` and memoises the parse. Every call still gets
   a fresh deep copy, so the solver cannot tell the difference.

2. **Calculation capture.** Python 3.12+ ``sys.monitoring`` (PEP 669) is told
   to report when the solver's inner ``mitigation_method()`` returns. At that
   moment its local variables (about 400 of them: loads, moments, capacities,
   deflections, the DG 11 vibration chain, the carbon take-off) are copied,
   each reduced to the selected infill/girder pair. Monitoring is read-only.

Every captured design state is then validated: each value the solver itself
reports for that state (its output dataframes) is compared against the captured
internal variable it came from. The mapping between the two is read out of the
solver's own source with ``ast``, not written by hand.
"""
from __future__ import annotations

import ast
import contextlib
import copy
import hashlib
import io
import json
import math
import os
import sys
import threading
import time
import types
import warnings
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
PAPER_DIR = os.path.join(REPO, 'engine', 'paper')

NOTEBOOKS = {
    'composite': 'Composite MS Code.ipynb',
    'noncomposite': 'Non-Composite MS Code.ipynb',
}
TABLES = ['AISC STEEL MANUAL V16 (Modified) Sorted.csv', 'DeckData.csv']

# The engine's own building-use table (Building_Use_dict inside the notebooks).
# Read from the source at load time; this is only the display order.
BUILDING_USES = [1, 2, 3, 4]

STATE_ORDER = ['initial', 'infill', 'girder', 'conc', 'steel', 'best']
STATE_LABELS = {
    'initial': 'Initial design',
    'infill': 'Mitigated: upsize infills',
    'girder': 'Mitigated: upsize girders',
    'conc': 'Mitigated: add concrete topping',
    'steel': 'Mitigated: upsize infills + girders',
    'best': 'Best (lowest-carbon passing design)',
}
# Which row of each output dataframe is the design state -- the same rows the
# published sampler (and harness.build_row_*) reads.
STATE_ROW = {'initial': 0, 'infill': -1, 'girder': -1, 'conc': -1, 'steel': 0, 'best': -1}

METHOD_CODES = {
    1: 'Passes as built (no mitigation needed)',
    2: 'Upsize infills',
    3: 'Upsize girders',
    4: 'Add concrete topping',
    5: 'No feasible mitigation found',
    6: 'Upsize infills and girders',
}
# Published 'Best Method' folds 2 and 3 into 6 (data/README.md of the release).
METHOD_FOLD = {2: 6, 3: 6}

# Reporting quirks found by the validation in this tool. None changes a member
# size, check, peak acceleration, frequency or carbon value; they only affect a
# descriptive column of one output frame. Listed so the tool can show them
# rather than hide them.
KNOWN_REPORTING_QUIRKS = {
    ('conc', 'Infill Case Label'): (
        "Composite MS Code.ipynb, cell 1 line 1809 (concrete_upsizing): the reported "
        "'Infill Case Label' is built with expand_girder(...) on an infill-indexed array, so it "
        "shows the case label of the shape at the girder's index. The captured value is the "
        "selected infill's own case. Only this descriptive label is affected; the infill moment "
        "capacity on the same row uses expand_infill and validates."),
}

# Optional, user-requested deviations from the published method, applied to a separate copy of the
# solver cell by one-line replacements (the technique the paper's damping study used for its damping
# override; line numbers are unchanged). With an argument left at None the copy computes exactly what
# the published solver computes; the default (Auto) path never uses the copy at all.
#   num_infill_override  -- number of interior infills, instead of deriving it from the deck table
#   slab_total_override  -- total slab depth (in): the deck table is filtered to rows of that depth
#                           before the solver picks the lightest deck that passes its checks
VARIANT_PATCHES = {
    'user': [
        ('floor_width, ):', 'floor_width, num_infill_override=None, slab_total_override=None, ):'),
        ('        NumInfill = max(1, ms.ceil(NumInfill_unrounded))\n',
         '        NumInfill = max(1, ms.ceil(NumInfill_unrounded)) if num_infill_override is None else int(num_infill_override)\n'),
        ('        Deck_Check = Conc_Type_Check & Deck_Type_Check & Span_Check & Load_Check\n',
         '        Deck_Check = (Conc_Type_Check & Deck_Type_Check & Span_Check & Load_Check) if slab_total_override is None '
         'else (Conc_Type_Check & Deck_Type_Check & Span_Check & Load_Check & (Total_Depth == float(slab_total_override)))\n'),
    ],
}

# Composite only (the non-composite solver has no studs or camber). Used by the member check.
#   camber_II_override / camber_IG_override -- camber (in) instead of 0.8 x construction deflection
#   studs_II_override / studs_IG_override   -- studs on the member instead of the count the degree of
#       composite action needs. The solver's rule for fitting studs in the ribs is kept (fewest studs
#       per rib for which the half-span holds more than half the studs); sum Qn becomes the studs on a
#       half span x Qn, capped at V', and the member needs at least 25 % composite action.
_FIT = '(max_studs_half_{m} > float(studs_{m}_override) / 2)'
COMPOSITE_USER_PATCHES = [
    ('slab_total_override=None, ):',
     'slab_total_override=None, camber_II_override=None, camber_IG_override=None, '
     'studs_II_override=None, studs_IG_override=None, ):'),
] + [p for m in ('II', 'IG') for p in (
    (f'        req_studs_{m} = np.ceil(req_studs_half_filter_{m} * 2)\n',
     f'        req_studs_{m} = np.ceil(req_studs_half_filter_{m} * 2) if studs_{m}_override is None else '
     f'np.where({_FIT.format(m=m)} & (np.cumsum({_FIT.format(m=m)}, axis=2) == 1), float(studs_{m}_override), np.nan) '
     f'+ 0 * req_studs_half_{m}\n'),
    (f'        elif 25 <= percent_comp < 100:\n            Sigma_Qn_{m} = percent_comp / 100 * V_prime_{m}\n',
     f'        elif 25 <= percent_comp < 100:\n            Sigma_Qn_{m} = percent_comp / 100 * V_prime_{m} if studs_{m}_override is None else '
     + ('np.minimum(stud_capacity_II / 2, V_prime_II)\n' if m == 'II' else
        'np.minimum(stud_capacity_IG[..., np.newaxis] / 2, V_prime_IG)\n')),
)] + [
    ('        PCC_check_II = np.max(max_PCC_II >= percent_comp, axis=2)\n',
     '        PCC_check_II = np.max(max_PCC_II >= percent_comp, axis=2) if studs_II_override is None else '
     '(np.isfinite(min_req_studs_II) & (Sigma_Qn_II / V_prime_II * 100 >= 25))\n'),
    ('        PCC_check_flat_IG = np.max(max_PCC_IG, axis=2) >= percent_comp\n',
     '        PCC_check_flat_IG = np.max(max_PCC_IG, axis=2) >= percent_comp if studs_IG_override is None else '
     '(np.isfinite(min_req_studs_IG) & (Sigma_Qn_IG[..., 0] / V_prime_IG[..., 0] * 100 >= 25))\n'),
    ('        camber_II = np.minimum(np.where(camber_check, np.around(0.8 * DEF_Con_II / 0.25) * 0.25, 0), 4)',
     '        camber_II = np.minimum(np.where(camber_check, np.around(0.8 * DEF_Con_II / 0.25) * 0.25, 0), 4) '
     'if camber_II_override is None else np.full_like(DEF_Con_II, float(camber_II_override))'),
    ('        camber_IG = np.minimum(np.where(camber_check_IG, np.round(0.8 * DEF_Con_IG / 0.25) * 0.25, 0), 4)',
     '        camber_IG = np.minimum(np.where(camber_check_IG, np.round(0.8 * DEF_Con_IG / 0.25) * 0.25, 0), 4) '
     'if camber_IG_override is None else np.full_like(DEF_Con_IG, float(camber_IG_override))'),
]
MEMBER_OVERRIDES = ('camber_II_override', 'camber_IG_override', 'studs_II_override', 'studs_IG_override')


def slab_options() -> dict:
    """Total slab depths the deck table offers, keyed 'conc|deck' (conc 0 = NW, 1 = LW)."""
    d = pd.read_csv(os.path.join(PAPER_DIR, TABLES[1]))
    out = {}
    for (deck, conc), g in d.groupby(['Deck Type', 'Conc Type']):
        out[f"{0 if conc == 'NW' else 1}|{float(deck):g}"] = sorted(float(x) for x in set(g['Total']))
    return out

# Module-level constants of the solver cell, captured alongside the locals.
GLOBAL_CONSTANTS = ('Es', 'Fy', 'f_prime_c', 'LB_TO_KG')

LB_TO_KG = 0.45359237
FT2_TO_M2 = 0.09290304


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


# ---------------------------------------------------------------------------
# pandas proxy: bare-name table reads resolve to engine/paper and are memoised
# ---------------------------------------------------------------------------
class _PandasProxy:
    """Forwards everything to pandas except read_csv, which is path-resolved and cached."""

    def __init__(self, base_dir: str):
        self._base_dir = base_dir
        self._cache: dict = {}
        self._lock = threading.Lock()

    def read_csv(self, filepath_or_buffer, *args, **kwargs):
        if isinstance(filepath_or_buffer, str):
            path = filepath_or_buffer
            if not os.path.isabs(path):
                path = os.path.join(self._base_dir, path)
            key = (os.path.normcase(os.path.abspath(path)), repr(args), repr(sorted(kwargs.items())))
            with self._lock:
                if key not in self._cache:
                    self._cache[key] = pd.read_csv(path, *args, **kwargs)
                return self._cache[key].copy(deep=True)
        return pd.read_csv(filepath_or_buffer, *args, **kwargs)

    def __getattr__(self, name):
        return getattr(pd, name)


# ---------------------------------------------------------------------------
# reading the solver out of the notebook
# ---------------------------------------------------------------------------
def _solver_cells(nb_path: str) -> list[str]:
    """Code cells up to and including the one that defines sizer_and_calc."""
    with open(nb_path, encoding='utf-8') as fh:
        nb = json.load(fh)
    cells = []
    for cell in nb['cells']:
        if cell.get('cell_type') != 'code':
            continue
        src = ''.join(cell['source'])
        cells.append(src)
        if 'def sizer_and_calc' in src:
            return cells
    raise RuntimeError(f'{nb_path}: no cell defines sizer_and_calc')


def _first_name(node: ast.AST) -> str | None:
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name):
            return sub.id
    return None


def _subscript_key(node: ast.AST, base: str) -> str | None:
    """'X' for the first base['X'] found inside node."""
    for sub in ast.walk(node):
        if (isinstance(sub, ast.Subscript) and isinstance(sub.value, ast.Name)
                and sub.value.id == base and isinstance(sub.slice, ast.Constant)):
            return sub.slice.value
    return None


@dataclass
class SourceMap:
    """What the solver's source says about its own variables."""
    assignments: dict = field(default_factory=dict)   # local name -> [{line, code}]
    results_keys: dict = field(default_factory=dict)  # results-dict key -> local name
    df_columns: dict = field(default_factory=dict)    # output column -> results-dict key
    building_uses: dict = field(default_factory=dict)  # code -> (name, vib LL, tol, LL, DR)
    spacing_lookup: dict = field(default_factory=dict)
    lines: list = field(default_factory=list)         # re-evaluable single-target assignments


def _build_source_map(source: str) -> SourceMap:
    tree = ast.parse(source)
    lines = source.splitlines()
    sm = SourceMap()

    sac = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'sizer_and_calc')
    mm = next(n for n in ast.walk(sac) if isinstance(n, ast.FunctionDef) and n.name == 'mitigation_method')

    def seg(node):
        return '\n'.join(lines[node.lineno - 1:node.end_lineno]).strip()

    for node in ast.walk(mm):
        targets = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            targets = [node.target]
        for t in targets:
            names = [t] if isinstance(t, ast.Name) else [e for e in getattr(t, 'elts', []) if isinstance(e, ast.Name)]
            for nm in names:
                sm.assignments.setdefault(nm.id, []).append({'line': node.lineno, 'code': seg(node)})
        # results = {...}
        if (isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id == 'results' and isinstance(node.value, ast.Dict)):
            for k, v in zip(node.value.keys, node.value.values):
                if isinstance(k, ast.Constant):
                    nm = v.id if isinstance(v, ast.Name) else _first_name(v)
                    if nm:
                        sm.results_keys[k.value] = nm
        # Building_Use_dict / spacing_lookup literals
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            nm = node.targets[0].id
            if nm in ('Building_Use_dict', 'spacing_lookup'):
                try:
                    val = ast.literal_eval(node.value)
                except Exception:
                    val = None
                if nm == 'Building_Use_dict' and val:
                    sm.building_uses = val
                elif nm == 'spacing_lookup' and val:
                    sm.spacing_lookup = {f'{k[0]}|{k[1]}': v for k, v in val.items()}

    for v in sm.assignments.values():
        v.sort(key=lambda a: a['line'])

    # Assignments that can be re-evaluated at one infill/girder pair: a single Name
    # target, an expression that does not read its own target, built only from
    # other names (+ np / ms / min / max / abs).
    allowed = {'np', 'ms', 'min', 'max', 'abs', 'float', 'int', 'round', 'len'}
    banned = (ast.Subscript, ast.Lambda, ast.ListComp, ast.DictComp, ast.Dict, ast.GeneratorExp)
    for node in ast.walk(mm):
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name)):
            continue
        tgt = node.targets[0].id
        names = sorted({n.id for n in ast.walk(node.value) if isinstance(n, ast.Name)} - allowed)
        if tgt in names or not names:
            continue
        if any(isinstance(n, banned) for n in ast.walk(node.value)):
            continue
        sm.lines.append({'line': node.lineno, 'var': tgt, 'inputs': names,
                         'expr': ast.get_source_segment(source, node.value)})
    sm.lines.sort(key=lambda d: d['line'])

    # target_base_matrices = {...} in sizer_and_calc: output column -> results key
    for node in ast.walk(sac):
        if (isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id == 'target_base_matrices' and isinstance(node.value, ast.Dict)):
            for k, v in zip(node.value.keys, node.value.values):
                if not isinstance(k, ast.Constant):
                    continue
                # np.zeros_like(x) / np.full(..., x) build a constant, not a mapping of x
                if (isinstance(v, ast.Call) and isinstance(v.func, ast.Attribute)
                        and v.func.attr in ('zeros_like', 'ones_like', 'full', 'zeros', 'ones')):
                    continue
                rk = _subscript_key(v, 'base_results')
                if rk:
                    sm.df_columns[k.value] = rk
            break
    return sm


# ---------------------------------------------------------------------------
# reducing a captured local to the selected infill/girder pair
# ---------------------------------------------------------------------------
def _clean(v: Any):
    """JSON-safe scalar."""
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating, float)):
        f = float(v)
        if math.isnan(f):
            return None
        if math.isinf(f):
            return 'inf' if f > 0 else '-inf'
        return f
    if isinstance(v, (int, str)) or v is None:
        return v
    if isinstance(v, np.str_):
        return str(v)
    return str(v)


def _orientation_for_1d(name: str) -> str:
    low = name.lower()
    if '_ig' in low or low.endswith('ig') or 'girder' in low:
        return 'c'
    if '_ii' in low or low.endswith('ii') or 'infill' in low:
        return 'r'
    return 'rc?'


def reduce_local(name: str, v: Any, r: int, c: int, n: int):
    """(value, orientation) for one local variable at pair (r = infill, c = girder).

    orientation: 's' scalar, 'r' infill-indexed, 'c' girder-indexed, 'rc' pair,
    'opt' per studs-per-rib option list, 'tbl' small table, 'both' a shape-table
    column given for both members, None = not reducible (skipped).
    """
    if isinstance(v, (bool, int, float, str, np.bool_, np.integer, np.floating, np.str_)) or v is None:
        return _clean(v), 's'
    if isinstance(v, pd.Series):
        if len(v) == n:
            o = _orientation_for_1d(name)
            if o == 'r':
                return _clean(v.iloc[r]), 'r'
            if o == 'c':
                return _clean(v.iloc[c]), 'c'
            return {'infill': _clean(v.iloc[r]), 'girder': _clean(v.iloc[c])}, 'both'
        if len(v) <= 60:
            return {str(k): _clean(x) for k, x in v.items()}, 'tbl'
        return None, None
    if isinstance(v, pd.DataFrame):
        if v.shape == (n, n):
            return _clean(v.iat[r, c]), 'rc'
        if len(v) <= 60 and v.shape[1] <= 40:
            return {'columns': [str(x) for x in v.columns],
                    'rows': [[_clean(x) for x in row] for row in v.itertuples(index=False)]}, 'tbl'
        return None, None
    if isinstance(v, np.ndarray):
        s = v.shape
        if v.size == 1:
            return _clean(v.reshape(-1)[0]), 's'
        if v.ndim == 1 and s[0] == n:
            o = _orientation_for_1d(name)
            if o == 'r':
                return _clean(v[r]), 'r'
            if o == 'c':
                return _clean(v[c]), 'c'
            return {'infill': _clean(v[r]), 'girder': _clean(v[c])}, 'both'
        if v.ndim == 2:
            if s == (n, n):
                return _clean(v[r, c]), 'rc'
            if s == (n, 1):
                return _clean(v[r, 0]), 'r'
            if s == (1, n):
                return _clean(v[0, c]), 'c'
        if v.ndim == 3 and s[2] <= 3:      # trailing axis = the 1/2/3 studs-per-rib options
            if s[:2] == (n, n):
                return [_clean(x) for x in v[r, c, :]], 'opt'
            if s[:2] == (n, 1):
                return [_clean(x) for x in v[r, 0, :]], 'opt'
            if s[:2] == (1, n):
                return [_clean(x) for x in v[0, c, :]], 'opt'
            if s[:2] == (1, 1):
                return [_clean(x) for x in v[0, 0, :]], 'opt'
        if v.size <= 12:
            return [_clean(x) for x in v.reshape(-1)], 'tbl'
        return None, None
    if isinstance(v, (list, tuple)) and len(v) > 0:
        if all(isinstance(x, (str, int, float, bool)) for x in v) and len(set(map(repr, v))) == 1:
            return _clean(v[0]), 's'          # e.g. Conc_Type = list(repeat('NW', 90))
        if len(v) <= 12:
            return [_clean(x) for x in v], 'tbl'
    return None, None


# ---------------------------------------------------------------------------
# the engine
# ---------------------------------------------------------------------------
_RUN_LOCK = threading.Lock()          # sys.monitoring and stdout redirection are process-wide
_TOOL_NAME = 'msve-calc-capture'


def _monitoring_tool_id() -> int:
    mon = sys.monitoring
    for tid in (mon.PROFILER_ID, 3, 4, mon.OPTIMIZER_ID):
        cur = mon.get_tool(tid)
        if cur == _TOOL_NAME:
            return tid
        if cur is None:
            mon.use_tool_id(tid, _TOOL_NAME)
            return tid
    raise RuntimeError('no free sys.monitoring tool id')


class PaperEngine:
    def __init__(self, system: str, variant: str | None = None):
        if system not in NOTEBOOKS:
            raise ValueError(system)
        self.system = system
        self.variant = variant
        self.composite = system == 'composite'
        self.notebook_path = os.path.join(PAPER_DIR, NOTEBOOKS[system])
        self.notebook_sha256 = sha256_file(self.notebook_path)
        cells = _solver_cells(self.notebook_path)
        self.source = cells[-1]
        self.prelude = '\n'.join(cells[:-1])
        self.source_sha256 = sha256_text(self.source)        # hash of the PUBLISHED cell
        if variant:
            patches = VARIANT_PATCHES[variant] + (COMPOSITE_USER_PATCHES if variant == 'user' and self.composite else [])
            for a, b in patches:
                assert self.source.count(a) == 1, (variant, a)
                self.source = self.source.replace(a, b)
            assert self.source.count('\n') == cells[-1].count('\n')   # line numbers unchanged

        ns: dict = {'__name__': f'paper_{system}', '__file__': self.notebook_path}
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            exec(compile(self.prelude + '\n', f'<{NOTEBOOKS[system]} imports>', 'exec'), ns)
            ns['pd'] = _PandasProxy(PAPER_DIR)
            exec(compile(self.source, f'<{NOTEBOOKS[system]} solver cell>', 'exec'), ns)
        if 'pd' in ns and not isinstance(ns['pd'], _PandasProxy):   # the cell re-imported pandas
            ns['pd'] = _PandasProxy(PAPER_DIR)
        self.ns = ns
        self.sac = ns['sizer_and_calc']
        self.mm_code = next(c for c in self.sac.__code__.co_consts
                            if isinstance(c, types.CodeType) and c.co_name == 'mitigation_method')
        self.smap = _build_source_map(self.source)
        self.shapes = self._load_shapes()
        self.n = len(self.shapes)

    # -- tables ----------------------------------------------------------------
    def _load_shapes(self) -> list[str]:
        db = pd.read_csv(os.path.join(PAPER_DIR, TABLES[0]), encoding='latin1')
        return [str(x) for x in db[db['Type'] == 'W']['AISC_Manual_Label']]

    # -- calling the solver ------------------------------------------------------
    def _kwargs(self, p: dict) -> dict:
        kw = dict(Girder_Span=int(p['girder_span']), Infill_Span=int(p['infill_span']),
                  Conc_Type_num=int(p['conc_type']), Deck_Type=float(p['deck_type']),
                  Clear_Spans=int(p['clear_spans']), Building_Use_num=int(p['building_use']),
                  floor_length=float(p['floor_length']), floor_width=float(p['floor_width']))
        if kw['Deck_Type'] == int(kw['Deck_Type']) and kw['Deck_Type'] != 1.5:
            kw['Deck_Type'] = int(kw['Deck_Type'])    # the notebooks use 2 and 3 as ints in their lookups
        if self.composite:
            kw['percent_comp'] = int(p['percent_comp'])
        if self.variant == 'user':
            kw['num_infill_override'] = int(p['num_infill']) if p.get('num_infill') else None
            kw['slab_total_override'] = float(p['slab_total']) if p.get('slab_total') else None
            if self.composite:
                for k, src, cast in (('camber_II_override', 'camber_infill', float), ('camber_IG_override', 'camber_girder', float),
                                     ('studs_II_override', 'studs_infill', int), ('studs_IG_override', 'studs_girder', int)):
                    kw[k] = cast(p[src]) if p.get(src) is not None else None
        return kw

    def _call(self, kw: dict):
        buf = io.StringIO()
        with warnings.catch_warnings(), contextlib.redirect_stdout(buf), np.errstate(all='ignore'):
            warnings.simplefilter('ignore')
            res = self.sac(**kw)
        return res, buf.getvalue()

    # -- design states out of the solver's return value -------------------------
    def _states(self, res) -> dict:
        names = ['initial', 'infill', 'girder', 'conc', 'steel', 'best']
        dfs = dict(zip(names, res[:6]))
        out = {}
        for nm in names:
            df = dfs[nm]
            row = df.iloc[STATE_ROW[nm]]
            rec = {k: _clean(row[k]) for k in df.columns
                   if not isinstance(row[k], (list, dict, np.ndarray))}
            infill = rec.get('Infill Sizes')
            girder = rec.get('Girder Sizes')
            applies = isinstance(infill, str) and isinstance(girder, str) and infill != '0' and girder != '0'
            rec['_applies'] = bool(applies)
            rec['_rows'] = int(len(df))
            # the upsizing paths: every step the solver took (for the "mitigation path" view)
            if nm in ('infill', 'girder', 'conc') and applies:
                path = []
                for _, rr in df.iterrows():
                    path.append({'Infill Sizes': _clean(rr.get('Infill Sizes')),
                                 'Girder Sizes': _clean(rr.get('Girder Sizes')),
                                 'Additional Topping': _clean(rr.get('Additional Topping')),
                                 'Peak Acceleration': _clean(rr.get('Peak Acceleration')),
                                 'Embodied Carbon Scaled': _clean(rr.get('Embodied Carbon Scaled')),
                                 'Fundamental Frequency': _clean(rr.get('Fundamental Frequency'))})
                rec['_path'] = path
            out[nm] = rec
        return out

    # -- capture -----------------------------------------------------------------
    def _capture(self, kw: dict, targets: dict):
        """Run the solver again with monitoring on and reduce mitigation_method's
        locals at each target.  targets: name -> (additional_topping, infill_label, girder_label)."""
        mon = sys.monitoring
        tid = _monitoring_tool_id()
        captured: dict = {}
        mm_code = self.mm_code
        n = self.n
        shape_index = {s: i for i, s in enumerate(self.shapes)}

        def on_return(code, offset, retval):
            if code is not mm_code:
                return
            fr = sys._getframe(1)
            if fr.f_code is not mm_code:
                return
            loc = fr.f_locals
            topping = loc.get('Additional_Topping')
            labels = loc.get('shape_label')
            if labels is not None and len(labels) != n:
                return
            for tname, (t_top, i_lbl, g_lbl) in targets.items():
                if tname in captured:
                    continue
                if topping is None or abs(float(topping) - float(t_top)) > 1e-9:
                    continue
                r, c = shape_index.get(i_lbl), shape_index.get(g_lbl)
                if r is None or c is None:
                    continue
                vals, orient, skipped = {}, {}, []
                for k, v in list(loc.items()):
                    if k in ('results',) or k.startswith('__'):
                        continue
                    if 'sorted' in k or k.startswith('sort_ind'):
                        skipped.append(k)     # permuted by PhiMpx.argsort(); not indexable by the pair
                        continue
                    try:
                        val, o = reduce_local(k, v, r, c, n)
                    except Exception:
                        val, o = None, None
                    if o is None:
                        skipped.append(k)
                        continue
                    vals[k] = val
                    orient[k] = o
                for g in GLOBAL_CONSTANTS:
                    if g in self.ns and g not in vals:
                        vals[g] = _clean(self.ns[g])
                        orient[g] = 'g'
                captured[tname] = {'r': r, 'c': c, 'values': vals, 'orient': orient,
                                   'skipped': skipped, 'additional_topping': float(topping)}

        mon.register_callback(tid, mon.events.PY_RETURN, on_return)
        mon.set_local_events(tid, mm_code, mon.events.PY_RETURN)
        try:
            self._call(kw)
        finally:
            mon.set_local_events(tid, mm_code, 0)
            mon.register_callback(tid, mon.events.PY_RETURN, None)
        return captured

    # -- validation: solver-reported outputs vs captured internals ---------------
    def _validate(self, state_rec: dict, cap: dict, state_name: str = '') -> dict:
        checks = []
        for col, rkey in self.smap.df_columns.items():
            if col not in state_rec:
                continue
            local = self.smap.results_keys.get(rkey)
            if local is None or local not in cap['values']:
                continue
            reported = state_rec[col]
            got = cap['values'][local]
            if isinstance(got, dict) and 'infill' in got:
                got = got['infill'] if col.startswith('Infill') else got['girder']
            if reported is None and got is not None:
                # The solver leaves this column blank for this state (e.g. 'Total Topping'
                # outside the concrete path -- documented in the release's data/README.md).
                checks.append({'column': col, 'results_key': rkey, 'local': local,
                               'reported': None, 'captured': got, 'ok': None})
                continue
            ok = _same(reported, got)
            note = None
            # the best state reuses the concrete-path frame when added topping wins
            quirk_state = 'conc' if state_name == 'best' and (state_rec.get('Additional Topping') or 0) > 0 else state_name
            if not ok and (quirk_state, col) in KNOWN_REPORTING_QUIRKS:
                note = KNOWN_REPORTING_QUIRKS[(quirk_state, col)]
            checks.append({'column': col, 'results_key': rkey, 'local': local,
                           'reported': reported, 'captured': got, 'ok': ok, 'known_quirk': note})
        compared = [c for c in checks if c['ok'] is not None]
        n_quirk = sum(1 for c in compared if c['ok'] is False and c.get('known_quirk'))
        n_ok = sum(1 for c in compared if c['ok'])
        return {'n': len(compared), 'n_ok': n_ok, 'n_known_quirk': n_quirk,
                'n_not_reported': len(checks) - len(compared),
                'all_ok': (n_ok + n_quirk) == len(compared) and len(compared) > 0, 'checks': checks}

    # -- cross-check: re-run each engine line at the pair --------------------------
    def _recheck(self, cap: dict) -> dict:
        """Re-evaluate every re-evaluable engine assignment with the captured scalar
        inputs at this pair and compare with the captured result.

        Elementwise numpy arithmetic commutes with indexing, so evaluating a line on
        the pair's scalars must reproduce the pair's element of the full matrix. A
        mismatch would mean the capture mis-indexed a variable, or an input was
        overwritten later in the function; either is reported, never hidden.
        """
        vals, orient = cap['values'], cap['orient']
        assigned_count = {k: len(v) for k, v in self.smap.assignments.items()}
        env_base = {'np': np, 'ms': math, 'min': min, 'max': max, 'abs': abs, 'float': float,
                    'int': int, 'round': round, 'len': len, '__builtins__': {}}
        results = {}
        n_ok = n_bad = n_skip = 0
        for ln in self.smap.lines:
            var = ln['var']
            if var not in vals:
                continue
            o_lhs = orient.get(var)
            env = dict(env_base)
            usable = True
            for nm in ln['inputs']:
                if nm not in vals:
                    usable = False
                    break
                v, o = vals[nm], orient.get(nm)
                if o == 'both':
                    if o_lhs == 'r':
                        v = v['infill']
                    elif o_lhs == 'c':
                        v = v['girder']
                    else:
                        usable = False
                        break
                elif o == 'tbl':
                    usable = False
                    break
                if isinstance(v, list):
                    v = np.array([np.nan if x is None else x for x in v], dtype=float)
                elif v is None:
                    v = None if nm.endswith('_override') else np.nan
                elif isinstance(v, bool):
                    v = np.bool_(v)
                elif isinstance(v, (int, float)):
                    v = np.float64(v)
                env[nm] = v
            if not usable:
                n_skip += 1
                continue
            try:
                with np.errstate(all='ignore'), warnings.catch_warnings():
                    warnings.simplefilter('ignore')
                    got = eval(ln['expr'], env)  # noqa: S307 -- the solver's own source line
                got = np.asarray(got)
                if got.dtype.kind in 'US':
                    got = str(got.reshape(-1)[0]) if got.size else None
                elif got.size > 1:
                    got = [_clean(x) for x in got.reshape(-1)]
                else:
                    got = _clean(got.reshape(-1)[0]) if got.size else None
            except Exception:
                n_skip += 1
                continue
            want = vals[var]
            if isinstance(want, dict):
                want = want.get('girder' if o_lhs == 'c' else 'infill')
            if isinstance(got, list) or isinstance(want, list):
                gl = got if isinstance(got, list) else [got]
                wl = want if isinstance(want, list) else [want]
                ok = len(gl) == len(wl) and all(_same(a, b) for a, b in zip(gl, wl))
            else:
                ok = _same(got, want)
            if not ok and assigned_count.get(var, 1) > 1:
                # assigned on several branches (e.g. by infill count): only the branch
                # that ran is expected to reproduce the value
                results[ln['line']] = [None, got]
                n_skip += 1
                continue
            results[ln['line']] = [bool(ok), got]
            if ok:
                n_ok += 1
            else:
                n_bad += 1
        return {'n_ok': n_ok, 'n_bad': n_bad, 'n_skip': n_skip, 'lines': results}

    # -- public ---------------------------------------------------------------
    def design(self, p: dict, mode: str = 'optimize', infill_shape: str | None = None,
               girder_shape: str | None = None, capture: bool = True) -> dict:
        kw = self._kwargs(p)
        t0 = time.perf_counter()
        with _RUN_LOCK:
            res, log = self._call(kw)
            t1 = time.perf_counter()
            if res is None:
                return {'ok': False, 'error': 'The solver returned no design for these inputs '
                        '(it printed: ' + (log.strip().splitlines()[-1] if log.strip() else 'nothing') + ').',
                        'log': log[-4000:], 'inputs': kw}
            states = self._states(res)
            condition_class = int(res[6])
            targets = {}
            for nm, rec in states.items():
                if rec['_applies']:
                    targets[nm] = (float(rec.get('Additional Topping') or 0.0),
                                   rec['Infill Sizes'], rec['Girder Sizes'])
            if mode == 'check':
                if infill_shape not in self.shapes or girder_shape not in self.shapes:
                    return {'ok': False, 'error': 'Pick an infill and a girder W-shape from the AISC list.',
                            'inputs': kw}
                targets['check'] = (0.0, infill_shape, girder_shape)
            captured = self._capture(kw, targets) if capture else {}
            t2 = time.perf_counter()

        for nm, cap in captured.items():
            if nm in states:
                cap['validation'] = self._validate(states[nm], cap, nm)
            cap['recheck'] = self._recheck(cap)
        out = {
            'ok': True,
            'system': self.system,
            'mode': mode,
            'inputs': kw,
            'condition_class': condition_class,
            'method': METHOD_CODES.get(condition_class, str(condition_class)),
            'method_published': METHOD_FOLD.get(condition_class, condition_class),
            'states': states,
            'captured': captured,
            'timing_s': {'solve': round(t1 - t0, 3), 'capture': round(t2 - t1, 3)},
            'engine': self.provenance(),
            'variant': self._variant_info(kw),
        }
        return out

    def _variant_info(self, kw: dict) -> dict | None:
        if not self.variant:
            return None
        return {
                'name': self.variant,
                'infill_count': kw.get('num_infill_override'),
                'slab_total': kw.get('slab_total_override'),
                'member': {k: kw.get(k) for k in MEMBER_OVERRIDES if kw.get(k) is not None},
                'note': 'Set by the user instead of by the solver: '
                        + ', '.join(x for x in [
                            f"{kw.get('num_infill_override')} interior infills" if kw.get('num_infill_override') else '',
                            f"{kw.get('slab_total_override'):g} in total slab depth" if kw.get('slab_total_override') else '',
                            f"infill camber {kw['camber_II_override']:g} in" if kw.get('camber_II_override') is not None else '',
                            f"girder camber {kw['camber_IG_override']:g} in" if kw.get('camber_IG_override') is not None else '',
                            f"{kw['studs_II_override']} studs per infill" if kw.get('studs_II_override') is not None else '',
                            f"{kw['studs_IG_override']} studs per girder" if kw.get('studs_IG_override') is not None else '',
                        ] if x)
                        + '. Uses a copy of the published solver with one-line overrides (identical to it when not set); '
                          'everything else follows the published solver.'}

    def check_pair(self, p: dict, infill_shape: str, girder_shape: str) -> dict:
        """Capture one infill/girder pair only (the member check with user camber or studs).
        The optimizer's states are not taken from this run: with an override every shape
        would carry the user's value."""
        if infill_shape not in self.shapes or girder_shape not in self.shapes:
            return {'ok': False, 'error': 'Pick an infill and a girder W-shape from the AISC list.'}
        kw = self._kwargs(p)
        t0 = time.perf_counter()
        with _RUN_LOCK:
            captured = self._capture(kw, {'check': (0.0, infill_shape, girder_shape)})
        for cap in captured.values():
            cap['recheck'] = self._recheck(cap)
        return {'ok': 'check' in captured, 'captured': captured, 'inputs': kw, 'variant': self._variant_info(kw),
                'timing_s': round(time.perf_counter() - t0, 3)}

    def provenance(self) -> dict:
        return {'notebook': NOTEBOOKS[self.system], 'notebook_sha256': self.notebook_sha256,
                'solver_cell_sha256': self.source_sha256, 'python': sys.version.split()[0],
                'numpy': np.__version__, 'pandas': pd.__version__}

    def source_info(self) -> dict:
        return {'assignments': self.smap.assignments, 'results_keys': self.smap.results_keys,
                'lines': self.smap.lines,
                'df_columns': self.smap.df_columns, 'source': self.source,
                'building_uses': {str(k): list(v) for k, v in self.smap.building_uses.items()},
                'spacing_lookup': self.smap.spacing_lookup}


def _same(a, b, rel=1e-9, abs_=1e-12) -> bool:
    if a is None and b is None:
        return True
    if isinstance(a, str) or isinstance(b, str):
        return str(a) == str(b)
    try:
        fa, fb = float(a), float(b)
    except (TypeError, ValueError):
        return a == b
    if math.isnan(fa) and math.isnan(fb):
        return True
    return abs(fa - fb) <= max(abs_, rel * max(abs(fa), abs(fb)))


_ENGINES: dict = {}
_LOAD_LOCK = threading.Lock()


def get_engine(system: str, variant: str | None = None) -> PaperEngine:
    with _LOAD_LOCK:
        key = (system, variant)
        if key not in _ENGINES:
            _ENGINES[key] = PaperEngine(system, variant)
        return _ENGINES[key]
