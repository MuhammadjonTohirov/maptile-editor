"""Import OSM business POIs (amenity/shop/office) for a region into the editor.

Reuses the shared OSM pipeline (fetch → parse → upsert, deduped by OSM id and
tombstone-safe) with the `businesses` import kind, then links each imported
business to the building it falls inside. A maintenance op like the per-area
import; run it in the backend container:

    docker compose exec -T backend python import_osm_businesses.py --region fergana
    docker compose exec -T backend python import_osm_businesses.py --bounds 71.72,40.33,71.85,40.43

Data is OpenStreetMap (ODbL), the license-compatible source for this map.
"""
from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import text

from database import async_session
from osm_import import IMPORT_KINDS, run_import
from schemas import BoundsRequest

# west, south, east, north — small enough to satisfy the BoundsRequest area cap.
REGIONS: dict[str, tuple[float, float, float, float]] = {
    "fergana": (71.720, 40.330, 71.850, 40.430),
    "tashkent-centre": (69.220, 41.280, 69.360, 41.360),
    "samarkand": (66.930, 39.630, 67.030, 39.690),
    "bukhara": (64.400, 39.740, 64.470, 39.790),
    "namangan": (71.610, 40.980, 71.700, 41.020),
    "andijan": (72.300, 40.760, 72.380, 40.800),
}


async def run(bounds: BoundsRequest) -> dict:
    async with async_session() as db:
        result = await run_import(IMPORT_KINDS["businesses"], bounds, db)
        # Register each imported business inside its building (GIST index).
        linked = await db.execute(text(
            "UPDATE features b SET building_id = sub.bid "
            "FROM ("
            "  SELECT b2.id, ("
            "    SELECT f.id FROM features f "
            "    WHERE f.feature_type = 'building' "
            "      AND ST_Contains(f.geometry, b2.geometry) "
            "    ORDER BY f.id LIMIT 1) AS bid "
            "  FROM features b2 "
            "  WHERE b2.feature_type = 'business' "
            "    AND b2.source_kind = 'osm_import' "
            "    AND b2.building_id IS NULL"
            ") sub "
            "WHERE b.id = sub.id AND sub.bid IS NOT NULL"
        ))
        await db.commit()
        result["linked_to_buildings"] = linked.rowcount or 0
    return result


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--region", choices=sorted(REGIONS), help="preset region")
    group.add_argument("--bounds", help="west,south,east,north (small area)")
    args = ap.parse_args(argv)

    if args.region:
        west, south, east, north = REGIONS[args.region]
    else:
        try:
            west, south, east, north = (float(x) for x in args.bounds.split(","))
        except ValueError:
            print("--bounds expects west,south,east,north", file=sys.stderr)
            return 2

    bounds = BoundsRequest(west=west, south=south, east=east, north=north)
    print(f"fetching OSM businesses for {args.region or args.bounds} ({bounds.bbox})", file=sys.stderr)
    result = asyncio.run(run(bounds))
    print(f"done — {result.get('businesses_loaded', 0)} businesses upserted, "
          f"{result.get('linked_to_buildings', 0)} linked to buildings", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
