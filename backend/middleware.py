"""
Custom middleware for production-ready features
Rate limiting, request validation, and security headers
"""

import time
import json
from typing import Dict, Optional
from collections import defaultdict, deque
from fastapi import Request, Response, HTTPException, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.gzip import GZipMiddleware
import logging

from config import settings

logger = logging.getLogger(__name__)

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Rate limiting middleware using sliding window algorithm"""
    
    def __init__(self, app, requests_per_minute: int = 60):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.window_size = 60  # 1 minute window
        self.clients: Dict[str, deque] = defaultdict(deque)
    
    def _get_client_id(self, request: Request) -> str:
        """Get client identifier from request"""
        # Try to get real IP from headers (if behind proxy)
        real_ip = request.headers.get("X-Real-IP")
        forwarded_for = request.headers.get("X-Forwarded-For")
        
        if real_ip:
            return real_ip
        elif forwarded_for:
            return forwarded_for.split(",")[0].strip()
        else:
            return request.client.host if request.client else "unknown"
    
    def _is_rate_limited(self, client_id: str) -> bool:
        """Check if client is rate limited"""
        now = time.time()
        client_requests = self.clients[client_id]
        
        # Remove old requests outside the window
        while client_requests and client_requests[0] < now - self.window_size:
            client_requests.popleft()
        
        # Check if limit exceeded
        if len(client_requests) >= self.requests_per_minute:
            return True
        
        # Add current request
        client_requests.append(now)
        return False
    
    async def dispatch(self, request: Request, call_next):
        """Process request with rate limiting"""
        client_id = self._get_client_id(request)
        
        # Skip rate limiting for health checks
        if request.url.path == "/health":
            return await call_next(request)
        
        if self._is_rate_limited(client_id):
            logger.warning(f"Rate limit exceeded for client {client_id}")
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "error": "Rate limit exceeded",
                    "message": f"Too many requests. Limit: {self.requests_per_minute} per minute"
                },
                headers={"Retry-After": "60"}
            )
        
        response = await call_next(request)
        return response

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to responses"""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # Security headers
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        
        # CSP for API
        response.headers["Content-Security-Policy"] = "default-src 'self'"
        
        return response

class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Log all requests for monitoring"""
    
    async def dispatch(self, request: Request, call_next):
        start_time = time.time()
        client_id = self._get_client_id(request)
        
        # Process request
        response = await call_next(request)
        
        # Calculate duration
        duration = time.time() - start_time
        
        # Log request
        logger.info(
            f"Request processed",
            extra={
                "method": request.method,
                "path": request.url.path,
                "client_id": client_id,
                "status_code": response.status_code,
                "duration": round(duration, 3),
                "user_agent": request.headers.get("User-Agent", ""),
            }
        )
        
        return response
    
    def _get_client_id(self, request: Request) -> str:
        """Get client identifier from request"""
        real_ip = request.headers.get("X-Real-IP")
        forwarded_for = request.headers.get("X-Forwarded-For")
        
        if real_ip:
            return real_ip
        elif forwarded_for:
            return forwarded_for.split(",")[0].strip()
        else:
            return request.client.host if request.client else "unknown"

class ValidationMiddleware(BaseHTTPMiddleware):
    """Validate request size and content"""
    
    def __init__(self, app, max_request_size: int = 10 * 1024 * 1024):  # 10MB
        super().__init__(app)
        self.max_request_size = max_request_size
    
    async def dispatch(self, request: Request, call_next):
        # Check request size
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > self.max_request_size:
            return JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={
                    "error": "Request too large",
                    "message": f"Request size exceeds limit of {self.max_request_size} bytes"
                }
            )
        
        # Validate JSON for POST/PUT requests
        if request.method in ["POST", "PUT"] and request.headers.get("content-type") == "application/json":
            try:
                body = await request.body()
                if body:
                    json.loads(body)
            except json.JSONDecodeError:
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={
                        "error": "Invalid JSON",
                        "message": "Request body contains invalid JSON"
                    }
                )
        
        return await call_next(request)

def setup_middleware(app):
    """Setup all middleware for the application"""
    
    # Compression
    app.add_middleware(GZipMiddleware, minimum_size=1000)
    
    # Security headers
    app.add_middleware(SecurityHeadersMiddleware)
    
    # Request validation
    app.add_middleware(ValidationMiddleware, max_request_size=settings.max_geometry_size)
    
    # Rate limiting
    app.add_middleware(RateLimitMiddleware, requests_per_minute=settings.rate_limit_requests)
    
    # Request logging
    app.add_middleware(RequestLoggingMiddleware)
    
    # Trusted hosts (production only)
    if not settings.dev_mode:
        allowed_hosts = ["*"]  # Configure this based on your domain
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
    
    logger.info("Middleware setup completed")