// In-browser solver (static build, tools/build_pages.py): runs the paper's published code with Pyodide
// (CPython compiled to WebAssembly) in a Web Worker, through the same server/service.py the Python server uses.
//
// Messages in:  { id, op: 'design', body }      out: { id, ok: true, json } | { id, ok: false, status, detail }
//               { op: 'warm' }                   out: { type: 'status', text, ready? }
import { PYODIDE_VERSION } from './version.js';

const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const ROOT = '/msve';

const status = (text, extra = {}) => postMessage({ type: 'status', text, ...extra });

let ready = null;
function boot() {
  if (ready) return ready;
  ready = (async () => {
    const t0 = performance.now();
    status('Loading Python in your browser (first run only)…');
    const { loadPyodide } = await import(`${CDN}pyodide.mjs`);
    const py = await loadPyodide({ indexURL: CDN });
    status('Loading numpy, pandas and the paper\'s solver…');
    const base = new URL('../../py/', import.meta.url);
    const [man] = await Promise.all([
      fetch(new URL('manifest.json', base)).then(r => { if (!r.ok) throw new Error(`py/manifest.json: ${r.status}`); return r.json(); }),
      py.loadPackage(['numpy', 'pandas', 'pydantic'], { messageCallback: () => {} }),
    ]);
    await Promise.all(man.files.map(async (f) => {
      const r = await fetch(new URL(f.path.split('/').map(encodeURIComponent).join('/'), base));
      if (!r.ok) throw new Error(`py/${f.path}: ${r.status}`);
      const buf = new Uint8Array(await r.arrayBuffer());
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== f.sha256) throw new Error(`py/${f.path}: SHA-256 does not match the build manifest`);
      const dst = `${ROOT}/${f.path}`;
      py.FS.mkdirTree(dst.slice(0, dst.lastIndexOf('/')));
      py.FS.writeFile(dst, buf);
    }));
    py.runPython(`
import sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
from server import service as _msve

def _msve_design(body):
    try:
        return [200, _msve.design_json(body)]
    except _msve.ServiceError as e:
        return [e.status, str(e.detail)]
`);
    const design = py.globals.get('_msve_design');
    status('Python ready', { ready: true, seconds: (performance.now() - t0) / 1000 });
    return { py, design };
  })();
  ready.catch(() => { ready = null; });       // a failed boot (offline, CDN down) can be retried
  return ready;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  if (m.op === 'warm') { boot().catch(() => {}); return; }
  if (m.op !== 'design') return;
  try {
    const { design } = await boot();
    status('Running the paper\'s solver in your browser…');
    const r = design(JSON.stringify(m.body));
    const [code, payload] = r.toJs();
    r.destroy();
    if (code === 200) postMessage({ id: m.id, ok: true, json: payload });
    else postMessage({ id: m.id, ok: false, status: code, detail: payload });
  } catch (err) {
    // Pyodide failed to load, or an unexpected Python error: report it like a server error
    postMessage({ id: m.id, ok: false, status: 500, detail: String(err?.message || err).trim().split('\n').slice(-1)[0] });
  }
};
