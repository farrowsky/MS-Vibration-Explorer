// Pyodide release the in-browser solver loads (static build). 0.29.x: Python 3.13 (sys.monitoring, as the engine
// needs), numpy 2.2, pandas 2.3 (< 3, as requirements.txt). Change it here only, then re-check a design against the
// server (docs/DEPLOY.md, "Static site").
export const PYODIDE_VERSION = '0.29.5';
