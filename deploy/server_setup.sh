#!/usr/bin/env bash
# Выполняется на сервере: ставит бота в /opt/dream-bot и включает автозапуск.
# Ожидает архив проекта в /tmp/dream-bot.tar.gz (его кладёт deploy/gcloud_deploy.sh).
set -euo pipefail

APP=/opt/dream-bot

if ! command -v python3 >/dev/null || ! python3 -c 'import venv, ensurepip' 2>/dev/null; then
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 python3-venv
fi

id dreambot >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin dreambot
mkdir -p "$APP"

# Код обновляем, а базу снов (data/) и журналы (logs/) не трогаем.
tar -xzf /tmp/dream-bot.tar.gz -C "$APP"
rm -f /tmp/dream-bot.tar.gz
chmod 600 "$APP/.env"

[ -x "$APP/.venv/bin/python" ] || python3 -m venv "$APP/.venv"
"$APP/.venv/bin/pip" install -q --upgrade pip
"$APP/.venv/bin/pip" install -q -r "$APP/requirements.txt"
chown -R dreambot:dreambot "$APP"

cp "$APP/deploy/dream-bot.service" /etc/systemd/system/dream-bot.service
systemctl daemon-reload
systemctl enable dream-bot >/dev/null 2>&1
systemctl restart dream-bot
sleep 5
systemctl is-active dream-bot
