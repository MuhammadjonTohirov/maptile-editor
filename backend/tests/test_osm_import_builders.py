from osm_import import IMPORT_KINDS, _build_candidates
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
    from osm_import import _REPLACEABLE_ATTRIBUTES
    assert "name" not in _REPLACEABLE_ATTRIBUTES


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
