#!/usr/bin/env bash
set -euo pipefail

# Build the ignored deployment artifact tiles/osm_uzbekistan.mbtiles using the
# pinned OpenMapTiles pipeline. This is intentionally a release operation: it
# needs Docker, Docker Compose, curl, git, >15 GB free disk, and >3 GB RAM.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TILES_DIR="$ROOT/tiles"
WORK_DIR="${TILE_BUILD_WORKDIR:-$ROOT/.tile-build}"
SOURCE_DIR="$WORK_DIR/openmaptiles"
PBF_URL="${OSM_PBF_URL:-https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf}"
OPENMAPTILES_REF="${OPENMAPTILES_REF:-e0fb5032d1069c21ba3fd25a37076a05e0314e79}"
PBF="$WORK_DIR/uzbekistan-latest.osm.pbf"
OUTPUT="$TILES_DIR/osm_uzbekistan.mbtiles"

# Keep the OpenMapTiles temporary database isolated from this app and from any
# other OpenMapTiles checkout on the workstation.
export DC_PROJECT="maptile_editor_tiles"
# OpenMapTiles publishes its temporary PostgreSQL port. Keep it away from the
# app's PostGIS port (5432); override for an unusual local conflict if needed.
export PGPORT="${TILE_BUILD_PGPORT:-55432}"
export COMPOSE_FILE="$SOURCE_DIR/docker-compose.yml:$ROOT/scripts/openmaptiles-compose.override.yml"

mkdir -p "$TILES_DIR" "$WORK_DIR"
if [ -f "$PBF" ]; then
  # A failed build can be retried without transferring the same large extract.
  # On a later refresh, curl downloads it again only when Geofabrik is newer.
  curl --fail --location --retry 3 --time-cond "$PBF" --output "$PBF" "$PBF_URL"
else
  curl --fail --location --retry 3 --output "$PBF" "$PBF_URL"
fi
if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(sha256sum "$PBF" | awk '{print $1}')"
else
  SHA256="$(shasum -a 256 "$PBF" | awk '{print $1}')"
fi

if [ ! -d "$SOURCE_DIR/.git" ]; then
  git clone https://github.com/openmaptiles/openmaptiles.git "$SOURCE_DIR"
fi
git -C "$SOURCE_DIR" fetch --tags --force origin
git -C "$SOURCE_DIR" checkout --detach "$OPENMAPTILES_REF"

pushd "$SOURCE_DIR" >/dev/null
make destroy-db || true
rm -f data/uzbekistan-latest.osm.pbf data/uzbekistan.osm.pbf \
  data/uzbekistan.bbox data/osm_uzbekistan.mbtiles
mkdir -p "$SOURCE_DIR/data"
cp "$PBF" "$SOURCE_DIR/data/uzbekistan.osm.pbf"

# The project Makefile supplies the complete OSM + Natural Earth import and
# PostGIS ST_MVT generation workflow. Keep its state in TILE_BUILD_WORKDIR.
MIN_ZOOM=0 MAX_ZOOM=14 MBTILES_FILE=osm_uzbekistan.mbtiles area=uzbekistan make import-data
MIN_ZOOM=0 MAX_ZOOM=14 MBTILES_FILE=osm_uzbekistan.mbtiles area=uzbekistan make import-osm
MIN_ZOOM=0 MAX_ZOOM=14 MBTILES_FILE=osm_uzbekistan.mbtiles area=uzbekistan make import-wikidata
MIN_ZOOM=0 MAX_ZOOM=14 MBTILES_FILE=osm_uzbekistan.mbtiles area=uzbekistan make import-sql
MIN_ZOOM=0 MAX_ZOOM=14 MBTILES_FILE=osm_uzbekistan.mbtiles area=uzbekistan make generate-bbox-file
MIN_ZOOM=0 MAX_ZOOM=14 MBTILES_FILE=osm_uzbekistan.mbtiles area=uzbekistan make generate-tiles-pg

cp "data/osm_uzbekistan.mbtiles" "$OUTPUT"
make destroy-db || true
popd >/dev/null

cat > "$TILES_DIR/osm_uzbekistan.manifest.json" <<EOF
{
  "region": "Uzbekistan",
  "source_url": "$PBF_URL",
  "source_sha256": "$SHA256",
  "openmaptiles_ref": "$OPENMAPTILES_REF",
  "minzoom": 0,
  "maxzoom": 14,
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "attribution": "© OpenMapTiles © OpenStreetMap contributors"
}
EOF

echo "Built $OUTPUT"
