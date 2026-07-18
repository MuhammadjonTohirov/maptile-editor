#!/usr/bin/env bash
set -euo pipefail

base_url="${MAP_EDITOR_URL:-http://localhost:3000}"

curl --fail --silent --show-error "$base_url/" >/dev/null
curl --fail --silent --show-error "$base_url/api/health" >/dev/null
# A bounded read: the full-country dataset must never be serialized whole.
curl --fail --silent --show-error "$base_url/api/features?limit=1" | jq -e '.type == "FeatureCollection"' >/dev/null
curl --fail --silent --show-error "$base_url/api/meta" | jq -e 'has("full_base")' >/dev/null

# OpenMapTiles generation includes low-zoom global coverage even for a regional
# extract. A successful response proves Nginx and Martin rewrite the base path.
base_headers="$(curl --fail --silent --show-error --head "$base_url/tiles/base/0/0/0")"
printf '%s\n' "$base_headers" | rg -qi 'content-type:.*(protobuf|vector|octet-stream)'

# Dynamic editor tiles may be empty, but the route must remain valid.
curl --fail --silent --show-error --head "$base_url/tiles/editor/0/0/0" >/dev/null

echo "Map editor stack verification passed"
