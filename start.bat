@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .env (
  copy .env.example .env >nul
  echo Создан файл .env - впишите в него токены или попросите Claude Code.
  pause
  exit /b 1
)
if not exist .venv\Scripts\python.exe (
  echo Первый запуск: устанавливаю зависимости...
  py -3 -m venv .venv || python -m venv .venv
  .venv\Scripts\python.exe -m pip install -q -r requirements.txt
)
start "dream-bot" /min .venv\Scripts\python.exe -m bot.main
echo Бот включён. Он отвечает, пока работает этот компьютер.
timeout /t 5 >nul
