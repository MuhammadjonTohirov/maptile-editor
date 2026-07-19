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

# --- Editor auth (rule B9: env-driven, safe dev defaults) -------------------
# JWT signing secret. The dev default keeps local logins working but is public;
# set JWT_SECRET in production for stable, private sessions. A fixed default is
# deliberate: a random one would invalidate every session on each --reload.
JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-secret-change-in-production")
JWT_TTL_HOURS = int(os.getenv("JWT_TTL_HOURS", "168"))  # 7 days
AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "editor_session")
# Send the session cookie only over HTTPS. Off by default so http://localhost
# development works; turn on in production.
AUTH_COOKIE_SECURE = os.getenv("AUTH_COOKIE_SECURE", "").lower() in ("1", "true", "yes")

# First-run admin: created only when the users table is empty, so editing is
# never wide open on a fresh install. Leave unset to seed no one.
BOOTSTRAP_ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "")
BOOTSTRAP_ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
