@echo off
rem MS Vibration Explorer - start the local server and open the tool.
cd /d "%~dp0"
where python >nul 2>nul || (echo Python 3.12+ is required: https://www.python.org/downloads/ & pause & exit /b 1)
python -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" || (echo Python 3.12 or newer is required. & pause & exit /b 1)
echo Installing requirements (first run only)...
python -m pip install --quiet -r requirements.txt
echo Starting MS Vibration Explorer at http://localhost:8000  (close this window to stop)
start "" http://localhost:8000
python -m uvicorn server.app:app --port 8000
pause
