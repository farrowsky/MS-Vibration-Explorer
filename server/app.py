"""
MS Vibration Explorer -- web server.

    python -m uvicorn server.app:app --port 8000        (from the repository root)

Serves the static front end in ``web/`` and a small JSON API around the paper's
solver (``server/engine.py``). The API itself lives in ``server/service.py`` so the
static build can run the same code in the browser (Pyodide). Built for a small, cheap host:

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
import os
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import service as svc
from .service import LIMITS, VERSION, DesignRequest, ServiceError  # noqa: F401  (re-exported)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
WEB = os.path.join(REPO, 'web')

MAX_QUEUE = int(os.environ.get('MSVE_MAX_QUEUE', '4'))


@contextlib.asynccontextmanager
async def _lifespan(_app):
    svc.warm_up()
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

_waiting = 0
_waiting_lock = threading.Lock()


def _call(fn, *args):
    try:
        return fn(*args)
    except ServiceError as e:
        raise HTTPException(e.status, e.detail)


# ---------------------------------------------------------------------------
# routes
# ---------------------------------------------------------------------------
@app.get('/api/health')
def health():
    return svc.health()


@app.get('/api/meta')
def meta():
    return svc.meta()


@app.get('/api/calcmap/{system}')
def get_calcmap(system: str):
    return _call(svc.calcmap, system)


@app.get('/api/source/{system}')
def get_source(system: str):
    return _call(svc.source, system)


@app.post('/api/design')
def design(req: DesignRequest):
    global _waiting
    req = _call(svc.check_request, req)
    hit = svc.cached(req)
    if hit is not None:
        return Response(hit, media_type='application/json', headers={'X-Cache': 'hit'})

    with _waiting_lock:
        if _waiting >= MAX_QUEUE:
            raise HTTPException(503, 'The solver is busy with other designs. Try again in a few seconds.')
        _waiting += 1
    try:
        blob = svc.run(req)
    finally:
        with _waiting_lock:
            _waiting -= 1
    return Response(blob, media_type='application/json', headers={'X-Cache': 'miss'})


# ---------------------------------------------------------------------------
# static front end
# ---------------------------------------------------------------------------
@app.get('/')
def index():
    return FileResponse(os.path.join(WEB, 'index.html'), headers={'Cache-Control': 'no-cache'})


app.mount('/', StaticFiles(directory=WEB), name='web')
