#!/usr/bin/env sh
# MS Vibration Explorer - start the local server and open the tool.
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
$PY -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' || { echo "Python 3.12 or newer is required."; exit 1; }
echo "Installing requirements (first run only)..."
$PY -m pip install --quiet -r requirements.txt
echo "Starting MS Vibration Explorer at http://localhost:8000  (Ctrl+C to stop)"
( sleep 2; command -v open >/dev/null && open http://localhost:8000 || xdg-open http://localhost:8000 ) >/dev/null 2>&1 &
exec $PY -m uvicorn server.app:app --port 8000
