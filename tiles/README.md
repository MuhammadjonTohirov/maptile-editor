# Generated tile artifacts

This directory contains ignored deployment artifacts for Martin.

- `osm_uzbekistan.mbtiles` — OpenMapTiles-compatible, read-only OSM vector
  basemap for Uzbekistan (zoom 0–14).
- `osm_uzbekistan.manifest.json` — source, checksum, pinned build revision, and
  generation time for that archive.

Build or refresh the archive with:

```bash
./scripts/build-uzbekistan-tiles.sh
```

Martin serves the archive internally. The browser reaches it only through the
frontend's same-origin `/tiles/base/{z}/{x}/{y}` route. Editor data comes from
PostGIS at `/tiles/editor/{z}/{x}/{y}`.

The basemap must retain this attribution: `© OpenMapTiles © OpenStreetMap
contributors`.
