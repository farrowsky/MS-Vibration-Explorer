// Main-thread side of the in-browser solver (web/js/engine/worker.js). Used by lib/api.js when the page is the
// static build (window.MSVE_ENGINE === 'browser'). Status lines go out as a 'msve-engine' window event.
let worker = null, seq = 0;
const waiting = new Map();

function get() {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'status') { window.dispatchEvent(new CustomEvent('msve-engine', { detail: m })); return; }
    const p = waiting.get(m.id);
    if (!p) return;
    waiting.delete(m.id);
    if (m.ok) p.resolve(JSON.parse(m.json));
    else { const err = new Error(m.detail); err.status = m.status; p.reject(err); }
  };
  worker.onerror = (e) => {
    const err = new Error(`In-browser solver failed to start: ${e.message || 'unknown error'}`);
    err.status = 500;
    for (const p of waiting.values()) p.reject(err);
    waiting.clear();
    worker = null;
  };
  return worker;
}

export const browserEngine = {
  // start downloading Python in the background so the first design is quicker
  warm() { get().postMessage({ op: 'warm' }); },
  design(body) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      get().postMessage({ id, op: 'design', body });
    });
  },
};
