"""Application assembly only: middleware, routers, lifespan, health (rule B1)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import auth_api
import features_api
import imports_api
from auth import ensure_bootstrap_admin
from config import CORS_ORIGINS
from overpass import close_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed the first admin (if configured) before serving, so a fresh install is
    # never left with editing unprotected.
    await ensure_bootstrap_admin()
    yield
    await close_client()


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
app.include_router(features_api.router)
app.include_router(imports_api.router)


@app.get("/")
async def root():
    return {"message": "Map Editor API", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}
