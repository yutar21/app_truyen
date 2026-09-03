@echo off
title Novel Studio Web Server
cd /d "%~dp0"

echo ========================================================
echo   Novel Studio - Webnovel Studio Engine
echo   Dia chi Web GUI: http://127.0.0.1:8787
echo   AI Agent: Antigravity CLI (agy) / Google Gemini
echo ========================================================
echo.

:: Kiem tra xem port 8787 co dang chay khong
netstat -ano | findstr :8787 | findstr LISTENING >nul
if %errorlevel% equ 0 (
    echo [THONG BAO] Server Novel Studio dang chay san tren port 8787!
    echo Dang mo trinh duyet Web GUI...
    start http://127.0.0.1:8787
    echo.
    echo Neu ban muon khoi dong lai server, hay dong process node cu hoac chay lai file nay sau.
    ping -n 2 127.0.0.1 >nul
    exit /b 0
)

echo Dang khoi dong server va mo trinh duyet...
start "" http://127.0.0.1:8787
node bin/novel.mjs serve --port 8787
pause
