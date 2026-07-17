import json
from types import SimpleNamespace

from serializers import PROPERTY_COLUMNS, row_to_geojson


def make_row(**overrides):
    values = {column: None for column in PROPERTY_COLUMNS}
    values.update(
        id=7,
        properties={"osm_tags": {"building": "yes"}, "base_feature_id": 42},
        geometry_json=json.dumps({"type": "Point", "coordinates": [69.2, 41.3]}),
        name="Depot",
        source_kind="manual",
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def test_columns_are_merged_into_properties():
    feature = row_to_geojson(make_row())
    assert feature.id == 7
    assert feature.properties["name"] == "Depot"
    assert feature.properties["source_kind"] == "manual"
    # JSONB extras survive the merge
    assert feature.properties["base_feature_id"] == 42
    assert feature.properties["osm_tags"] == {"building": "yes"}


def test_null_columns_are_dropped():
    feature = row_to_geojson(make_row(icon=None, road_type=None))
    assert "icon" not in feature.properties
    assert "road_type" not in feature.properties


def test_columns_override_stale_jsonb_duplicates():
    row = make_row(properties={"name": "Old name"}, name="New name")
    assert row_to_geojson(row).properties["name"] == "New name"


def test_missing_geometry_is_null_not_error():
    feature = row_to_geojson(make_row(geometry_json=None))
    assert feature.geometry is None
