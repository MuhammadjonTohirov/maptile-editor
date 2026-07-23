"""Overpass API access and OSM tag parsing (rule B8)."""
import time
from typing import Optional

import httpx

# Ordered by observed reliability: the main instance fails fast when
# overloaded, the VK mirror is a healthy full-planet instance close to
# Central Asia, and the last two hang under load, so they go last.
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
OVERPASS_HEADERS = {
    "Content-Type": "text/plain; charset=utf-8",
    # Public Overpass instances reject anonymous/default HTTP client agents.
    # Identifying this local editor keeps requests standards-compliant.
    "User-Agent": "maptile-editor/1.0 (local OSM import)",
}
# The server-side abort every import query embeds ([timeout:...]); the HTTP
# read timeout below allows for queue wait and response transfer on top.
QUERY_TIMEOUT_S = 40
_TIMEOUT = httpx.Timeout(50.0, connect=10.0)
# Public instances 504 transiently under load, so the mirror list is walked
# twice within an overall budget that keeps the worst case inside the nginx
# proxy window (rule X5: budget + one in-flight request < 180s).
_ATTEMPT_ROUNDS = 2
_OVERALL_BUDGET_S = 100.0

_client: Optional[httpx.AsyncClient] = None


class OverpassUnavailable(RuntimeError):
    pass


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True)
    return _client


async def close_client() -> None:
    """Closed by the app lifespan so pooled connections shut down cleanly."""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def describe_failure(url: str, error: Exception) -> str:
    """Timeouts stringify to nothing; fall back to the exception class name."""
    return f"{url}: {str(error) or type(error).__name__}"


async def fetch_overpass(query: str) -> dict:
    """Fetch one Overpass response, trying a small set of public instances."""
    failures = []
    client = _get_client()
    started = time.monotonic()
    for _ in range(_ATTEMPT_ROUNDS):
        for url in OVERPASS_URLS:
            if time.monotonic() - started > _OVERALL_BUDGET_S:
                break
            try:
                response = await client.post(url, content=query, headers=OVERPASS_HEADERS)
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError) as error:
                failures.append(describe_failure(url, error))

    raise OverpassUnavailable(
        "All Overpass mirrors are busy or unreachable; retry in a minute "
        "or zoom in to import a smaller area. " + "; ".join(failures)
    )


def parse_height(value: Optional[str]) -> Optional[float]:
    """Extract a meter value from common OSM height strings without guessing units."""
    if not value:
        return None
    try:
        normalized = value.lower().replace("meters", "").replace("meter", "").replace("m", "").strip()
        meters = float(normalized)
    except (TypeError, ValueError):
        return None
    # Negative heights are tagging noise, never data.
    return meters if meters >= 0 else None


def parse_max_speed(value: Optional[str]) -> Optional[int]:
    """Normalize OSM maxspeed tags to km/h; unparseable values become None."""
    if not value:
        return None
    text = value.strip().lower()
    is_mph = text.endswith("mph")
    text = text.removesuffix("mph").removesuffix("km/h").strip()
    try:
        speed = int(text)
    except ValueError:
        return None
    return round(speed * 1.609344) if is_mph else speed


def parse_int(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def parse_direction(tags: dict) -> str:
    if tags.get("oneway") == "yes":
        return "oneway"
    if tags.get("oneway") == "-1":
        return "oneway_reverse"
    return "bidirectional"
