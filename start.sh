#!/usr/bin/env bash
# Включить бота. Сам ставит всё нужное при первом запуске.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Создан файл .env — впишите в него токены (или попросите Claude Code)."
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "Первый запуск: устанавливаю зависимости…"
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi

if [ -f bot.pid ] && kill -0 "$(cat bot.pid)" 2>/dev/null; then
  echo "Бот уже работает."
  exit 0
fi

mkdir -p logs
nohup .venv/bin/python -m bot.main >> logs/console.log 2>&1 &
echo $! > bot.pid
sleep 8
if kill -0 "$(cat bot.pid)" 2>/dev/null; then
  echo "Бот включён. Он отвечает, пока работает этот компьютер."
else
  echo "Бот не запустился. Последние строки журнала:"
  tail -n 20 logs/console.log
  rm -f bot.pid
  exit 1
fi
