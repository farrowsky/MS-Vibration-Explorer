# Hosting

The tool is one small Python web service (FastAPI + uvicorn) that serves the API and the static front end.

## Sizing

* One solver run takes 0.3–4 s of CPU and peaks at about **0.4 GB** of memory (the solver evaluates every pair of 273
  W-shapes as numpy matrices). The server runs **one solve at a time** (`server/engine.py` holds a lock) and allows
  `MSVE_MAX_QUEUE` requests (default 4) to wait. Beyond that it answers HTTP 503, and the page retries after a moment.
* Finished designs are cached in memory (`MSVE_CACHE_SIZE`, default 64). Set `MSVE_CACHE_DIR` to also keep them on disk
  as gzip JSON (about 30–60 kB each).
* **1 GB RAM / 1 shared vCPU** is enough. Use one uvicorn worker; more workers multiply memory, not throughput.
* The Design Space module is static (≈ 3 MB gzipped data + 4 MB of figures). Any CDN or static host can serve `web/`.

## Docker (Render, Railway, Fly.io, a VPS …)

```bash
docker build -t ms-vibration-explorer .
docker run -p 8000:8000 -e MSVE_CACHE_DIR=/tmp/msve ms-vibration-explorer
```

The image honours `$PORT`. Health check: `GET /api/health`.

## Front end on a static host, API elsewhere

Serve `web/` from the static host and add, before `js/main.js` in `index.html`:

```html
<script>window.MSVE_API = 'https://your-api.example.org';</script>
```

and start the API with `MSVE_ALLOW_ORIGIN=https://your-static-site.example.org`.

## Environment variables

| variable | default | meaning |
|---|---|---|
| `MSVE_CACHE_SIZE` | 64 | finished designs kept in memory |
| `MSVE_CACHE_DIR` | (none) | directory for the on-disk design cache |
| `MSVE_MAX_QUEUE` | 4 | solver requests allowed to wait |
| `MSVE_ALLOW_ORIGIN` | (none) | CORS origin when the front end is hosted elsewhere |
