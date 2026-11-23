// API client. API_BASE can be overridden (window.MSVE_API) when the static front end
// is hosted separately from the Python service.
//
// Static build (tools/build_pages.py sets window.MSVE_ENGINE = 'browser'): there is no server.
// The fixed answers (meta, calc maps, solver source) are prebuilt JSON under api/, and designs
// run in the visitor's browser with Pyodide (js/engine/worker.js), through the same Python code.
import { browserEngine } from '../engine/client.js';

const API = (window.MSVE_API || '').replace(/\/$/, '');
export const IN_BROWSER = window.MSVE_ENGINE === 'browser';

async function j(path, opts = {}) {
  const r = await fetch(API + path, opts);
  if (!r.ok) {
    let msg = `${r.status} ${r.statusText}`;
    try { const b = await r.json(); if (b.detail) msg = typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail); } catch {}
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

// '/api/meta' -> 'api/meta.json' (relative, so the site works under any path, e.g. user.github.io/repo/)
const get = (path) => (IN_BROWSER ? j(`${path.slice(1)}.json`) : j(path));

const cache = new Map();
function once(path) {
  if (!cache.has(path)) cache.set(path, get(path).catch(e => { cache.delete(path); throw e; }));
  return cache.get(path);
}

if (IN_BROWSER) browserEngine.warm();

export const api = {
  meta: () => once('/api/meta'),
  calcmap: (system) => once(`/api/calcmap/${system}`),
  source: (system) => once(`/api/source/${system}`),
  design: (body, signal) => (IN_BROWSER ? browserEngine.design(body) : j('/api/design', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  })),
  health: () => get('/api/health'),
};
