from features_api import _source_kind_after_user_update


def test_user_edit_promotes_osm_import_to_local_override():
    assert _source_kind_after_user_update("osm_import", "osm_import") == "manual"


def test_user_edit_preserves_existing_manual_and_tombstone_states():
    assert _source_kind_after_user_update("manual", "manual") == "manual"
    assert _source_kind_after_user_update("osm_import", "base_tombstone") == "base_tombstone"
