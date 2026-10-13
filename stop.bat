@echo off
chcp 65001 >nul
taskkill /FI "WINDOWTITLE eq dream-bot*" /T /F >nul 2>&1 && echo Бот выключен. || echo Бот и так не работал.
timeout /t 3 >nul
