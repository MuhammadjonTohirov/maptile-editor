# Map Tile Editor

Self-hosted Uzbekistan map editor built with MapLibre GL JS, Martin, FastAPI,
PostGIS, and an OpenMapTiles-compatible OSM vector archive.

## Architecture

```text
Uzbekistan OSM PBF ── OpenMapTiles build ── osm_uzbekistan.mbtiles ─┐
PostGIS editor features ────────────────────────────────────────────┼─ Martin ─ Nginx ─ MapLibre GL JS
                                                                    └─ /tiles/base and /tiles/editor
```

The OSM basemap archive is read-only. With editing enabled, selecting a
building, road, waterway, or POI creates an editable local PostGIS copy above
the basemap; user-created data and explicitly imported OSM copies use the same
overlay. The source MBTiles archive is never modified at runtime.

## First run

1. Build the deployment artifact. This is a release operation and requires
   Docker, Docker Compose, Git, curl, more than 15 GB free disk, and more than
   3 GB RAM.

   ```bash
   ./scripts/build-uzbekistan-tiles.sh
   ```

2. Start the stack.

   ```bash
   ./start.sh
   ```

3. Open http://localhost:3000.

The tile build script is pinned to an OpenMapTiles commit and writes
`tiles/osm_uzbekistan.manifest.json` with the OSM PBF checksum and build date.
Run it monthly to refresh the basemap. The PBF, MBTiles, and manifest are
deployment artifacts and intentionally ignored by Git.

## Services

| Service | Address | Responsibility |
| --- | --- | --- |
| Frontend | http://localhost:3000 | MapLibre editor and same-origin tile proxy |
| Client view | http://localhost:3000/client.html | Read-only map with all edits applied; auto-refreshes |
| API | http://localhost:8000 | Feature CRUD and optional bounded Overpass imports |
| Martin | internal only | Serves MBTiles basemap and PostGIS overlay tiles |
| PostGIS | localhost:5434 (configurable) | Editor feature storage |

The browser accesses vectors only through the frontend origin:

- `/tiles/base/{z}/{x}/{y}` — immutable OpenMapTiles-compatible OSM base
- `/tiles/editor/{z}/{x}/{y}` — dynamic editor overlay, reloaded after edits

Rendered tile geometry is clipped per tile and quantized, so selecting a
feature always reloads its authoritative geometry from `/api/features/{id}`
before reshaping. Coordinates handed to the drawing tools are normalized to
nine decimal places, the precision Terra Draw accepts.

The basemap archive itself is read-only. Editing a basemap object creates a
local PostGIS copy that visually replaces the original: the original is
filtered out of the base layers while the copy exists. Deleting the copy keeps
an invisible tombstone row (`source_kind=base_tombstone`) so the object stays
removed from the map; individual objects can be restored from the editor's
"Hidden basemap objects" list, and clearing editor data restores everything.

Editor tools: point/line/polygon/rectangle/circle drawing with vertex snapping
to saved features, whole-feature drag plus rotate (Ctrl+R) and scale (Ctrl+S),
duplicate, undo (Ctrl+Z), search-by-name with fly-to, and per-feature emoji
icons, which appear only at street-level zooms. Name labels render in both the
editor and the client view: point and polygon names at the feature's anchor,
street and line names along the road line itself. Roads label only their real
street title; unnamed roads carry no label.

The current view (zoom, center, bearing, pitch) is kept in the URL fragment in
both the editor and the client, so a location can be bookmarked, shared, or
reloaded in place. Road widths scale exponentially with zoom past the base
tiles' maxzoom (14) up to z20, per road class, so zoomed-in streets approach
plausible ground widths instead of freezing at a few pixels.

## Data and attribution

Attribution is visible in the map UI: `© OpenMapTiles © OpenStreetMap
contributors`. The frontend bundles its MapLibre and drawing dependencies, and
the map style uses local browser fonts, so no third-party map, tile, sprite, or
font service is requested at runtime.

## Development

The architectural rules every change must follow are documented in
[docs/architecture-rules.md](docs/architecture-rules.md).

```bash
npm ci
npm run check:frontend   # syntax checks, style-spec validation, layer-id audit
npm run build
docker compose config
docker compose exec backend python -m pytest tests -q   # backend unit tests
```

After the archive has been built and the stack is running, verify its public
routes with `./scripts/verify-stack.sh`.

The backend is small, flat modules by responsibility: `main.py` assembles the
app; `features_api.py` and `imports_api.py` hold the routes; `osm_import.py`
is the shared import pipeline; `overpass.py` talks to Overpass and parses OSM
tags; `serializers.py` converts rows to API shapes; `config.py` reads the
environment. The frontend mirrors that: `main.js` orchestrates the editor
using `api.js`, `geometry.js`, `layers.js`, `map-setup.js`, `strings.js`,
`base-masks.js`, and `emoji-icons.js`; `client.js` reuses the same modules.

Database schema comes exclusively from the idempotent SQL files in
`db/migrations/` (starting at `000_baseline.sql`). The Compose `migrations`
job applies each one exactly once before the backend and Martin start — a
fresh database needs nothing else. Existing database data is retained.

PostGIS uses host port `5434` by default to avoid colliding with other local
projects; containers continue to use `db:5432`. Set `POSTGRES_HOST_PORT` to
choose another host port.
