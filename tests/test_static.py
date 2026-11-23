"""The static build (tools/build_pages.py): same answers as the server, engine files intact."""
import hashlib
import json
import os
import subprocess
import sys

import pytest

from server import engine as eng
from server import service as svc

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope='module')
def site(tmp_path_factory):
    out = tmp_path_factory.mktemp('site')
    subprocess.run([sys.executable, os.path.join(REPO, 'tools', 'build_pages.py'), '--out', str(out)], check=True)
    return out


def load(site, *parts):
    with open(os.path.join(site, *parts), 'rb') as fh:
        return json.loads(fh.read())


def test_static_api_matches_service(site):
    assert load(site, 'api', 'meta.json') == json.loads(svc.dumps(svc.meta()))
    for s in eng.NOTEBOOKS:
        assert load(site, 'api', 'calcmap', f'{s}.json') == json.loads(svc.dumps(svc.calcmap(s)))
        assert load(site, 'api', 'source', f'{s}.json') == json.loads(svc.dumps(svc.source(s)))


def test_engine_files_are_the_repository_bytes(site):
    man = load(site, 'py', 'manifest.json')['files']
    paths = {f['path'] for f in man}
    assert {'server/engine.py', 'server/service.py', 'server/calcmap.py', 'server/__init__.py'} <= paths
    assert {f'engine/paper/{n}' for n in eng.NOTEBOOKS.values()} <= paths
    for f in man:
        with open(os.path.join(REPO, f['path']), 'rb') as fh:
            assert hashlib.sha256(fh.read()).hexdigest() == f['sha256'], f['path']


def test_page_uses_the_browser_engine(site):
    with open(os.path.join(site, 'index.html'), encoding='utf-8') as fh:
        html = fh.read()
    assert "window.MSVE_ENGINE = 'browser'" in html
    assert html.index('MSVE_ENGINE') < html.index('js/main.js')
    assert os.path.exists(os.path.join(site, '.nojekyll'))


def test_design_json_matches_run():
    body = {'system': 'composite', 'girder_span': 30, 'infill_span': 30, 'mode': 'optimize'}
    got = json.loads(svc.design_json(json.dumps(body)))
    assert got['ok'] and got['states']['best']['Infill Sizes'] == 'W21X44'
    with pytest.raises(svc.ServiceError) as e:
        svc.design_json(json.dumps({**body, 'girder_span': 99}))
    assert e.value.status == 422
