"""Application assembly only: middleware, routers, lifespan, health (rule B1)."""
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import auth_api
import bulk_api
import features_api
import imports_api
import road_network_api
from auth import ensure_bootstrap_admin
from config import CORS_ORIGINS
from database import engine, get_db
from overpass import close_client


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed the first admin (if configured) before serving, so a fresh install is
    # never left with editing unprotected.
    await ensure_bootstrap_admin()
    yield
    await close_client()
    await engine.dispose()


app = FastAPI(title="Map Editor API", version="1.0.0", lifespan=lifespan)

# Same-origin production traffic flows through nginx and needs no CORS; this
# only serves direct-to-:8000 development access (rule B9).
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_api.router)
app.include_router(bulk_api.router)
app.include_router(features_api.router)
app.include_router(imports_api.router)
app.include_router(road_network_api.router)


@app.get("/")
async def root():
    return {"message": "Map Editor API", "version": "1.0.0"}


@app.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """Readiness: only healthy when the API can execute a database query."""
    try:
        await db.execute(text("SELECT 1"))
    except Exception as error:
        logger.exception("Database readiness check failed")
        raise HTTPException(status_code=503, detail="database_unavailable") from error
    return {"status": "healthy", "database": "ready"}


@app.get("/health/live")
async def liveness_check():
    return {"status": "alive"}
