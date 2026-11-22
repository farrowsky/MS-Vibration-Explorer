@echo off
rem MS Vibration Explorer - double-click to open the app.
title MS Vibration Explorer
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch.ps1" %*
if errorlevel 1 pause
