from overpass import parse_direction, parse_height, parse_int, parse_max_speed


def test_parse_height_accepts_common_osm_forms():
    assert parse_height("12") == 12.0
    assert parse_height("12.5 m") == 12.5
    assert parse_height("7 meters") == 7.0


def test_parse_height_rejects_garbage_and_negatives():
    assert parse_height(None) is None
    assert parse_height("") is None
    assert parse_height("tall") is None
    assert parse_height("-3") is None


def test_parse_max_speed_normalizes_to_kmh():
    assert parse_max_speed("50") == 50
    assert parse_max_speed("50 km/h") == 50
    assert parse_max_speed("30 mph") == 48
    assert parse_max_speed("30mph") == 48


def test_parse_max_speed_rejects_non_numeric():
    assert parse_max_speed(None) is None
    assert parse_max_speed("walk") is None


def test_parse_int():
    assert parse_int("4") == 4
    assert parse_int("many") is None
    assert parse_int(None) is None


def test_parse_direction():
    assert parse_direction({"oneway": "yes"}) == "oneway"
    assert parse_direction({"oneway": "-1"}) == "oneway_reverse"
    assert parse_direction({}) == "bidirectional"


def test_failure_description_never_empty():
    import httpx
    from overpass import describe_failure

    timeout = httpx.ReadTimeout("")
    assert describe_failure("https://x", timeout) == "https://x: ReadTimeout"
    assert describe_failure("https://x", ValueError("bad json")) == "https://x: bad json"


def test_queries_embed_the_shared_timeout():
    from osm_import import IMPORT_KINDS
    from overpass import QUERY_TIMEOUT_S
    from schemas import BoundsRequest

    bounds = BoundsRequest(west=69.2, south=41.3, east=69.3, north=41.4)
    for kind in IMPORT_KINDS.values():
        assert f"[timeout:{QUERY_TIMEOUT_S}]" in kind.query(bounds)
