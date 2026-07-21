# Architecture requirement rules

These rules are the standard every change to this repository must meet. Each
rule has an ID so reviews and commits can reference it. The current code is
compliant; a change that breaks a rule needs this document updated in the same
commit with the reason.

## Cross-cutting

- **X1 — Same-origin runtime.** The browser talks only to the frontend origin
  (`/api/*`, `/tiles/base/*`, `/tiles/editor/*`, `/assets/*`, `/styles/*`).
  No external tile, sprite, font, or CDN dependency at runtime.
- **X2 — Self-hosted basemap.** The OpenMapTiles archive is a read-only,
  generated deployment artifact. Application code never mutates it.
- **X3 — One source of truth per concern.** Schema lives in `db/migrations/`,
  map style in `frontend/styles/editor.json`, layer-id lists in
  `frontend/src/layers.js`, user-visible strings in the per-language catalogs
  under `frontend/src/locales/` behind `frontend/src/strings.js`.
  Nothing duplicates these; everything imports them.
- **X4 — Deployment artifacts are reproducible.** Images build from pinned
  bases and lockfiles (`package-lock.json`, pinned `requirements.txt`).
  Production images carry no dev flags; dev conveniences (uvicorn `--reload`)
  live in `docker-compose.yml` overrides only.
- **X5 — Every proxy timeout covers its upstream.** If a backend operation can
  legitimately take N seconds (Overpass fallback chain), the nginx location
  that fronts it must allow more than N seconds.
- **X6 — Checks are runnable and documented.** `npm run check:frontend`,
  `npm run build`, backend `pytest`, `docker compose config`, and
  `./scripts/verify-stack.sh` must all pass before a change ships. README
  documents how.

## Backend (FastAPI)

- **B1 — Modules by responsibility.** `main.py` only assembles the app
  (middleware, routers, lifespan, health). Feature CRUD lives in
  `features_api.py`, OSM imports in `imports_api.py`, the Overpass client and
  tag parsing in `overpass.py`, import orchestration in `osm_import.py`,
  serialization in `serializers.py`, configuration in `config.py`.
- **B2 — No duplicated serialization.** Row → GeoJSON and ORM → response
  conversions exist exactly once (`serializers.py`). Column lists are defined
  once.
- **B3 — Honest error semantics.** 404 for missing rows, 422 for invalid
  input (bad geometry, bad bounds, bad enum), 409 for constraint conflicts,
  502 for upstream (Overpass) failure, and unexpected exceptions surface as
  500 — never converted to 400. `HTTPException` is never swallowed.
- **B4 — Sessions roll back centrally.** The `get_db` dependency rolls back on
  any exception; endpoints do not repeat try/rollback boilerplate and commit
  explicitly on success.
- **B5 — Validation at the boundary.** Pydantic schemas encode every
  invariant the DB enforces (source_kind enum, name length, bounded import
  areas, non-negative counts) so bad input fails with 422 before reaching
  SQL. Partial updates use `model_dump(exclude_unset=True)`: absent means
  "keep", null means "clear".
- **B6 — Batched queries.** No per-element SELECTs in loops. Imports prefetch
  existing rows with one `IN` query; counts use SQL, not row materialization.
- **B7 — One import pipeline.** The four OSM import endpoints share a single
  fetch → parse → upsert service parameterized per kind. Kind-specific logic
  is limited to the Overpass query and element→Feature builder. Tombstoned
  rows are never resurrected by imports, and user-edited imports are promoted
  to manual local overrides that later imports cannot replace.
- **B8 — External calls are bounded and identified.** Overpass requests carry
  a descriptive User-Agent, use explicit timeouts, fall back across public
  instances, and reuse one HTTP client managed by the app lifespan.
- **B9 — Configuration via environment.** Database URL, CORS origins, and SQL
  echo come from environment variables with safe defaults. CORS never uses
  wildcard origins together with credentials.
- **B10 — Pure logic is unit-tested.** Parsing, validation, serialization,
  and element→feature building have pytest coverage that runs without a
  database (`backend/tests/`).

## Database (PostGIS + migrations)

- **D1 — Migrations are the only schema authority.** All schema — extension,
  tables, indexes, triggers, constraints — is created by ordered idempotent
  files in `db/migrations/`, applied exactly once by the `migrations` job
  before backend and Martin start. There is no separate bootstrap path.
- **D2 — Migrations are idempotent and transactional.** Every file can run on
  a database at any prior state (`IF NOT EXISTS`, `CREATE OR REPLACE`,
  drop-then-add for constraints) and wraps its statements in a transaction.
