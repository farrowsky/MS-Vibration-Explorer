# Hosting

Two ways to host the tool: as a **static site** where the solver runs in the visitor's browser (free, e.g. GitHub
Pages), or as one small **Python web service** (FastAPI + uvicorn) that serves the API and the front end.

## Static site (GitHub Pages, no server)

```bash
python tools/build_pages.py                  # writes site/
python -m http.server -d site 8080           # preview at http://localhost:8080
```

`site/` is `web/` plus:

* `py/`: the in-browser engine's files: `server/{engine,calcmap,service}.py` and the release's notebooks and tables
  (checked against `engine/paper/SHA256SUMS` at build time, and against the build's `py/manifest.json` hashes in the
  browser);
* `api/`: the answers that never change (meta, calc maps, solver source) as JSON, written by the same
  `server/service.py` functions the server uses;
* `index.html` with `window.MSVE_ENGINE = 'browser'`, which makes `web/js/lib/api.js` send designs to
  `web/js/engine/worker.js` instead of `/api/design`.

The worker loads [Pyodide](https://pyodide.org) from the jsDelivr CDN (version in `web/js/engine/version.js`; 0.29.x =
Python 3.13, numpy 2.2, pandas 2.3), writes the engine files into its virtual file system and calls
`service.design_json()`. Nothing else changes: the published notebooks are `exec`'d unmodified, `sys.monitoring`
captures the calculation and the four validations run in the browser.

* **Speed:** the first design downloads Python, numpy and pandas (about 25 s on a fast connection; the browser caches
  them afterwards). Later designs take 3–12 s, and repeats are instant (in-memory cache).
* **Checked:** designs computed in the browser and natively agree bit for bit (members, peak acceleration, frequency,
  carbon, studs, camber, every validation count). After changing the Pyodide version, compare a few designs again,
  including one on the published grid (the Validation tab shows the dataset comparison).

**GitHub Pages.** `.github/workflows/pages.yml` builds and publishes `site/` on every push to `main`. Turn it on once:
repository **Settings → Pages → Source: GitHub Actions**. On a free GitHub plan, Pages needs a public repository.

## Python service

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
docker build -t parafloor .
docker run -p 8000:8000 -e MSVE_CACHE_DIR=/tmp/msve parafloor
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
