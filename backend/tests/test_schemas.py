import pytest
from pydantic import ValidationError

from schemas import BoundsRequest, FeatureCreate, FeatureUpdate


def test_bounds_accepts_small_viewport():
    bounds = BoundsRequest(west=69.2, south=41.3, east=69.3, north=41.4)
    assert bounds.bbox == "41.3,69.2,41.4,69.3"


def test_bounds_rejects_inverted_axes():
    with pytest.raises(ValidationError):
        BoundsRequest(west=69.3, south=41.3, east=69.2, north=41.4)


def test_bounds_rejects_large_area():
    with pytest.raises(ValidationError):
        BoundsRequest(west=60.0, south=40.0, east=70.0, north=45.0)


def test_source_kind_is_constrained():
    with pytest.raises(ValidationError):
        FeatureCreate(geometry={"type": "Point", "coordinates": [0, 0]}, source_kind="bogus")


def test_update_distinguishes_absent_from_null():
    update = FeatureUpdate(icon=None)
    data = update.model_dump(exclude_unset=True)
    assert data == {"icon": None}  # explicit null clears, absent fields stay


def test_update_accepts_tombstone_kind():
    update = FeatureUpdate(source_kind="base_tombstone")
    assert update.model_dump(exclude_unset=True) == {"source_kind": "base_tombstone"}


def test_name_length_enforced():
    with pytest.raises(ValidationError):
        FeatureCreate(geometry={"type": "Point", "coordinates": [0, 0]}, name="x" * 256)


def test_business_registration_fields():
    feature = FeatureCreate(
        geometry={"type": "Point", "coordinates": [69.2, 41.3]},
        feature_type="business",
        business_type="cafe",
        building_id=12,
    )
    assert feature.business_type == "cafe"
    assert feature.building_id == 12


def test_building_link_must_be_a_real_id():
    with pytest.raises(ValidationError):
        FeatureCreate(geometry={"type": "Point", "coordinates": [0, 0]}, building_id=0)
