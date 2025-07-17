"""
Health check and monitoring endpoints
Provides system health status and metrics
"""

from fastapi import APIRouter
from datetime import datetime
import httpx
import psutil
from sqlalchemy import text

from database import engine
from config import is_production
from cache import cache_health_check

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    """Comprehensive health check endpoint"""
    health_status = {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": "1.0.0",
        "environment": "production" if is_production() else "development",
        "checks": {}
    }
    
    # Database health check
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        health_status["checks"]["database"] = {"status": "healthy", "response_time": "< 100ms"}
    except Exception as e:
        health_status["checks"]["database"] = {"status": "unhealthy", "error": str(e)}
        health_status["status"] = "unhealthy"
    
    # Cache health check
    try:
        cache_status = await cache_health_check()
        health_status["checks"]["cache"] = cache_status
        if cache_status["status"] != "healthy":
            health_status["status"] = "degraded"
    except Exception as e:
        health_status["checks"]["cache"] = {"status": "unhealthy", "error": str(e)}
    
    # External API health check (OSM)
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get("https://overpass-api.de/api/status")
            if response.status_code == 200:
                health_status["checks"]["osm_api"] = {"status": "healthy", "response_time": "< 5s"}
            else:
                health_status["checks"]["osm_api"] = {"status": "degraded", "status_code": response.status_code}
    except Exception as e:
        health_status["checks"]["osm_api"] = {"status": "unhealthy", "error": str(e)}
    
    # Memory and system check
    try:
        memory_percent = psutil.virtual_memory().percent
        cpu_percent = psutil.cpu_percent(interval=1)
        
        health_status["checks"]["system"] = {
            "status": "healthy" if memory_percent < 80 and cpu_percent < 80 else "degraded",
            "memory_usage": f"{memory_percent}%",
            "cpu_usage": f"{cpu_percent}%"
        }
        
        if memory_percent > 90 or cpu_percent > 90:
            health_status["status"] = "unhealthy"
    except Exception as e:
        health_status["checks"]["system"] = {"status": "unknown", "error": str(e)}
    
    return health_status


@router.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    from starlette.responses import Response
    
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@router.get("/")
async def root():
    """API root endpoint"""
    return {
        "message": "Map Editor API", 
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs"
    }