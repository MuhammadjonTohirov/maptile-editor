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
  and source mounts live in `docker-compose.override.yml`. Production deploys
  explicitly select only the base `docker-compose.yml`.
- **X5 — Every proxy timeout covers its upstream.** If a backend operation can
  legitimately take N seconds (Overpass fallback chain), the nginx location
  that fronts it must allow more than N seconds.
- **X6 — Checks are runnable and documented.** `npm run check:frontend`,
  `npm run build`, backend `pytest`, the isolated PostGIS suite
  (`./scripts/test-backend-integration.sh`), `docker compose config`, and
  `./scripts/verify-stack.sh` must all pass before a change ships. README
  documents how.
- **X7 — Source files stay reviewable.** Implementation files under
  `backend/`, `frontend/src/`, and `scripts/` must not exceed 600 lines; new
  work should target 500 lines or fewer. `scripts/check-source-size.mjs`
  enforces the hard limit. Generated files, lockfiles, binary assets, and
  declarative runtime artifacts such as the single MapLibre style JSON are
  outside this implementation-file rule.

## Backend (FastAPI)

- **B1 — Modules by responsibility.** `main.py` only assembles the app
  (middleware, routers, lifespan, health). `features_api.py` is the thin HTTP
  boundary; generic mutation transactions live in `feature_mutations.py`,
  road-span transactions in `road_segment_service.py`, and pure feature
  invariants in `feature_domain.py`. OSM imports live in `imports_api.py`, the
  Overpass client and tag parsing in `overpass.py`, import orchestration in
  `osm_import.py`, serialization in `serializers.py`, route-result assembly in
  `route_result.py`, road-build ownership in `road_network_job.py`, and
  configuration in `config.py`.
- **B2 — No duplicated serialization.** Row → GeoJSON and ORM → response
  conversions exist exactly once (`serializers.py`). Column lists are defined
  once.
- **B3 — Honest error semantics.** 404 for missing rows, 422 for invalid
  input (bad geometry, bad bounds, bad enum), 428 for a missing edit
  precondition, 409 for a stale edit or constraint conflict, 502 for upstream
  (Overpass) failure, and unexpected exceptions surface as 500 — never
  converted to 400. `HTTPException` is never swallowed.
- **B4 — Sessions roll back centrally.** The `get_db` dependency rolls back on
  any exception. Mutation services own their complete transaction and commit
  explicitly on success; routers do not repeat persistence orchestration.
- **B5 — Validation at the boundary.** Pydantic schemas and
  `feature_domain.py` encode every invariant the DB enforces (source kind,
  feature type, geometry validity/type compatibility, name length, bounded
  import areas, finite coordinates, non-negative counts) so bad input fails
  with 422 before reaching SQL. A business link is also verified to reference
  an actual building. Partial updates use `model_dump(exclude_unset=True)`:
  absent means "keep", null means "clear".
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
- **B11 — Mutations reject stale state.** Every update, delete, and road-span
  mutation carries the selected row's `updated_at` in `If-Match`, locks the row
  with `FOR UPDATE`, and returns 409 if another transaction changed it. Blind
  last-write-wins updates are not allowed.
- **B12 — Background jobs have one database owner.** Bulk loads and route-graph
  rebuilds use PostgreSQL advisory locks across processes. Their status is
  durable in PostgreSQL, restart-interrupted states are repaired atomically,
  and caught failures are logged as well as exposed to the admin UI.
- **B13 — Readiness is real.** `/health` executes a database query and the
  backend container healthcheck uses it. `/health/live` is process liveness.
  Interactive routing and external downloads have explicit time limits.

## Database (PostGIS + migrations)

- **D1 — Migrations are the stable schema authority.** Extensions and stable
  tables, indexes, triggers, and constraints are created by ordered idempotent
  files in `db/migrations/`, applied exactly once by the `migrations` job
  before backend and Martin start. The only runtime DDL is the routing
  builder's disposable `*_build`, `*_next`, and `*_previous` shadow artifacts,
  which are atomically swapped into the migrated stable graph tables.
- **D2 — Migrations are idempotent and transactional.** Every file can run on
  a database at any prior state (`IF NOT EXISTS`, `CREATE OR REPLACE`,
  drop-then-add for constraints) and wraps its statements in a transaction.
- **D3 — Applied migrations are immutable.** Never edit a migration recorded
  in `schema_migrations`; fix forward with a new file. Application startup
  code never alters schema.
- **D4 — The DB enforces invariants the app relies on.** `source_kind` and new
  feature geometry/type combinations are CHECK-constrained, OSM identity
  `(osm_type, osm_id)` is a partial unique index, geometry has a GIST index,
  and `updated_at` is trigger-maintained.
- **D5 — Types match end to end.** Timestamps are `timestamptz` in SQL and
  timezone-aware `DateTime(timezone=True)` in SQLAlchemy. Geometry is EPSG:4326
  everywhere; projection is the renderer's job.
- **D6 — Data files never enter git.** `db/data/` (live cluster) and tile
  artifacts stay ignored.

## Frontend (editor and client)

- **F1 — Modules by responsibility.** `main.js` holds only the `MapEditor`
  composition and cross-controller refresh state. Map/drawing events live in
  `editor-interactions.js`, selection and draft sessions in
  `feature-editor.js`, and persisted mutations in `feature-actions.js`. HTTP
  access lives in `api.js`, geometry math in `geometry.js`, layer-id lists and
  visibility helpers in `layers.js`, map construction in `map-setup.js`,
  user-visible strings in `strings.js`, route interaction in `route-ui.js`,
  rebuild polling in `road-network-ui.js`, road draft/snapping rules in
  `road-editing.js`, controlled road form options and class-based speed
  defaults in `road-options.js`, feature form/payload handling in
  `feature-form.js`, feature reads and viewport freshness in `editor-data.js`,
  search in `feature-search.js`, import controls in `osm-import-ui.js`,
  inverse-operation history in `undo-stack.js`, road endpoint feedback/index
  state in `road-connectivity-ui.js`, live snap targeting and its indicator in
  `snapping-ui.js`, emoji/label anchors in `emoji-icons.js`, and basemap
  masking in `base-masks.js`. The client (`client.js`) reuses these modules; it
  never redefines them.
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
- **F12 — Editor writes carry a version.** `api.js` attaches the selected
  feature's `updated_at` as `If-Match` to every update/delete/restore request.
  A 409 `feature_changed` response is shown as a reselect-before-saving
  message; the client never retries a stale mutation silently.
