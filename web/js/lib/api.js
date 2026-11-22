// API client. API_BASE can be overridden (window.MSVE_API) when the static front end
// is hosted separately from the Python service.
const API = (window.MSVE_API || '').replace(/\/$/, '');

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

const cache = new Map();
function once(path) {
  if (!cache.has(path)) cache.set(path, j(path).catch(e => { cache.delete(path); throw e; }));
  return cache.get(path);
}

export const api = {
  meta: () => once('/api/meta'),
  calcmap: (system) => once(`/api/calcmap/${system}`),
  source: (system) => once(`/api/source/${system}`),
  design: (body, signal) => j('/api/design', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  }),
  health: () => j('/api/health'),
};
