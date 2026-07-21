import asyncio
from types import SimpleNamespace

from osm_import import (
    IMPORT_KINDS,
    _REPLACEABLE_ATTRIBUTES,
    _build_candidates,
    _can_refresh_from_osm,
    run_import,
)
from schemas import BoundsRequest

BOUNDS = BoundsRequest(west=69.2, south=41.3, east=69.3, north=41.4)


def way(tags, geometry=None, osm_id=1):
    return {
        "type": "way",
        "id": osm_id,
        "tags": tags,
        "geometry": geometry or [
            {"lon": 69.20, "lat": 41.30},
            {"lon": 69.21, "lat": 41.30},
            {"lon": 69.21, "lat": 41.31},
        ],
    }


def node(tags, osm_id=2):
    return {"type": "node", "id": osm_id, "lat": 41.3, "lon": 69.2, "tags": tags}


def test_building_builder_closes_ring_and_maps_tags():
    kind = IMPORT_KINDS["buildings"]
    feature = kind.build(way({"building": "residential", "name": "Home", "height": "9 m"}))
    assert feature.feature_type == "building"
    assert feature.name == "Home"
    assert feature.building_type == "residential"
    assert feature.height_m == 9.0
    assert feature.osm_type == "way"
    assert feature.source_kind == "osm_import"


def test_building_builder_skips_non_buildings():
    kind = IMPORT_KINDS["buildings"]
    assert kind.build(way({"highway": "residential"})) is None
    assert kind.build(node({"building": "yes"})) is None


def test_road_builder_parses_attributes():
    kind = IMPORT_KINDS["roads"]
    feature = kind.build(way({
        "highway": "primary", "lanes": "4", "maxspeed": "60", "oneway": "yes", "surface": "asphalt",
    }))
    assert feature.feature_type == "road"
    assert feature.road_type == "primary"
    assert feature.lane_count == 4
    assert feature.max_speed == 60
    assert feature.direction == "oneway"
    assert feature.name == ""


def test_road_builder_keeps_only_real_street_names():
    kind = IMPORT_KINDS["roads"]
    named = kind.build(way({"highway": "secondary", "name": "Sayilgoh ko'chasi"}))
    unnamed = kind.build(way({"highway": "service"}))
    assert named.name == "Sayilgoh ko'chasi"
    assert unnamed.name == ""


def test_reimport_never_replaces_a_title():
    # The name column is the user-facing title; the upsert may only backfill
    # an empty one, so it must stay out of the replaceable attribute list.
    assert "name" not in _REPLACEABLE_ATTRIBUTES


def test_reimport_never_replaces_editor_owned_source_kind():
    assert "source_kind" not in _REPLACEABLE_ATTRIBUTES
    assert _can_refresh_from_osm(SimpleNamespace(source_kind="osm_import"))
    assert not _can_refresh_from_osm(SimpleNamespace(source_kind="manual"))
    assert not _can_refresh_from_osm(SimpleNamespace(source_kind="base_tombstone"))


def test_run_import_preserves_a_manual_osm_road(monkeypatch):
    existing = SimpleNamespace(osm_id="1", source_kind="manual", road_type="primary")

    class Result:
        @staticmethod
        def scalars():
            return [existing]

    class Database:
        committed = False

        @staticmethod
        async def execute(_query):
            return Result()

        @staticmethod
        def add(_feature):
            raise AssertionError("the existing local override must not be inserted again")

        async def commit(self):
            self.committed = True

    async def fetched(_query):
        return {"elements": [way({"highway": "pedestrian"})]}

    monkeypatch.setattr("osm_import.fetch_overpass", fetched)
    database = Database()
    result = asyncio.run(run_import(IMPORT_KINDS["roads"], BOUNDS, database))

    assert existing.road_type == "primary"
    assert result["roads_loaded"] == 0
    assert database.committed


def test_streetlight_builder_requires_lamp_tag():
    kind = IMPORT_KINDS["streetlights"]
    assert kind.build(node({"highway": "street_lamp"})) is not None
    assert kind.build(node({"highway": "bus_stop"})) is None


def test_traffic_light_builder_uses_ref_in_name():
    kind = IMPORT_KINDS["traffic-lights"]
    feature = kind.build(node({"highway": "traffic_signals", "ref": "T7"}))
    assert feature.name == "Traffic Light T7"
    assert feature.icon == "🚦"


def test_malformed_element_is_skipped_not_fatal():
    kind = IMPORT_KINDS["buildings"]
    broken = {"type": "way", "id": 9, "tags": {"building": "yes"}, "geometry": []}
    good = way({"building": "yes"}, osm_id=10)
    candidates = _build_candidates(kind, [broken, good])
    assert len(candidates) == 1
    assert candidates[0].osm_id == "10"


def test_queries_embed_bounds():
    for kind in IMPORT_KINDS.values():
        assert BOUNDS.bbox in kind.query(BOUNDS)
