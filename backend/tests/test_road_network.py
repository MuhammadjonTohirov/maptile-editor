from road_network import PROFILES, edges_sql_for


def test_foot_and_bicycle_are_undirected_and_ignore_oneway():
    for profile in ("foot", "bicycle"):
        sql = edges_sql_for(profile)
        assert PROFILES[profile]["directed"] is False
        assert "reverse_cost" not in sql
        assert "oneway" not in sql


def test_car_is_directed_and_blocks_reverse_of_oneway_roads():
    sql = edges_sql_for("car")
    assert PROFILES["car"]["directed"] is True
    assert "reverse_cost" in sql
    # oneway blocks the reverse direction; oneway_reverse blocks the forward
    # direction — pgRouting treats a negative cost/reverse_cost as unusable.
    assert "WHEN direction = 'oneway' THEN -1" in sql
    assert "WHEN direction = 'oneway_reverse' THEN -1" in sql
    assert "access NOT IN ('no', 'private')" in sql


def test_each_profile_excludes_roads_it_cannot_use():
    assert "footway" in edges_sql_for("car")
    assert "motorway" in edges_sql_for("foot")
    assert "motorway" in edges_sql_for("bicycle")
    # bicycle additionally can't climb steps, unlike foot.
    assert "steps" in edges_sql_for("bicycle")
    assert "steps" not in edges_sql_for("foot")


def test_exclusions_never_let_a_profile_route_on_its_own_excluded_type():
    for profile, spec in PROFILES.items():
        sql = edges_sql_for(profile)
        for road_type in spec["exclude"]:
            assert f"'{road_type}'" in sql


def test_bounded_edges_query_uses_the_geometry_index_operator():
    sql = edges_sql_for("car", (69.0, 40.0, 70.0, 41.0))
    assert "geom && ST_MakeEnvelope(69.000000000, 40.000000000, 70.000000000, 41.000000000, 4326)" in sql


def test_car_prefers_major_roads_and_penalizes_service_shortcuts():
    sql = edges_sql_for("car")
    assert "WHEN 'primary' THEN 1.00" in sql
    assert "WHEN 'secondary' THEN 1.05" in sql
    assert "WHEN 'service' THEN 2.50" in sql
    assert "parking_aisle" in sql
