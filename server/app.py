"""
MS Vibration Explorer -- web server.

    python -m uvicorn server.app:app --port 8000        (from the repository root)

Serves the static front end in ``web/`` and a small JSON API around the paper's
solver (``server/engine.py``). Built for a small, cheap host:

* one solver run at a time (the solver peaks at roughly 0.4 GB), with a short
  bounded queue -- extra requests get HTTP 503 and the page asks the user to
  retry;
* an in-memory LRU cache of finished designs (optionally mirrored to disk with
  MSVE_CACHE_DIR), so repeat requests are instant;
* gzip on every response.

Environment variables
    MSVE_CACHE_DIR     directory for the on-disk design cache (default: none)
    MSVE_CACHE_SIZE    designs kept in memory (default 64)
    MSVE_MAX_QUEUE     solver requests allowed to wait (default 4)
    MSVE_ALLOW_ORIGIN  CORS origin when the front end is hosted elsewhere
"""
from __future__ import annotations

import contextlib
import gzip
import hashlib
import math
import json
import os
import threading
import time
from collections import OrderedDict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import calcmap
from . import engine as eng

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
WEB = os.path.join(REPO, 'web')
VERSION = '1.0.0'

CACHE_DIR = os.environ.get('MSVE_CACHE_DIR') or None
CACHE_SIZE = int(os.environ.get('MSVE_CACHE_SIZE', '64'))
MAX_QUEUE = int(os.environ.get('MSVE_MAX_QUEUE', '4'))

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

@contextlib.asynccontextmanager
async def _lifespan(_app):
    for s in eng.NOTEBOOKS:          # load both notebooks once, before the first request
        eng.get_engine(s)
    yield


app = FastAPI(title='MS Vibration Explorer', version=VERSION, docs_url='/api/docs', redoc_url=None,
              lifespan=_lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware('http')
async def _cache_headers(request, call_next):
    """Code revalidates on every load (cheap 304s, never stale after an update);
    the packed data and figures are cached for a day."""
    resp = await call_next(request)
    path = request.url.path
    if path.startswith('/api/'):
        resp.headers.setdefault('Cache-Control', 'no-store')
    elif path.endswith(('.bin', '.webp', '.svg', '.png')) or path.startswith('/vendor/'):
        resp.headers.setdefault('Cache-Control', 'public, max-age=86400')
    else:
        resp.headers.setdefault('Cache-Control', 'no-cache')
    return resp
if os.environ.get('MSVE_ALLOW_ORIGIN'):
    app.add_middleware(CORSMiddleware, allow_origins=[os.environ['MSVE_ALLOW_ORIGIN']],
                       allow_methods=['GET', 'POST'], allow_headers=['*'])


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


CACHE = _LRU(CACHE_SIZE, CACHE_DIR)
_waiting = 0
_waiting_lock = threading.Lock()


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
    infill_shape: str | None = None
    girder_shape: str | None = None


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
    return out


def _sanitize(o):
    if isinstance(o, float):
        return None if math.isnan(o) else ('inf' if o > 0 else '-inf') if math.isinf(o) else o
    if isinstance(o, dict):
        return {str(k): _sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_sanitize(v) for v in o]
    return o


def _dumps(o) -> bytes:
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


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------
@app.get('/api/health')
def health():
    return {'ok': True, 'version': VERSION}


@app.get('/api/meta')
def meta():
    systems = {}
    for s in eng.NOTEBOOKS:
        e = eng.get_engine(s)
        info = e.source_info()
        systems[s] = {'provenance': e.provenance(), 'building_uses': info['building_uses'],
                      'spacing_lookup': info['spacing_lookup'], 'shapes': e.shapes}
    return {'version': VERSION, 'limits': LIMITS, 'systems': systems,
            'states': eng.STATE_ORDER, 'state_labels': eng.STATE_LABELS,
            'methods': eng.METHOD_CODES, 'method_fold': eng.METHOD_FOLD,
            'known_quirks': [{'state': k[0], 'column': k[1], 'note': v}
                             for k, v in eng.KNOWN_REPORTING_QUIRKS.items()]}


@app.get('/api/calcmap/{system}')
def get_calcmap(system: str):
    if system not in eng.NOTEBOOKS:
        raise HTTPException(404)
    e = eng.get_engine(system)
    out = calcmap.calc_map(system, e.smap)
    out['assignments'] = e.smap.assignments      # every local -> the lines that assign it
    out['lines'] = e.smap.lines                  # lines the cross-check re-evaluates, with their inputs
    return out


@app.get('/api/source/{system}')
def get_source(system: str):
    if system not in eng.NOTEBOOKS:
        raise HTTPException(404)
    e = eng.get_engine(system)
    return {'notebook': eng.NOTEBOOKS[system], 'cell_sha256': e.source_sha256,
            'notebook_sha256': e.notebook_sha256, 'source': e.source}


@app.post('/api/design')
def design(req: DesignRequest):
    global _waiting
    if req.deck_type not in LIMITS['deck_type']:
        raise HTTPException(422, 'deck_type must be 1.5, 2 or 3')
    if req.mode == 'check':
        shapes = eng.get_engine(req.system).shapes
        if req.infill_shape not in shapes or req.girder_shape not in shapes:
            raise HTTPException(422, 'Pick an infill and a girder W-shape from the AISC list.')

    key = _cache_key(req)
    hit = CACHE.get(key)
    if hit is not None:
        return Response(hit, media_type='application/json', headers={'X-Cache': 'hit'})

    with _waiting_lock:
        if _waiting >= MAX_QUEUE:
            raise HTTPException(503, 'The solver is busy with other designs. Try again in a few seconds.')
        _waiting += 1
    try:
        t0 = time.perf_counter()
        e = eng.get_engine(req.system)
        out = e.design(req.model_dump(), mode=req.mode,
                       infill_shape=req.infill_shape, girder_shape=req.girder_shape)
        out['warnings'] = _warnings(req)
        out['request'] = req.model_dump()
        out['timing_s']['total'] = round(time.perf_counter() - t0, 3)
        out['generated_utc'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        out['tool_version'] = VERSION
        blob = _dumps(out)
    finally:
        with _waiting_lock:
            _waiting -= 1
    if out.get('ok'):
        CACHE.put(key, blob)
    return Response(blob, media_type='application/json', headers={'X-Cache': 'miss'})


# ---------------------------------------------------------------------------
# static front end
# ---------------------------------------------------------------------------
@app.get('/')
def index():
    return FileResponse(os.path.join(WEB, 'index.html'), headers={'Cache-Control': 'no-cache'})


app.mount('/', StaticFiles(directory=WEB), name='web')
