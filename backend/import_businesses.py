"""Import business POIs from a JSONL file into the editor.

A source-agnostic bulk importer: each JSONL line is one business with generic
fields (name/title, a category, latitude, longitude, and optional phone,
opening_hours, address). Records become `feature_type=business` point features,
each linked to the building it falls inside when one exists. Re-running with the
same `--source` label replaces that batch, so imports stay idempotent.

This tool does not check or assert data provenance — ensure you have the right
to use whatever file you load. Run it inside the backend container, e.g.:

    docker compose exec -T backend python import_businesses.py --source fergana < data.jsonl
    docker compose exec -T backend python import_businesses.py --source fergana /app/data.jsonl
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any, Iterable, Optional

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import text

from database import async_session
from models import Feature

# Coarse category → the editor's business_type set. Matched by substring against
# the record's category text (English and Uzbek terms), first hit wins.
CATEGORY_RULES: list[tuple[tuple[str, ...], str]] = [
    (("restoran", "restaurant", "ovqat", "fast", "pitssa", "pizza", "sushi",
      "banket", "bar", "oshxona", "kabob", "milliy taom"), "restaurant"),
    (("qahvaxona", "kafe", "cafe", "coffee", "choyxona"), "cafe"),
    (("dorixona", "apteka", "pharmacy"), "pharmacy"),
    (("bank",), "bank"),
    (("ofis", "office"), "office"),
    (("dokon", "do'kon", "magazin", "shop", "store", "market", "supermarket",
      "grocery", "oziq-ovqat"), "shop"),
]
BUSINESS_EMOJI = {
    "restaurant": "🍽️", "cafe": "☕", "pharmacy": "💊",
    "bank": "🏦", "office": "🏢", "shop": "🏪", "other": "📍",
}


def _pick(record: dict[str, Any], *keys: str) -> Any:
    """First non-empty value among the given aliases."""
    for key in keys:
        value = record.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def _category_text(record: dict[str, Any]) -> str:
    raw = _pick(record, "business_type", "category", "categories")
    if isinstance(raw, list):
        raw = raw[0] if raw else ""
    return str(raw or "").strip()


def _business_type(category: str) -> str:
    lowered = category.lower()
    for needles, kind in CATEGORY_RULES:
        if any(needle in lowered for needle in needles):
            return kind
    return "other"


def _phone(record: dict[str, Any]) -> Optional[str]:
    value = _pick(record, "phone", "phones")
    if isinstance(value, list):
        value = value[0] if value else None
    return str(value) if value else None


def parse_record(record: dict[str, Any]) -> Optional[dict[str, Any]]:
    """Map one generic business record to editor columns, or None if unusable."""
    name = _pick(record, "name", "title", "short_title")
    lat = _pick(record, "latitude", "lat")
    lon = _pick(record, "longitude", "lon", "lng")
    if not name or lat is None or lon is None:
        return None
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None

    category = _category_text(record)
    business_type = _business_type(category)
    extras: dict[str, Any] = {}
    if (phone := _phone(record)):
        extras["phone"] = phone
    if (hours := _pick(record, "opening_hours", "working_hours", "hours")):
        extras["opening_hours"] = str(hours)
    if (address := _pick(record, "address", "full_address", "fullAddress")):
        extras["address"] = str(address)
    if category:
        extras["business_category"] = category
    return {
        "name": str(name),
        "lon": lon,
        "lat": lat,
        "business_type": business_type,
        "icon": BUSINESS_EMOJI.get(business_type, BUSINESS_EMOJI["other"]),
        "extras": extras,
    }


def read_records(path: Optional[str]) -> Iterable[dict[str, Any]]:
    stream = open(path, encoding="utf-8") if path else sys.stdin
    try:
        for line in stream:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                print(f"  skipped a malformed line", file=sys.stderr)
    finally:
        if path:
            stream.close()


async def import_businesses(rows: list[dict[str, Any]], source: str, *, link_buildings: bool) -> dict[str, int]:
    async with async_session() as db:
        # Overwrite: drop the previous batch that carries this source label. The
        # feature_type index scopes it to business rows, so it does not scan the
        # whole table. Manual businesses and other imports are untouched.
        deleted = await db.execute(
            text("DELETE FROM features WHERE feature_type = 'business' "
                 "AND properties ->> 'import_source' = :source"),
            {"source": source},
        )
        for row in rows:
            db.add(Feature(
                name=row["name"],
                geometry=from_shape(Point(row["lon"], row["lat"]), srid=4326),
                feature_type="business",
                source_kind="manual",
                business_type=row["business_type"],
                icon=row["icon"],
                properties={**row["extras"], "import_source": source},
            ))
        await db.commit()

        linked = 0
        if link_buildings:
            # Register each imported point inside the building that contains it
            # (GIST index on geometry). Points with no building stay free-standing.
            result = await db.execute(
                text("UPDATE features b SET building_id = sub.bid "
                     "FROM ("
                     "  SELECT b2.id, ("
                     "    SELECT f.id FROM features f "
                     "    WHERE f.feature_type = 'building' "
                     "      AND ST_Contains(f.geometry, b2.geometry) "
                     "    ORDER BY f.id LIMIT 1) AS bid "
                     "  FROM features b2 "
                     "  WHERE b2.feature_type = 'business' "
                     "    AND b2.properties ->> 'import_source' = :source "
                     "    AND b2.building_id IS NULL"
                     ") sub "
                     "WHERE b.id = sub.id AND sub.bid IS NOT NULL"),
                {"source": source},
            )
            linked = result.rowcount or 0
            await db.commit()

    return {"deleted": deleted.rowcount or 0, "inserted": len(rows), "linked": linked}


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", nargs="?", help="JSONL path; omit to read stdin")
    ap.add_argument("--source", default="file-import",
                    help="batch label stored on each row; a re-run with the same "
                         "label overwrites the batch (default: file-import)")
    ap.add_argument("--no-link-buildings", action="store_true",
                    help="skip registering each business inside its building")
    ap.add_argument("--dry-run", action="store_true",
                    help="parse and report without writing to the database")
    args = ap.parse_args(argv)

    parsed, skipped = [], 0
    for record in read_records(args.file):
        row = parse_record(record)
        if row is None:
            skipped += 1
        else:
            parsed.append(row)

    kinds: dict[str, int] = {}
    for row in parsed:
        kinds[row["business_type"]] = kinds.get(row["business_type"], 0) + 1
    print(f"parsed {len(parsed)} businesses, skipped {skipped}", file=sys.stderr)
    print(f"  by type: {kinds}", file=sys.stderr)

    if args.dry_run:
        for row in parsed[:3]:
            print(f"  sample: {row['name']} [{row['business_type']}] "
                  f"@ {row['lat']:.5f},{row['lon']:.5f} {row['extras']}", file=sys.stderr)
        print("dry-run: nothing written", file=sys.stderr)
        return 0
    if not parsed:
        print("nothing to import", file=sys.stderr)
        return 1

    stats = asyncio.run(import_businesses(parsed, args.source, link_buildings=not args.no_link_buildings))
    print(f"done — source={args.source!r}: replaced {stats['deleted']}, "
          f"inserted {stats['inserted']}, linked to buildings {stats['linked']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
