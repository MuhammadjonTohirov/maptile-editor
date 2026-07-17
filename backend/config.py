"""Environment-driven configuration with safe defaults (rule B9)."""
import os

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+asyncpg://postgres:postgres@db:5432/mapdata"
)

# SQL statement logging is opt-in; it must never be on by default.
SQL_ECHO = os.getenv("SQL_ECHO", "").lower() in ("1", "true", "yes")

# Production traffic is same-origin through nginx; CORS exists only for direct
# development access to :8000. Wildcard origins with credentials are invalid
# per the fetch spec, so origins are always explicit.
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
