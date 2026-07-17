#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASEMAP="$ROOT/tiles/osm_uzbekistan.mbtiles"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker first."
  exit 1
fi

if [ ! -f "$BASEMAP" ]; then
  echo "Missing $BASEMAP"
  echo "Build the self-hosted Uzbekistan vector basemap first:"
  echo "  ./scripts/build-uzbekistan-tiles.sh"
  exit 1
fi

docker compose up -d --build
docker compose ps

echo
echo "Map editor:  http://localhost:3000"
echo "Backend API: http://localhost:8000/docs"
echo "Vector tiles: http://localhost:3000/tiles/base/{z}/{x}/{y}"
