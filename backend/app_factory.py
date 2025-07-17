"""
Application factory for creating and configuring the FastAPI app
Handles app initialization, middleware setup, and router registration
"""

import logging
import signal
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings, get_cors_origins, is_production
from middleware import setup_middleware
from routers import auth, features, osm, spatial, health

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle - startup and shutdown"""
    logger.info("Starting Map Editor API...")
    
    # Startup tasks
    try:
        # Initialize cache if needed
        from cache import warm_cache
        await warm_cache()
        logger.info("Application startup completed")
    except Exception as e:
        logger.error(f"Error during startup: {e}")
    
    yield
    
    # Shutdown tasks
    logger.info("Shutting down Map Editor API...")
    try:
        # Close database connections
        from database import engine
        if engine:
            await engine.dispose()
            logger.info("Database connections closed")
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")


def setup_signal_handlers():
    """Setup signal handlers for graceful shutdown"""
    def signal_handler(signum, frame):
        logger.info(f"Received signal {signum}. Initiating graceful shutdown...")
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)


def create_app() -> FastAPI:
    """Create and configure the FastAPI application"""
    
    # Create FastAPI app
    app = FastAPI(
        title="Map Editor API",
        description="A production-ready map editing API with PostGIS and OpenStreetMap integration",
        version="1.0.0",
        debug=settings.api_debug,
        lifespan=lifespan,
        docs_url="/docs" if not is_production() else None,  # Disable docs in production
        redoc_url="/redoc" if not is_production() else None
    )
    
    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=get_cors_origins(),
        allow_credentials=settings.cors_allow_credentials,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["*"],
    )
    
    # Setup production middleware (rate limiting, security headers, etc.)
    setup_middleware(app)
    
    # Include routers
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(features.router)
    app.include_router(osm.router)
    app.include_router(spatial.router)
    
    # Setup signal handlers for graceful shutdown
    setup_signal_handlers()
    
    logger.info("FastAPI application created and configured")
    return app