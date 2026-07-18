#!/usr/bin/env bash
set -euo pipefail

# Load the whole Uzbekistan OSM extract into the editor's PostGIS features
# table as source_kind=osm_import, so every building, road, and street-light
# in the country is an editable feature without per-area Overpass imports.
#
# This is a maintenance operation like the tile build: it needs Docker, the
# running Compose stack (the db service), and a few GB of free disk. Re-runs
# are idempotent (ON CONFLICT on OSM identity). Refresh monthly alongside the
# tile archive.
#
# GDAL's OSM driver assembles way/relation geometry and loads three filtered
# staging tables; scripts/load-uzbekistan-osm.sql transforms them into
# features with the same mapping as the per-area importer, then they are
# dropped.
#
# Environment overrides:
#   OSM_PBF            path to the extract (default: the tile build's copy)
#   OSM_PBF_URL        download source when the extract is missing
#   COMPOSE_NETWORK    Docker network of the db service
#   LOAD_BBOX          "west south east north" to load a sub-region (testing)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${TILE_BUILD_WORKDIR:-$ROOT/.tile-build}"
PBF="${OSM_PBF:-$WORK_DIR/uzbekistan-latest.osm.pbf}"
PBF_URL="${OSM_PBF_URL:-https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf}"
NETWORK="${COMPOSE_NETWORK:-maptile-editor_default}"
GDAL_IMAGE="${GDAL_IMAGE:-ghcr.io/osgeo/gdal:alpine-small-latest}"
PSQL_IMAGE="${PSQL_IMAGE:-postgres:15-alpine}"
LOAD_BBOX="${LOAD_BBOX:-}"

PG_OGR="PG:host=db port=5432 user=postgres password=postgres dbname=mapdata"
PG_PSQL="postgresql://postgres:postgres@db:5432/mapdata"

# GDAL's OSM driver assembles way/relation geometry through a temporary SQLite
# database. With the extract mounted read-only it cannot create that database
# and silently truncates to the first in-memory chunk, so it gets a writable
# scratch directory (CPL_TMPDIR) here.
OSM_TMPDIR="$WORK_DIR/osm-load-tmp"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

if [ ! -f "$PBF" ]; then
  log "Extract not found; downloading $PBF_URL"
  mkdir -p "$WORK_DIR"
  curl --fail --location --retry 3 --output "$PBF" "$PBF_URL"
fi

if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  echo "Docker network '$NETWORK' not found. Start the stack (./start.sh) first," >&2
  echo "or set COMPOSE_NETWORK to the network of the db service." >&2
  exit 1
fi

SPAT_ARGS=()
if [ -n "$LOAD_BBOX" ]; then
  # shellcheck disable=SC2206
  SPAT_ARGS=(-spat $LOAD_BBOX)
  log "Loading sub-region only: $LOAD_BBOX"
fi

run_psql() {
  docker run --rm --network "$NETWORK" -e PGPASSWORD=postgres "$PSQL_IMAGE" \
    psql "$PG_PSQL" -v ON_ERROR_STOP=1 "$@"
}

run_ogr() {
  docker run --rm --network "$NETWORK" \
    -v "$PBF:/data/extract.osm.pbf:ro" -v "$OSM_TMPDIR:/osmtmp" "$GDAL_IMAGE" \
    ogr2ogr --config CPL_TMPDIR /osmtmp --config OSM_MAX_TMPFILE_SIZE 4000 \
    -f PostgreSQL "$PG_OGR" /data/extract.osm.pbf "$@"
}

log "Preparing staging schema"
mkdir -p "$OSM_TMPDIR"
run_psql -c "DROP SCHEMA IF EXISTS osm_load CASCADE; CREATE SCHEMA osm_load;"

COMMON_LCO=(-lco SCHEMA=osm_load -lco GEOMETRY_NAME=geom -lco SPATIAL_INDEX=NONE -a_srs EPSG:4326 -overwrite -progress)

log "Staging buildings (multipolygons)"
run_ogr multipolygons -nln multipolygons -where "building IS NOT NULL" "${COMMON_LCO[@]}" ${SPAT_ARGS[@]+"${SPAT_ARGS[@]}"}

log "Staging roads (lines)"
run_ogr lines -nln lines -where "highway IS NOT NULL" "${COMMON_LCO[@]}" ${SPAT_ARGS[@]+"${SPAT_ARGS[@]}"}

log "Staging street furniture (points)"
run_ogr points -nln points -where "highway IN ('traffic_signals','street_lamp')" "${COMMON_LCO[@]}" ${SPAT_ARGS[@]+"${SPAT_ARGS[@]}"}

log "Transforming staging into features"
run_psql -f - < "$ROOT/scripts/load-uzbekistan-osm.sql"

log "Cleaning up staging schema"
run_psql -c "DROP SCHEMA IF EXISTS osm_load CASCADE;"
rm -rf "$OSM_TMPDIR"

log "Imported feature counts (source_kind=osm_import)"
run_psql -c "SELECT feature_type, count(*) FROM features WHERE source_kind='osm_import' GROUP BY feature_type ORDER BY 2 DESC;"

log "Done. Reload the editor; it renders the whole country from editor tiles."
