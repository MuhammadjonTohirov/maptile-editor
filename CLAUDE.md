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
   | /api/*                   | /tiles/base/*, /tiles/editor/*, /fonts/*
   v                          v
FastAPI (:8000)            Martin
   |                          |-- tiles/osm_uzbekistan.mbtiles
   |                          |-- PostGIS features table
   v                          `-- fonts/ (glyph ranges for map labels)
PostGIS (host :5434; internal :5432)
```

- `frontend/styles/editor.json` is the only client map style.
- `frontend/client.html` (`src/client.js`) is a read-only viewer that polls
  the lightweight `/api/features/version` change stamp and reloads feature
  data and editor tiles only when an edit actually happened, so an idle map
  never repaints. In full-base mode it skips the whole-collection fetch and
  draws icons/labels straight from the editor tiles. It hides all basemap detail
  layers (buildings, roads, waterways, POIs, road labels) — the basemap only
  provides context (terrain, water, boundaries, place names) and every detail
  object comes from editor data, restyled with the basemap palette.
- `tiles/osm_uzbekistan.mbtiles` is a generated, ignored deployment artifact.
- `fonts/` holds the self-hosted map fonts (Noto Sans, Latin + Cyrillic in one
  file). Martin turns them into glyph ranges; the style's `glyphs` points at the
  same-origin `/fonts/{fontstack}/{range}`. MapLibre renders no text label
  without a glyphs source, so every `text-font` must name a fontstack Martin
  serves (`Noto Sans Regular`); confirm new fonts in Martin's `/catalog`.
- `db/migrations/` is the only schema authority. `000_baseline.sql` bootstraps
  a fresh database; there are no separate init scripts.
- `docs/architecture-rules.md` holds the per-layer architecture rules (X/B/D/F
  ids); every change must comply with them.

## Authentication

- The editor requires a login; the public client viewer (`client.html`) stays
  open and read-only. Reads (`GET`) are public; every write (`POST`/`PUT`/
  `DELETE` on features + imports) depends on `require_user`, and user management
  + `clear-all` depend on `require_admin` (`backend/auth.py`).
- Sessions are a JWT in an **httpOnly, SameSite=Lax cookie** — JavaScript never
  touches the token and cross-site writes cannot carry it, so `api.js` needs no
  token handling (same-origin fetch sends the cookie). Backend auth lives in
  `auth.py` (hashing/JWT/deps) + `auth_api.py` (`/auth/login|logout|me|users`);
  frontend gate + admin panel in `frontend/src/auth-ui.js`.
- Accounts live in the `users` table (migration `007`); admins manage them from
  the in-editor panel. The first admin is seeded from `ADMIN_USERNAME`/
  `ADMIN_PASSWORD` **only while the table is empty**. Before exposing the editor
  beyond localhost, change those, set a real `JWT_SECRET`, and set
  `AUTH_COOKIE_SECURE=true` under HTTPS (all env, see `config.py`).
- `features.created_by`/`updated_by` (FK users, `ON DELETE SET NULL`) record who
  created/last-edited each row; writes set them from the signed-in user and the
  properties panel shows the names. Pre-auth rows and OSM imports carry null.

## Code layout

- Backend (flat modules, one responsibility each): `main.py` assembles the
  app; `features_api.py` (CRUD routes), `imports_api.py` (import routes),
  `osm_import.py` (shared fetch→parse→upsert pipeline), `overpass.py`
  (Overpass client + tag parsing), `serializers.py` (row→API shapes),
  `road_network.py` (route costing/query assembly), `road_network_builder.py`
  (batched pgRouting 4 topology publication), `schemas.py`, `models.py`,
  `database.py`, `config.py`. Unit tests in
  `backend/tests/` run without a database.
- Frontend (`frontend/src/`): `main.js` is the MapEditor orchestrator;
  `client.js` the read-only viewer. Both share `api.js` (the only HTTP
  client; throws `ApiError` with status). `route-ui.js` owns route picking,
  `road-network-ui.js` owns rebuild polling, `road-editing.js` owns road draft,
  validation, and endpoint-snapping rules, and `road-options.js` owns the
  controlled road form catalog and speed defaults. Both map pages share
  `geometry.js`, `layers.js`
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

## Deploy to a VPS

```bash
scripts/deploy.sh root@<vps-host> [https://your-domain]
```

One command over SSH: rsyncs the repo (code + the prebuilt tiles, not
`db/data`), writes a production `.env` (generated `JWT_SECRET` + admin password,
`FRONTEND_HOST_PORT=80`, `AUTH_COOKIE_SECURE` set from the URL scheme), builds
the stack, and — only when missing — builds the basemap tiles and **bulk-loads
the full Uzbekistan OSM** (skipped once the feature count clears
`FULL_BASE_THRESHOLD`, so re-deploys are fast). The compose ports keep the DB and
API on loopback; only the front door is published.

Pass an `https://` URL and the deploy turns on **automatic HTTPS**: the compose
`tls` profile starts a Caddy reverse proxy that obtains/renews a Let's Encrypt
cert for the host, takes ports 80/443, and proxies to the frontend (which moves
to a loopback bind so the two don't clash); the session cookie's `Secure` flag
goes on at the same time. It needs the domain's DNS A record pointed at the VPS
and ports 80 + 443 open. An IP-only / `http://` deploy stays plain HTTP with the
frontend published directly (`caddy/Caddyfile` is the proxy config; cert state
persists in the `caddy_data` volume).

## Backups

The `db-backup` compose service runs `scripts/backup-loop.sh`: a compressed
`pg_dump -Fc` of the whole database on start and every `BACKUP_INTERVAL` seconds
(default 24 h), pruned to the newest `BACKUP_KEEP` (default 7). Dumps land in
`backups/` (gitignored; rsync-excluded so a deploy never wipes them). pg_dump
takes an MVCC snapshot, so backups never block editing (~20 s / ~220 MB for the
full country). Prune sorts by the ISO-8601 timestamp in each filename, not
mtime. Override cadence/retention via `.env` (`BACKUP_INTERVAL`, `BACKUP_KEEP`).

Restore is **destructive** and operator-run — stop the services holding
connections first, then run `scripts/restore-db.sh` inside the service:

```bash
docker compose stop backend martin
docker compose run --rm --entrypoint sh db-backup \
    /scripts/restore-db.sh /backups/mapdata-YYYYMMDDTHHMMSSZ.dump
docker compose start backend martin
```

`backups/` holds only the VPS's own copies; ship them off-box separately if you
need off-site retention.

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

- Use Terra Draw modes for point, road, polygon, rectangle, circle, and
  select/edit operations. Roads snap to the nearest point on another saved road
  segment within an eight-metre maximum; existing roads never snap to themselves
  and only their endpoints use segment snapping. Road edits remain client-side
  drafts until Save; Cancel or Escape discards them without an API write. Other
  shapes snap to saved vertices.
  Selected features support whole-feature
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
  for create/update/delete/duplicate/restore; Undo button or Ctrl+Z. A selected
  road first undoes draft geometry steps before consuming persisted undo entries.
- The frontend persists edits through `/api/features` and refreshes the Martin
  PostGIS vector source after each change.
- Routing uses pgRouting 4.0.1 over an application-owned graph. Rebuilds split
  every road at its existing geometry vertices, merge exact shared coordinates
  into graph nodes, construct logged shadow tables in batches with observable
  road/segment/vertex counts, then publish atomically. This deliberately trusts
  OSM node topology instead of interpreting every geometric crossing as a
  junction (bridges and tunnels can cross without connecting). Manual road
  endpoints inside the eight-metre snap range are projected onto their nearest
  host road and only that host road is split in the derived graph. Statement-level
  database triggers advance a source revision for every road mutation and mark
  the graph stale. A
  rebuild publishes only if that source revision stayed unchanged; otherwise the
  previous graph remains active. Stale route responses identify that they used
  the previous published graph. Car costs honor OSM/editor access restrictions
  and prefer through-road classes over service shortcuts without distorting the
  displayed ETA.
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
  The first authenticated editor update promotes one to `source_kind=manual`;
  later OSM refreshes keep its identity for deduplication but never overwrite
  its local geometry or controlled attributes.
- `scripts/load-uzbekistan-osm.sh` bulk-loads the entire country's OSM
  buildings, roads, and street furniture into the features table in one pass
  (GDAL stages the PBF, `load-uzbekistan-osm.sql` transforms it with the same
  mapping as the per-area importer, ON CONFLICT on OSM identity keeps it
  idempotent). It is a heavy maintenance operation like the tile build, run
  against the running stack. `LOAD_BBOX="w s e n"` loads a sub-region.
- The same load is available on demand to admins from the editor (`bulk_load.py`
  + `bulk_api.py`): a modal with a country dropdown starts a background job and a
  progress bar polls `/api/bulk-load/status`. The backend runs `ogr2ogr` + `psql`
  as subprocesses (both are in the backend image; the transform SQL is mounted at
  `/scripts`), reusing the same pipeline with no Docker socket. One load at a
  time. Per-area imports use the `Import…` popup (buildings/roads/street
  furniture/traffic lights/businesses, scoped to the map viewport).
- Once the dataset crosses `FULL_BASE_THRESHOLD` (default 50 000 features)
  `/api/meta` reports `full_base`, and both the editor and client switch to
  full-base rendering: base OSM detail is hidden and the whole map is drawn
  from editor tiles with the basemap palette (`frontend/src/basemap-render.js`,
  shared by both). In this mode the editor scopes its per-feature reads to the
  viewport (`/api/features?bbox=`, for snapping, only at zoom ≥ 15), searches
  server-side (`/api/features/search`, backed by a `pg_trgm` GIN index on
  `name`), and does no per-area import or base copy — every feature is edited
  directly. Below the threshold the small-data overlay (base detail visible,
  full-list masks/snap, base-copy workflow) is used unchanged. Bbox reads use
  the geometry GIST index, so `serializers.geojson_query()` must stay
  unordered; every read is capped (`/api/features` at `FULL_BASE_THRESHOLD`,
  viewport reads at `FEATURE_QUERY_LIMIT`) so no route dumps millions of rows.
- In small-data overlay mode, editing at zoom ≥ 15 imports viewport roads automatically
  (`prepareViewportRoads`) so every road is a tappable editor feature with its
  full OSM geometry — base road tiles are fragmented per tile and too thin to
  hit reliably. Full-base mode already owns full PostGIS geometries and must
  not run that redundant import. Click selection also uses a 6px box around the pointer.
- Two overlays make road connectivity visible: a live ring (`snap_indicator`
  source) follows the cursor while drawing/dragging whenever a nearby road
  segment is in the bounded snap range — driven by
  Terra Draw's own `toCustom` callback plus a `mousemove` fallback so it
  tracks hover, not just clicks — and a green/red dot at every road's two
  endpoints (`road_connectivity` source, z ≥ 15, `roadConnectivity()` in
  `geometry.js`) shows whether that endpoint shares a coordinate or lies on
  another road segment. Green is authoritative for the next graph rebuild;
  red only means "not connected among the roads currently loaded" — a real
  junction just outside the loaded viewport/bbox cap can still show red.
- The editor's own click handler for feature selection and base-feature copy
  only runs while Terra Draw is in `select` mode (`bindMapInteractions`); a
  click during point/line/polygon drawing belongs to Terra Draw alone; the
  same guard is why the two coexist without one hijacking the other's clicks.
- New features and user-edited imports are marked `source_kind=manual`; this is
  both the durable local-override boundary and what enables endpoint-to-segment
  junction splitting for edited roads.
- A business is a point feature (`feature_type=business`) registered inside a
  building through the `building_id` column (FK with ON DELETE SET NULL, so
  deleting the building keeps its businesses as free-standing POIs). Several
  businesses can share one building. The building's properties panel lists
  them (`GET /api/features/{id}/businesses`) and adds one at the building
  center; the `business_type` category suggests an emoji icon, and extras
  (`floor`, `phone`, `opening_hours`) live in the JSONB properties blob.
- Businesses can be bulk-imported from a JSONL file with
  `backend/import_businesses.py` (run in the backend container, path or stdin).
  It is source-agnostic: each line is a generic business record (name/title, a
  category, lat/lon, optional phone/opening_hours/address), mapped to a
  `business` point, category → `business_type`, and linked to the building it
  falls inside. `--source <label>` tags the batch in `properties.import_source`
  and a re-run with the same label replaces it (idempotent). It asserts no
  provenance — only load data you have the right to use; OSM (ODbL) is the
  license-compatible source for the OSM-based map.
- OSM business POIs (which the bulk loader skips — it only does buildings, roads,
  and street furniture) come in through the `businesses` import kind in
  `osm_import.py` (`amenity` in the eatery/pharmacy/bank/fuel set, plus any
  `shop`/`office` node → a `business` point, deduped by OSM id). Run it for a
  region with `backend/import_osm_businesses.py --region <name>`, which also
  links each business to its building. Small enough to stay under the
  `BoundsRequest` area cap; not yet wired to a UI button.
- A building's `height_m` column is editable from its properties panel
  (Height (m) field). It drives the 3D extrusion height in full-base mode
  (`EDITOR_3D_LAYER` extrudes by `coalesce(height_m, 8)`); OSM imports fill it
  from the `height` tag. Buildings without a height extrude to the 8 m default.
- `feature_type` is free-text (no DB enum), so new object types need no
  migration. The editor's type dropdown offers options per geometry: points
  (point / POI / business), lines (line / road / river-waterway), polygons
  (area / building / land-use / park / water / forest / grass). The full-base
  palette (`basemap-render.js`, `FILL_COLOR`) colors geographic polygons from
  the OSM natural palette — water blue, park/forest/grass green — so a manually
  added lake or park reads like the basemap.
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
- Keep public requests same-origin through Nginx (`/api`, `/tiles/base`,
  `/tiles/editor`, and `/fonts`). Self-host glyphs too — never point the style's
  `glyphs` at an external font CDN.
- Store editing geometries in EPSG:4326. MapLibre and vector tiles handle map
  display projection.
- Use migration files for schema changes; do not alter a deployed schema from
  application startup code.
