# Tiles Directory

Place your `.mbtiles` files in this directory for the TileServer to serve them.

## Getting Sample Tiles

### Option 1: Download from OpenMapTiles
1. Visit: https://openmaptiles.org/downloads/
2. Download a region in `.mbtiles` format
3. Place the file in this directory

### Option 2: Generate with Tilemaker
1. Download OSM data in `.pbf` format
2. Use tilemaker to generate vector tiles
3. Export as `.mbtiles` format

### Option 3: Use OpenStreetMap data
For testing, you can download small regions from:
- https://download.geofabrik.de/

The TileServer will automatically serve any `.mbtiles` files placed here.