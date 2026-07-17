# Maptile Editor

## Purpose

This project is a self-hosted map editor. It renders an OpenMapTiles-compatible
OSM vector basemap in MapLibre GL JS, stores user edits in PostGIS, and exposes
both data sources through Martin vector tiles.

## Runtime architecture

```
Browser (MapLibre GL JS + Terra Draw)
            |
            v
Nginx / frontend (:3000)
   | /api/*                   | /tiles/base/*, /tiles/editor/*
   v                          v
FastAPI (:8000)            Martin
   |                          |-- tiles/osm_uzbekistan.mbtiles
   v                          `-- PostGIS features table
PostGIS (host :5434; internal :5432)
```

- `frontend/styles/editor.json` is the only client map style.
- `frontend/client.html` (`src/client.js`) is a read-only viewer that polls
  `/api/features` to pick up edits automatically. It hides all basemap detail
  layers (buildings, roads, waterways, POIs, road labels) — the basemap only
  provides context (terrain, water, boundaries, place names) and every detail
  object comes from editor data, restyled with the basemap palette.
- `tiles/osm_uzbekistan.mbtiles` is a generated, ignored deployment artifact.
- `db/migrations/` is the only schema authority. `000_baseline.sql` bootstraps
  a fresh database; there are no separate init scripts.
- `docs/architecture-rules.md` holds the per-layer architecture rules (X/B/D/F
  ids); every change must comply with them.

## Code layout

- Backend (flat modules, one responsibility each): `main.py` assembles the
  app; `features_api.py` (CRUD routes), `imports_api.py` (import routes),
  `osm_import.py` (shared fetch→parse→upsert pipeline), `overpass.py`
  (Overpass client + tag parsing), `serializers.py` (row→API shapes),
  `schemas.py`, `models.py`, `database.py`, `config.py`. Unit tests in
  `backend/tests/` run without a database.
- Frontend (`frontend/src/`): `main.js` is the MapEditor orchestrator;
  `client.js` the read-only viewer. Both share `api.js` (the only HTTP
  client; throws `ApiError` with status), `geometry.js`, `layers.js`
  (layer-id lists + guarded visibility helper), `map-setup.js`,
  `strings.js` (all user-visible copy, `t(key, params)`), `emoji-icons.js`,
  and `base-masks.js`. `strings.js` resolves the locale (`?lang=` → saved
  choice → browser language → English) against the catalogs in
  `frontend/src/locales/{en,uz,ru}.js` and applies `data-i18n` markup via
  `localizeDocument()`; `npm run check:frontend` enforces key and
  placeholder parity across catalogs.

## First run

```bash
./scripts/build-uzbekistan-tiles.sh
./start.sh
```

The tile build downloads the Uzbekistan extract from Geofabrik and runs the
pinned OpenMapTiles build pipeline. It produces zoom levels 0–14. Refresh it
monthly, keeping the generated provenance manifest with the archive.

## Development commands

```bash
npm ci
npm run check:frontend   # syntax + style-spec validation + layer-id audit
npm run build
python3 -B -m py_compile backend/*.py
docker compose config
docker compose exec backend python -m pytest tests -q
./scripts/verify-stack.sh
```

Run `./scripts/verify-stack.sh` only after the tile archive is built and the
Compose stack is running. After frontend changes rebuild the image
(`docker compose build frontend && docker compose up -d frontend`); the
backend is volume-mounted and reloads on save.

## Editing model

- Use Terra Draw modes for point, line, polygon, rectangle, circle, and
  select/edit operations. Drawing and vertex drags snap to saved editor
  vertices (`snapToEditorVertex`); selected features support whole-feature
  drag, rotate (Ctrl+R+drag), and scale (Ctrl+S+drag).
- Icons/emoji render from the `editor_anchors` GeoJSON source (one anchor
  point per feature — never from tiled geometry, which would duplicate symbols
  per tile). Names of point and polygon features label at their anchor too;
  names of line features (streets, waterways) instead render along the tiled
  line geometry (`editor-*-line-labels`, `symbol-placement: line`), so anchors
  never carry a line feature's name.
- The `name` column is the feature's title; for roads it is the street name.
  Imports fill it only from OSM's `name` tag — never a fabricated placeholder
  like "Service Road" — and re-imports only backfill an empty name, never
  overwrite one. Features without a name render no label anywhere.
- The editor keeps a client-side undo stack (`pushUndo`) of inverse API calls
  for create/update/delete/duplicate/restore; Undo button or Ctrl+Z.
- The frontend persists edits through `/api/features` and refreshes the Martin
  PostGIS vector source after each change.
- Never feed rendered tile geometry to Terra Draw or persist it: it is clipped
  per tile, quantized, and can be Multi*. Selection reloads the authoritative
  geometry from `/api/features/{id}`, and every geometry entering the editor is
  normalized to single-part types rounded to 9 decimals
  (`normalizeGeometry` in `frontend/src/geometry.js`).
- Feature columns are canonical; the JSONB `properties` blob stores only
  extras (`osm_tags`, `base_source*`, `base_feature_id`). API reads merge
  columns into GeoJSON properties; frontend payloads strip column keys from
  stored properties before sending.
- Optional OSM imports are bounded to a small viewport and are upserted using
  OSM type and ID. Imported features are marked `source_kind=osm_import`.
- While editing at zoom ≥ 15, viewport roads are imported automatically
  (`prepareViewportRoads`) so every road is a tappable editor feature with its
  full OSM geometry — base road tiles are fragmented per tile and too thin to
  hit reliably. Click selection also uses a 6px box around the pointer.
- Manual edits are marked `source_kind=manual` and stay visually distinct from
  imported OSM data.
- Features can carry an emoji in the `icon` column. Styles reference it as an
  `emoji:<char>` image; `frontend/src/emoji-icons.js` rasterizes emoji on the
  `styleimagemissing` event, so no sprite sheet is needed. Points with an icon
  render as the emoji instead of a circle; polygons show it at their center.
  Icons are street-level detail: imported ones (traffic/street lights) appear
  from z15 — the zoom where viewport roads import — manual ones from z14,
  both scaling up from 0.5 to 0.75 by z17.
- The basemap archive is read-only. Clicking a basemap feature creates a local
  copy carrying `base_feature_id`/`base_source_layer`, and the frontend masks
  the original out of the base style layers (`applyBaseFeatureMasks`) so the
  copy replaces it visually. Imported OSM buildings/waterways/POIs mask their
  originals through `osm_id` (OpenMapTiles keeps the OSM id as the tile feature
  id); roads are excluded because the transportation layer merges ways.
  Deleting any base-shadowing feature (copy or import) tombstones it, and the
  import endpoints skip tombstoned rows so re-imports cannot resurrect them. Deleting such a copy converts it to
  `source_kind=base_tombstone` — an invisible row that keeps the original
  masked. Clear-all removes tombstones and the originals reappear.

## Conventions

- Keep base tiles self-hosted; do not add external raster tile URLs or CDN map
  dependencies.
- Keep public requests same-origin through Nginx (`/api`, `/tiles/base`, and
  `/tiles/editor`).
- Store editing geometries in EPSG:4326. MapLibre and vector tiles handle map
  display projection.
- Use migration files for schema changes; do not alter a deployed schema from
  application startup code.
