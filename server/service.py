"""
MS Vibration Explorer -- the API without a web framework.

Everything the JSON API answers, as plain functions, so the same code runs in two places:

* ``server/app.py`` (FastAPI) wraps these for the hosted / local server;
* ``web/js/engine/worker.js`` runs them in the browser under Pyodide for the static build
  (``tools/build_pages.py``), where there is no server at all.

Errors a client should see are raised as ``ServiceError(status, detail)``.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
import threading
import time
from collections import OrderedDict

from pydantic import BaseModel, Field, ValidationError

from . import calcmap as _calcmap
from . import engine as eng

VERSION = '1.0.0'

# Input limits. The paper's design space is the "studied" range; the solver runs
# outside it (checked by tests/test_engine.py) and the page warns when it does.
LIMITS = {
    'span_ft': {'min': 6, 'max': 60, 'studied': [10, 50]},
    'percent_comp': {'min': 25, 'max': 95, 'studied': [25, 50, 75]},
    'deck_type': [1.5, 2, 3],
    'conc_type': {0: 'Normal-weight (145 pcf)', 1: 'Lightweight (110 pcf)'},
    'clear_spans': [1, 2, 3],
    'building_use': [1, 2, 3, 4],
    'floor_ft': {'min': 20, 'max': 2000},
}


class ServiceError(Exception):
    def __init__(self, status: int, detail):
        super().__init__(detail)
        self.status, self.detail = status, detail


# ---------------------------------------------------------------------------
# cache
# ---------------------------------------------------------------------------
class _LRU:
    def __init__(self, size: int, disk: str | None):
        self.size, self.disk = size, disk
        self.mem: OrderedDict[str, bytes] = OrderedDict()
        self.lock = threading.Lock()
        if disk:
            os.makedirs(disk, exist_ok=True)

    def get(self, key: str) -> bytes | None:
        with self.lock:
            if key in self.mem:
                self.mem.move_to_end(key)
                return self.mem[key]
        if self.disk:
            path = os.path.join(self.disk, key + '.json.gz')
            if os.path.exists(path):
                with open(path, 'rb') as fh:
                    blob = gzip.decompress(fh.read())
                self._put_mem(key, blob)
                return blob
        return None

    def _put_mem(self, key, blob):
        with self.lock:
            self.mem[key] = blob
            self.mem.move_to_end(key)
            while len(self.mem) > self.size:
                self.mem.popitem(last=False)

    def put(self, key: str, blob: bytes):
        self._put_mem(key, blob)
        if self.disk:
            tmp = os.path.join(self.disk, key + '.tmp')
            with open(tmp, 'wb') as fh:
                fh.write(gzip.compress(blob, 6))
            os.replace(tmp, os.path.join(self.disk, key + '.json.gz'))


CACHE = _LRU(int(os.environ.get('MSVE_CACHE_SIZE', '64')), os.environ.get('MSVE_CACHE_DIR') or None)


# ---------------------------------------------------------------------------
# request model
# ---------------------------------------------------------------------------
class DesignRequest(BaseModel):
    system: str = Field('composite', pattern='^(composite|noncomposite)$')
    girder_span: int = Field(30, ge=LIMITS['span_ft']['min'], le=LIMITS['span_ft']['max'])
    infill_span: int = Field(30, ge=LIMITS['span_ft']['min'], le=LIMITS['span_ft']['max'])
    conc_type: int = Field(0, ge=0, le=1)
    deck_type: float = 3
    percent_comp: int = Field(50, ge=LIMITS['percent_comp']['min'], le=LIMITS['percent_comp']['max'])
    building_use: int = Field(3, ge=1, le=4)
    clear_spans: int = Field(3, ge=1, le=3)
    floor_length: float = Field(200, ge=LIMITS['floor_ft']['min'], le=LIMITS['floor_ft']['max'])
    floor_width: float = Field(200, ge=LIMITS['floor_ft']['min'], le=LIMITS['floor_ft']['max'])
    mode: str = Field('optimize', pattern='^(optimize|check)$')
    num_infill: int | None = Field(None, ge=1, le=14)   # None = the solver decides (published method)
    slab_total: float | None = Field(None, ge=3, le=9)  # total slab depth, in; None = lightest that works
    infill_shape: str | None = None
    girder_shape: str | None = None
    # member check only (composite): None = as the solver sets them
    camber_infill: float | None = Field(None, ge=0, le=6)    # in
    camber_girder: float | None = Field(None, ge=0, le=6)    # in
    studs_infill: int | None = Field(None, ge=0, le=400)     # studs on one infill
    studs_girder: int | None = Field(None, ge=0, le=400)     # studs on one girder


MEMBER_FIELDS = ('camber_infill', 'camber_girder', 'studs_infill', 'studs_girder')


def _normalize(req: DesignRequest) -> DesignRequest:
    """Member overrides belong to the composite member check; drop them anywhere else."""
    if req.mode != 'check' or req.system != 'composite':
        req = req.model_copy(update={k: None for k in MEMBER_FIELDS})
    return req


def _uses_variant(req: DesignRequest) -> bool:
    return bool(req.num_infill or req.slab_total) or any(getattr(req, k) is not None for k in MEMBER_FIELDS)


def _warnings(req: DesignRequest) -> list[str]:
    out = []
    lo, hi = LIMITS['span_ft']['studied']
    for nm, v in (('Girder span', req.girder_span), ('Infill span', req.infill_span)):
        if not lo <= v <= hi:
            out.append(f'{nm} {v} ft is outside the {lo}-{hi} ft range studied in the paper.')
    if req.system == 'composite' and req.percent_comp not in LIMITS['percent_comp']['studied']:
        out.append(f'{req.percent_comp}% composite was not one of the levels studied in the paper (25, 50, 75%).')
    if req.building_use != 3:
        out.append('The paper studied residential floors; other occupancies use the solver\'s own '
                   'DG 11 table but were not part of the published results.')
    if req.clear_spans != 3:
        out.append('The paper used deck continuous over 3 spans.')
    if req.num_infill:
        out.append(f'Interior infill count set to {req.num_infill} by the user; by default the solver derives it '
                   'from the deck table.')
    if req.slab_total:
        out.append(f'Total slab depth set to {req.slab_total:g} in by the user; by default the solver picks the '
                   'lightest deck and topping that work.')
    for k, what, unit in (('camber_infill', 'Infill camber', ' in'), ('camber_girder', 'Girder camber', ' in'),
                          ('studs_infill', 'Studs per infill', ''), ('studs_girder', 'Studs per girder', '')):
        v = getattr(req, k)
        if v is not None:
            out.append(f'{what} set to {v:g}{unit} by the user, instead of the value the solver computes.')
    return out


def _sanitize(o):
    if isinstance(o, float):
        return None if math.isnan(o) else ('inf' if o > 0 else '-inf') if math.isinf(o) else o
    if isinstance(o, dict):
        return {str(k): _sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_sanitize(v) for v in o]
    return o


def dumps(o) -> bytes:
    try:
        return json.dumps(o, allow_nan=False, default=str).encode()
    except ValueError:
        return json.dumps(_sanitize(o), allow_nan=False, default=str).encode()


def _cache_key(req: DesignRequest) -> str:
    e = eng.get_engine(req.system)
    d = req.model_dump()
    if req.system == 'noncomposite':
        d['percent_comp'] = None
    if req.mode == 'optimize':
        d['infill_shape'] = d['girder_shape'] = None
    blob = json.dumps({'req': d, 'engine': e.source_sha256, 'v': VERSION}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


def _stamp(out: dict, req: DesignRequest):
    out['warnings'] = _warnings(req)
    out['request'] = req.model_dump()
    out['generated_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    out['tool_version'] = VERSION


# ---------------------------------------------------------------------------
# the API
# ---------------------------------------------------------------------------
def health() -> dict:
    return {'ok': True, 'version': VERSION}


def warm_up():
    for s in eng.NOTEBOOKS:          # load both notebooks once, before the first request
        eng.get_engine(s)


def meta() -> dict:
    systems = {}
    for s in eng.NOTEBOOKS:
        e = eng.get_engine(s)
        info = e.source_info()
        systems[s] = {'provenance': e.provenance(), 'building_uses': info['building_uses'],
                      'spacing_lookup': info['spacing_lookup'], 'shapes': e.shapes}
    return {'version': VERSION, 'limits': LIMITS, 'systems': systems, 'slab_options': eng.slab_options(),
            'states': eng.STATE_ORDER, 'state_labels': eng.STATE_LABELS,
            'methods': eng.METHOD_CODES, 'method_fold': eng.METHOD_FOLD,
            'known_quirks': [{'state': k[0], 'column': k[1], 'note': v}
                             for k, v in eng.KNOWN_REPORTING_QUIRKS.items()]}


def calcmap(system: str) -> dict:
    if system not in eng.NOTEBOOKS:
        raise ServiceError(404, 'Not Found')
    e = eng.get_engine(system)
    out = _calcmap.calc_map(system, e.smap)
    out['assignments'] = e.smap.assignments      # every local -> the lines that assign it
    out['lines'] = e.smap.lines                  # lines the cross-check re-evaluates, with their inputs
    return out


def source(system: str) -> dict:
    if system not in eng.NOTEBOOKS:
        raise ServiceError(404, 'Not Found')
    e = eng.get_engine(system)
    return {'notebook': eng.NOTEBOOKS[system], 'cell_sha256': e.source_sha256,
            'notebook_sha256': e.notebook_sha256, 'source': e.source}


def check_request(req: DesignRequest) -> DesignRequest:
    """Normalise a validated request and apply the checks the model cannot express."""
    req = _normalize(req)
    if req.deck_type not in LIMITS['deck_type']:
        raise ServiceError(422, 'deck_type must be 1.5, 2 or 3')
    if req.mode == 'check':
        shapes = eng.get_engine(req.system).shapes
        if req.infill_shape not in shapes or req.girder_shape not in shapes:
            raise ServiceError(422, 'Pick an infill and a girder W-shape from the AISC list.')
    return req


def cached(req: DesignRequest) -> bytes | None:
    return CACHE.get(_cache_key(req))


def _member_check(req: DesignRequest) -> dict:
    """Member check with the user's camber or studs. The optimizer's states come from the run
    without them (usually already cached); only the checked pair is captured with them."""
    base_req = req.model_copy(update={k: None for k in MEMBER_FIELDS})
    bkey = _cache_key(base_req)
    hit = CACHE.get(bkey)
    if hit is not None:
        out = json.loads(hit)
    else:
        e = eng.get_engine(base_req.system, 'user' if _uses_variant(base_req) else None)
        out = e.design(base_req.model_dump(), mode='check',
                       infill_shape=base_req.infill_shape, girder_shape=base_req.girder_shape)
        if out.get('ok'):
            _stamp(out, base_req)
            blob = dumps(out)
            CACHE.put(bkey, blob)
            out = json.loads(blob)
    if not out.get('ok'):
        return out
    chk = eng.get_engine(req.system, 'user').check_pair(req.model_dump(), req.infill_shape, req.girder_shape)
    if not chk['ok']:
        return {'ok': False, 'error': 'The solver did not evaluate this pair with these values.', 'inputs': chk['inputs']}
    out['captured']['check'] = chk['captured']['check']
    out['variant'] = chk['variant']
    out['inputs'] = chk['inputs']
    out['timing_s'] = {**out.get('timing_s', {}), 'capture': chk['timing_s']}
    return out


def run(req: DesignRequest) -> bytes:
    """Solve a checked request (``check_request``) and cache it when it succeeds."""
    t0 = time.perf_counter()
    if any(getattr(req, k) is not None for k in MEMBER_FIELDS):
        out = _member_check(req)
    else:
        e = eng.get_engine(req.system, 'user' if _uses_variant(req) else None)
        out = e.design(req.model_dump(), mode=req.mode,
                       infill_shape=req.infill_shape, girder_shape=req.girder_shape)
    _stamp(out, req)
    out.setdefault('timing_s', {})['total'] = round(time.perf_counter() - t0, 3)
    blob = dumps(out)
    if out.get('ok'):
        CACHE.put(_cache_key(req), blob)
    return blob


def design_json(body: str) -> str:
    """The whole /api/design call on a JSON string (used by the in-browser engine)."""
    try:
        req = DesignRequest.model_validate_json(body)
    except ValidationError as ex:
        raise ServiceError(422, '; '.join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in ex.errors()))
    req = check_request(req)
    blob = cached(req)
    return (blob if blob is not None else run(req)).decode()