- **D3 — Applied migrations are immutable.** Never edit a migration recorded
  in `schema_migrations`; fix forward with a new file. Application startup
  code never alters schema.
- **D4 — The DB enforces invariants the app relies on.** `source_kind` is
  CHECK-constrained, OSM identity `(osm_type, osm_id)` is a partial unique
  index, geometry has a GIST index, `updated_at` is trigger-maintained.
- **D5 — Types match end to end.** Timestamps are `timestamptz` in SQL and
  timezone-aware `DateTime(timezone=True)` in SQLAlchemy. Geometry is EPSG:4326
  everywhere; projection is the renderer's job.
- **D6 — Data files never enter git.** `db/data/` (live cluster) and tile
  artifacts stay ignored.

## Frontend (editor and client)

- **F1 — Modules by responsibility.** `main.js` holds only the `MapEditor`
  orchestration. HTTP access lives in `api.js`, geometry math in
  `geometry.js`, layer-id lists and visibility helpers in `layers.js`,
  map construction in `map-setup.js`, user-visible strings in `strings.js`,
  route interaction in `route-ui.js`, rebuild polling in `road-network-ui.js`,
  road draft/snapping rules in `road-editing.js`, controlled road form options
  and class-based speed defaults in `road-options.js`, emoji/label anchors in
  `emoji-icons.js`, and basemap masking in `base-masks.js`. The client
  (`client.js`) reuses these modules; it never redefines them.
- **F2 — One API client.** All requests go through `api.js`, which raises
  `ApiError` with the HTTP status and the server's `detail` message. Callers
  branch on `error.status` (e.g. 404 → refresh ghost features), never on
  hand-parsed bodies.
- **F3 — Server ids are strings.** `serverId` is normalized with `String()`
  at every assignment so identity checks (`isEditingFeature`) never fail on
  number-vs-string.
- **F4 — Tile geometry is never edited or persisted.** Reshaping always
  starts from `/api/features/{id}`; geometry entering Terra Draw is
  normalized to single-part types at 9-decimal precision
  (`normalizeGeometry`). In the small-data overlay, symbols/labels render
  from one anchor point per feature (never tiled geometry) so a symbol is not
  duplicated per tile. In full-base mode that GeoJSON anchor source cannot
  hold a country of features, so icons and point labels render from the
  editor tiles instead — points occupy a single tile so they do not
  duplicate, and polygon/line name labels keep using the tile-safe paths
  (line-placed road labels; polygon labels are omitted at that scale).
- **F5 — Form state is explicit.** Selecting a feature populates the property
  form; clearing the selection resets it. A new drawing must never inherit
  values left over from a previously selected feature. The Road tool stays
  disabled until a controlled road class is selected; road routing attributes
  are selections, never free-form text.
- **F6 — Guarded style mutations.** Code that shows/hides or repaints layers
  goes through `layers.js` helpers that check `map.getLayer` first, so a
  style edit cannot crash the app at runtime.
- **F7 — User-visible strings are localized.** JS never embeds UI copy
  inline; it calls `t(key, params)` from `strings.js`, which resolves the
  active locale (`?lang=` override → saved choice → browser language →
  English) against the per-language catalogs in `frontend/src/locales/`.
  Static markup carries `data-i18n` attributes applied by
  `localizeDocument()`; MapLibre control labels come from `mapLibreLocale()`.
  Every catalog must mirror the English key set and `{placeholder}` tokens.
- **F8 — The client is a finished map.** `client.html` renders detail
  exclusively from editor data (base detail layers hidden), repaints edits
  with the basemap palette, polls the cheap `/api/features/version` stamp
  only while the tab is visible — fetching the collection and reloading the
  tile source only when the stamp changes — and exposes no editing
  affordance.
- **F9 — Undo is inverse API calls.** Every mutation pushes its inverse
  (create→delete, update→restore previous, tombstone→restore kind) onto a
  bounded stack; undo replays the inverse and refreshes tiles + data.
- **F10 — Style consistency is machine-checked.** `npm run check:frontend`
  syntax-checks every source module, validates `editor.json` against the
  MapLibre style spec, verifies that every layer id referenced from
  `layers.js` and `base-masks.js` exists in the style, and enforces locale
  catalog parity with English (`scripts/check-locales.mjs`).
- **F11 — Saving geometry preserves identity.** Terra Draw's store carries
  only `{serverId, mode}`; payloads for an existing feature are built from
  the authoritative selected properties so a reshape or drag can never reset
  `source_kind`, the OSM identity, or the `base_*` masking linkage.
