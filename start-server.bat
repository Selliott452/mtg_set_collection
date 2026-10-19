@echo off
cd /d "%~dp0"
where node >NUL 2>&1 || (echo Node.js is not installed. Get the LTS version from https://nodejs.org and try again. & pause & goto :eof)
start "" http://localhost:8000
call npm start
pause
