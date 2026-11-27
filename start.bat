@echo off
cd /d "%~dp0"
start "" "http://localhost:5188/"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
