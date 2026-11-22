from fastapi.testclient import TestClient

from server.app import app

client = TestClient(app)


def test_health_and_meta():
    assert client.get('/api/health').json()['ok']
    m = client.get('/api/meta').json()
    assert set(m['systems']) == {'composite', 'noncomposite'}
    assert len(m['systems']['composite']['shapes']) == 273
    assert m['systems']['composite']['provenance']['notebook'] == 'Composite MS Code.ipynb'


def test_calcmap_lists_engine_lines():
    cm = client.get('/api/calcmap/composite').json()
    assert cm['sections'] and cm['checks']['infill'] and cm['lines']
    assert 'peak_acceleration' in cm['assignments']


def test_design_and_cache():
    body = dict(system='noncomposite', girder_span=24, infill_span=20, conc_type=0, deck_type=2, building_use=3,
                clear_spans=3, floor_length=200, floor_width=200, mode='optimize')
    r1 = client.post('/api/design', json=body)
    assert r1.status_code == 200 and r1.json()['ok']
    r2 = client.post('/api/design', json=body)
    assert r2.headers['X-Cache'] == 'hit'
    assert r1.json()['states'] == r2.json()['states']


def test_rejects_bad_input():
    assert client.post('/api/design', json=dict(girder_span=200)).status_code == 422
    assert client.post('/api/design', json=dict(deck_type=2.5)).status_code == 422
    bad = dict(system='composite', mode='check', infill_shape='W99X1', girder_shape='W24X55')
    assert client.post('/api/design', json=bad).status_code == 422


def test_static_front_end():
    r = client.get('/')
    assert r.status_code == 200 and 'MS Vibration Explorer' in r.text
    assert client.get('/js/main.js').status_code == 200
