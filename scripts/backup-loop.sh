#!/bin/sh
# Periodic backup loop for the db-backup service: one backup on start (so every
# deploy leaves a fresh dump), then every BACKUP_INTERVAL seconds (default 24h).
# A failed cycle is logged and retried next interval — the loop never dies, so
# one transient error can't silently stop all future backups.
set -eu

INTERVAL="${BACKUP_INTERVAL:-86400}"
echo "[backup] loop started; interval=${INTERVAL}s keep=${BACKUP_KEEP:-7}"
while true; do
  sh /scripts/backup.sh || echo "[backup] cycle FAILED; retrying in ${INTERVAL}s"
  sleep "$INTERVAL"
done
