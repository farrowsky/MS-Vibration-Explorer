"""
Build the static site: the whole tool with no server, for GitHub Pages or any static host.

    python tools/build_pages.py [--out site]

The Bay Designer's solver runs in the visitor's browser with Pyodide (Python compiled to
WebAssembly). The site is ``web/`` plus:

* ``py/``   -- the files the in-browser engine loads: ``server/{engine,calcmap,service}.py`` and the
               release's notebooks and tables from ``engine/paper/`` (unmodified; SHA256SUMS checked
               here, and the engine hashes the notebooks again in the browser);
* ``api/``  -- the answers that never change (meta, calc maps, solver source), written as JSON by
               the same ``server/service.py`` functions the server uses, so pages load without
               starting Python;
* ``index.html`` with ``window.MSVE_ENGINE = 'browser'`` so ``web/js/lib/api.js`` sends designs to
  the in-browser engine instead of ``/api/design``.

Preview the result locally with ``python -m http.server -d site 8080``.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)
from server import engine as eng  # noqa: E402
from server import service as svc  # noqa: E402

PY_FILES = ['server/__init__.py', 'server/engine.py', 'server/calcmap.py', 'server/service.py']
MARKER = '<script type="module" src="js/main.js"></script>'


def check_release():
    """The notebooks and tables must be the release's bytes (engine/paper/SHA256SUMS)."""
    with open(os.path.join(eng.PAPER_DIR, 'SHA256SUMS'), encoding='utf-8') as fh:
        for line in fh:
            if not line.strip():
                continue
            digest, name = line.split(None, 1)
            name = name.strip().lstrip('*')
            if eng.sha256_file(os.path.join(eng.PAPER_DIR, name)) != digest:
                raise SystemExit(f'engine/paper/{name} does not match SHA256SUMS')


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(svc.dumps(obj))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--out', default=os.path.join(REPO, 'site'))
    out = os.path.abspath(ap.parse_args().out)

    check_release()
    if os.path.exists(out):
        shutil.rmtree(out)
    shutil.copytree(os.path.join(REPO, 'web'), out)

    # the in-browser engine's files, listed in a manifest with their hashes
    files = PY_FILES + [f'engine/paper/{n}' for n in sorted(os.listdir(eng.PAPER_DIR))]
    manifest = []
    for rel in files:
        dst = os.path.join(out, 'py', rel)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(os.path.join(REPO, rel), dst)
        with open(dst, 'rb') as fh:
            manifest.append({'path': rel, 'sha256': hashlib.sha256(fh.read()).hexdigest()})
    write_json(os.path.join(out, 'py', 'manifest.json'), {'files': manifest})

    # static API answers (identical to what the server returns)
    write_json(os.path.join(out, 'api', 'health.json'), svc.health())
    write_json(os.path.join(out, 'api', 'meta.json'), svc.meta())
    for s in eng.NOTEBOOKS:
        write_json(os.path.join(out, 'api', 'calcmap', f'{s}.json'), svc.calcmap(s))
        write_json(os.path.join(out, 'api', 'source', f'{s}.json'), svc.source(s))

    # switch the page to the in-browser engine
    idx = os.path.join(out, 'index.html')
    with open(idx, encoding='utf-8') as fh:
        html = fh.read()
    if MARKER not in html:
        raise SystemExit('index.html: main.js script tag not found')
    html = html.replace(MARKER, "<script>window.MSVE_ENGINE = 'browser';</script>\n" + MARKER)
    with open(idx, 'w', encoding='utf-8', newline='\n') as fh:
        fh.write(html)
    open(os.path.join(out, '.nojekyll'), 'w').close()     # keep __init__.py (GitHub Pages' Jekyll drops _files)

    size = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(out) for f in fs)
    print(f'built {out}: {len(manifest)} engine files, {size / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
