@echo off
rem ParaFloor - double-click to open the app.
title ParaFloor
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch.ps1" %*
if errorlevel 1 pause
