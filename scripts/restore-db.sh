#!/bin/sh
# DESTRUCTIVE: replace the current database with a backup produced by backup.sh.
# Run inside the db-backup service, which has the Postgres client tools and the
# /backups volume:
#
#   docker compose stop backend martin        # release their connections first
#   docker compose run --rm --entrypoint sh db-backup \
#       /scripts/restore-db.sh /backups/mapdata-YYYYMMDDTHHMMSSZ.dump
#   docker compose start backend martin
#
# --clean --if-exists drops each object before recreating it, so the restore is
# in-place; --no-owner keeps everything owned by the connecting role.
set -eu

: "${PGHOST:=db}" "${PGPORT:=5432}" "${PGUSER:=postgres}" "${PGDATABASE:=mapdata}"
file="${1:?usage: restore-db.sh <backup.dump>  (a pg_dump custom-format file)}"

[ -f "$file" ] || { echo "restore: no such file: $file" >&2; exit 1; }

echo "[restore] replacing ${PGDATABASE}@${PGHOST} from $file"
echo "[restore] this overwrites current data. Ctrl-C within 5s to abort."
sleep 5
pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$file"
echo "[restore] done. Start backend + martin again."
