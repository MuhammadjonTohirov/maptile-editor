#!/bin/sh
# One PostGIS backup: a compressed pg_dump custom-format file, timestamped and
# pruned to the newest BACKUP_KEEP. Run inside the db-backup service (Postgres
# client tools + the /backups volume), where PGHOST/PGUSER/… point at the db.
#
# Custom format (-Fc) is compressed and lets pg_restore do selective/parallel
# restores. pg_dump takes an MVCC snapshot (ACCESS SHARE only), so backups never
# block editing. The dump writes to a .partial file and is renamed only on
# success, so a crashed dump never looks like a complete backup.
set -eu

: "${PGHOST:=db}" "${PGPORT:=5432}" "${PGUSER:=postgres}" "${PGDATABASE:=mapdata}"
DIR="${BACKUP_DIR:-/backups}"
KEEP="${BACKUP_KEEP:-7}"

mkdir -p "$DIR"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="$DIR/${PGDATABASE}-${stamp}.dump"
tmp="$file.partial"
trap 'rm -f "$tmp"' EXIT

echo "[backup] pg_dump ${PGDATABASE}@${PGHOST} -> $file"
pg_dump -Fc -Z6 -f "$tmp"
mv "$tmp" "$file"
trap - EXIT
echo "[backup] done: $(du -h "$file" | cut -f1)"

# Prune: keep the newest $KEEP dumps, delete the rest. Sort by name, not mtime:
# the ISO-8601 timestamp in each filename sorts chronologically, so this stays
# correct even when several dumps share a modification time.
ls -1 "$DIR/${PGDATABASE}-"*.dump 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" | while read -r old; do
  echo "[backup] prune $old"
  rm -f "$old"
done
