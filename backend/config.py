"""Environment-driven configuration with safe defaults (rule B9)."""
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@db:5432/mapdata"
)

# SQL statement logging is opt-in; it must never be on by default.
SQL_ECHO = os.getenv("SQL_ECHO", "").lower() in ("1", "true", "yes")

# At or above this feature count the client is served the whole basemap from
# editor tiles (base OSM detail hidden) instead of the small-data overlay:
# a full-country bulk load crosses it, a handful of per-area imports does not.
FULL_BASE_THRESHOLD = int(os.getenv("FULL_BASE_THRESHOLD", "50000"))

# Bounded feature reads never return more than this many rows, so a viewport
# query at low zoom over a country-scale dataset cannot flood the browser.
FEATURE_QUERY_LIMIT = int(os.getenv("FEATURE_QUERY_LIMIT", "4000"))

# Production traffic is same-origin through nginx; CORS exists only for direct
# development access to :8000. Wildcard origins with credentials are invalid
# per the fetch spec, so origins are always explicit.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
