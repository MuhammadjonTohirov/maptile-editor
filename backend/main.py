"""
Main application entry point
Creates and configures the FastAPI application using the app factory pattern

All API endpoints are now organized in separate router modules:
- routers/auth.py: Authentication endpoints (/auth/*)
- routers/features.py: Feature CRUD operations (/features/*)
- routers/osm.py: OpenStreetMap data loading (/osm/*)
- routers/spatial.py: Spatial queries (/spatial/*)
- routers/health.py: Health checks and monitoring (/health, /metrics, /)
"""

from app_factory import create_app

# Create the FastAPI application with all routers included
app = create_app()