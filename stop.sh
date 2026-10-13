#!/usr/bin/env bash
# Выключить бота.
cd "$(dirname "$0")"
if [ -f bot.pid ] && kill -0 "$(cat bot.pid)" 2>/dev/null; then
  kill "$(cat bot.pid)"
  rm -f bot.pid
  echo "Бот выключен."
else
  rm -f bot.pid
  echo "Бот и так не работал."
fi
