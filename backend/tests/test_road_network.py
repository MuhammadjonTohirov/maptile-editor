import asyncio
import json
from types import SimpleNamespace

import pytest

from road_network import (
    ACCESS_LEG_SPEED_MPS,
    PROFILES,
    RoutePoint,
    edges_sql_for,
    find_route,
    points_sql_for,
)


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


def test_route_points_use_fractional_edges_instead_of_nearest_nodes():
    start = RoutePoint(1, 41, 0.125, 71.0, 40.0, 0.0)
    end = RoutePoint(2, 52, 0.875, 72.0, 41.0, 0.0)

    sql = points_sql_for(start, end)

    assert "(1::bigint, 41::bigint, 0.125::float8, 'b'::char)" in sql
    assert "(2::bigint, 52::bigint, 0.875::float8, 'b'::char)" in sql
    assert start.vid == -1
    assert end.vid == -2


class _FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def first(self):
        return self.rows[0] if self.rows else None

    def all(self):
        return self.rows


class _FakeDatabase:
    def __init__(self, result_rows):
        self.result_rows = iter(result_rows)
        self.calls = []

    async def execute(self, statement, parameters=None):
        self.calls.append((str(statement), parameters or {}))
        return _FakeResult(next(self.result_rows))


def test_route_geometry_starts_and_ends_at_building_clicks():
    requested_start = [71.7790, 40.3840]
    requested_end = [71.7820, 40.3850]
    snapped_start = [71.7792, 40.3841]
    snapped_end = [71.7818, 40.3849]
    database = _FakeDatabase([
        [SimpleNamespace(
            edge_id=41, fraction=0.25,
            snapped_lng=snapped_start[0], snapped_lat=snapped_start[1], access_m=20.0,
        )],
        [SimpleNamespace(
            edge_id=52, fraction=0.75,
            snapped_lng=snapped_end[0], snapped_lat=snapped_end[1], access_m=10.0,
        )],
        [
            SimpleNamespace(path_seq=1, node=-1, edge=41),
            SimpleNamespace(path_seq=2, node=100, edge=52),
            SimpleNamespace(path_seq=3, node=-2, edge=-1),
        ],
        [
            SimpleNamespace(
                geojson=json.dumps({
                    "type": "LineString",
                    "coordinates": [snapped_start, [71.7800, 40.3845]],
                }),
                distance_m=50.0,
                car_duration_s=5.0,
            ),
            SimpleNamespace(
                geojson=json.dumps({
                    "type": "LineString",
                    "coordinates": [[71.7800, 40.3845], snapped_end],
                }),
                distance_m=70.0,
                car_duration_s=7.0,
            ),
        ],
    ])

    route = asyncio.run(find_route(
        database,
        requested_start[0], requested_start[1],
        requested_end[0], requested_end[1],
        "car",
    ))

    assert route is not None
    assert route["geometry"]["coordinates"][0] == requested_start
    assert route["geometry"]["coordinates"][-1] == requested_end
    assert snapped_start in route["geometry"]["coordinates"]
    assert snapped_end in route["geometry"]["coordinates"]
    assert route["distance_m"] == pytest.approx(150.0)
    assert route["duration_s"] == pytest.approx(12.0 + 30.0 / ACCESS_LEG_SPEED_MPS)

    path_statement, path_parameters = database.calls[2]
    assert "pgr_withPoints" in path_statement
    assert "pgr_dijkstra" not in path_statement
    assert "0.25::float8" in path_parameters["points_sql"]
    assert "0.75::float8" in path_parameters["points_sql"]

    geometry_statement, geometry_parameters = database.calls[3]
    assert "ST_LineSubstring" in geometry_statement
    assert json.loads(geometry_parameters["steps_json"]) == [
        {"path_seq": 1, "node": -1, "next_node": 100, "edge": 41},
        {"path_seq": 2, "node": 100, "next_node": -2, "edge": 52},
    ]
