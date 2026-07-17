"""Overpass API access and OSM tag parsing (rule B8)."""
from typing import Optional

import httpx
from fastapi import HTTPException

OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
OVERPASS_HEADERS = {
    "Content-Type": "text/plain; charset=utf-8",
    # Public Overpass instances reject anonymous/default HTTP client agents.
    # Identifying this local editor keeps requests standards-compliant.
    "User-Agent": "maptile-editor/1.0 (local OSM import)",
}
_TIMEOUT = httpx.Timeout(45.0, connect=10.0)

_client: Optional[httpx.AsyncClient] = None


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


async def fetch_overpass(query: str) -> dict:
    """Fetch one Overpass response, trying a small set of public instances."""
    failures = []
    client = _get_client()
    for url in OVERPASS_URLS:
        try:
            response = await client.post(url, content=query, headers=OVERPASS_HEADERS)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            failures.append(f"{url}: {error}")

    raise HTTPException(
        status_code=502,
        detail="Unable to fetch OSM data from Overpass. " + "; ".join(failures),
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
