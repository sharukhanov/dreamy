#!/usr/bin/env bash
# Разворачивает бота на бесплатном сервере Google Cloud (e2-micro).
# Повторный запуск обновляет код, база снов на сервере сохраняется.
# Нужно: gcloud с выполненным входом и выбранным проектом с подключённой оплатой.
set -euo pipefail
cd "$(dirname "$0")/.."

VM=${VM:-dream-bot}
ZONE=${ZONE:-us-central1-a}   # e2-micro бесплатен в us-central1, us-west1, us-east1

[ -f .env ] || { echo "Нет файла .env"; exit 1; }

gcloud services enable compute.googleapis.com --quiet

if ! gcloud compute instances describe "$VM" --zone "$ZONE" >/dev/null 2>&1; then
  echo "Создаю сервер $VM…"
  gcloud compute instances create "$VM" \
    --zone "$ZONE" \
    --machine-type e2-micro \
    --image-family debian-12 --image-project debian-cloud \
    --boot-disk-size 30GB --boot-disk-type pd-standard \
    --quiet
  echo "Жду, пока сервер загрузится…"
  sleep 40
fi

ARCHIVE=$(mktemp -d)/dream-bot.tar.gz
tar -czf "$ARCHIVE" \
  --exclude=.venv --exclude=.git --exclude=data --exclude=logs \
  --exclude=__pycache__ --exclude=.pytest_cache --exclude=.ruff_cache --exclude=bot.pid \
  .

for attempt in 1 2 3 4 5; do
  if gcloud compute scp "$ARCHIVE" "$VM:/tmp/dream-bot.tar.gz" --zone "$ZONE" --quiet; then
    break
  fi
  echo "Сервер ещё не готов, повторяю через 20 секунд…"
  sleep 20
done
rm -f "$ARCHIVE"

gcloud compute ssh "$VM" --zone "$ZONE" --quiet \
  --command "sudo bash -s" < deploy/server_setup.sh

echo "Готово: бот работает на сервере $VM."
