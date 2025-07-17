"""
Production-ready caching system with Redis and memory fallback
Implements multiple caching strategies for features, tiles, and API responses
"""

import json
import time
import hashlib
import logging
from typing import Any, Optional, Dict, List, Union
from abc import ABC, abstractmethod
from functools import wraps
import asyncio

try:
    import redis.asyncio as redis
    from redis.exceptions import RedisError, ConnectionError
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

from config import settings

logger = logging.getLogger(__name__)

class CacheBackend(ABC):
    """Abstract cache backend interface"""
    
    @abstractmethod
    async def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        pass
    
    @abstractmethod
    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        """Set value in cache with optional TTL"""
        pass
    
    @abstractmethod
    async def delete(self, key: str) -> bool:
        """Delete key from cache"""
        pass
    
    @abstractmethod
    async def clear(self) -> bool:
        """Clear all cache entries"""
        pass
    
    @abstractmethod
    async def exists(self, key: str) -> bool:
        """Check if key exists in cache"""
        pass

class MemoryCache(CacheBackend):
    """In-memory cache implementation with TTL support"""
    
    def __init__(self, max_size: int = 1000):
        self.cache: Dict[str, tuple] = {}  # key -> (value, expire_time)
        self.max_size = max_size
        self._lock = asyncio.Lock()
    
    async def _cleanup_expired(self):
        """Remove expired entries"""
        current_time = time.time()
        expired_keys = [
            key for key, (_, expire_time) in self.cache.items()
            if expire_time and expire_time < current_time
        ]
        for key in expired_keys:
            del self.cache[key]
    
    async def _evict_if_needed(self):
        """Evict oldest entries if cache is full"""
        if len(self.cache) >= self.max_size:
            # Remove oldest 10% of entries
            to_remove = max(1, len(self.cache) // 10)
            keys_to_remove = list(self.cache.keys())[:to_remove]
            for key in keys_to_remove:
                del self.cache[key]
    
    async def get(self, key: str) -> Optional[Any]:
        async with self._lock:
            await self._cleanup_expired()
            
            if key not in self.cache:
                return None
            
            value, expire_time = self.cache[key]
            if expire_time and expire_time < time.time():
                del self.cache[key]
                return None
            
            return value
    
    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        async with self._lock:
            await self._cleanup_expired()
            await self._evict_if_needed()
            
            expire_time = time.time() + ttl if ttl else None
            self.cache[key] = (value, expire_time)
            return True
    
    async def delete(self, key: str) -> bool:
        async with self._lock:
            return self.cache.pop(key, None) is not None
    
    async def clear(self) -> bool:
        async with self._lock:
            self.cache.clear()
            return True
    
    async def exists(self, key: str) -> bool:
        async with self._lock:
            await self._cleanup_expired()
            
            if key not in self.cache:
                return False
            
            _, expire_time = self.cache[key]
            if expire_time and expire_time < time.time():
                del self.cache[key]
                return False
            
            return True

class RedisCache(CacheBackend):
    """Redis-based cache implementation"""
    
    def __init__(self, redis_url: str):
        self.redis_url = redis_url
        self._client = None
        self._connected = False
    
    async def _get_client(self) -> Optional[redis.Redis]:
        """Get Redis client with connection management"""
        if not REDIS_AVAILABLE:
            logger.warning("Redis not available, falling back to memory cache")
            return None
        
        if self._client is None:
            try:
                self._client = redis.from_url(
                    self.redis_url,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_timeout=5,
                    socket_connect_timeout=5,
                    retry_on_timeout=True
                )
                # Test connection
                await self._client.ping()
                self._connected = True
                logger.info("Redis cache connected successfully")
                
            except Exception as e:
                logger.error(f"Failed to connect to Redis: {e}")
                self._client = None
                self._connected = False
                return None
        
        return self._client if self._connected else None
    
    async def get(self, key: str) -> Optional[Any]:
        client = await self._get_client()
        if not client:
            return None
        
        try:
            value = await client.get(key)
            if value is None:
                return None
            
            # Try to deserialize JSON
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value
                
        except RedisError as e:
            logger.error(f"Redis get error for key {key}: {e}")
            return None
    
    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        client = await self._get_client()
        if not client:
            return False
        
        try:
            # Serialize value
            if isinstance(value, (dict, list)):
                serialized_value = json.dumps(value)
            else:
                serialized_value = str(value)
            
            if ttl:
                await client.setex(key, ttl, serialized_value)
            else:
                await client.set(key, serialized_value)
            
            return True
            
        except RedisError as e:
            logger.error(f"Redis set error for key {key}: {e}")
            return False
    
    async def delete(self, key: str) -> bool:
        client = await self._get_client()
        if not client:
            return False
        
        try:
            result = await client.delete(key)
            return result > 0
            
        except RedisError as e:
            logger.error(f"Redis delete error for key {key}: {e}")
            return False
    
    async def clear(self) -> bool:
        client = await self._get_client()
        if not client:
            return False
        
        try:
            await client.flushdb()
            return True
            
        except RedisError as e:
            logger.error(f"Redis clear error: {e}")
            return False
    
    async def exists(self, key: str) -> bool:
        client = await self._get_client()
        if not client:
            return False
        
        try:
            result = await client.exists(key)
            return result > 0
            
        except RedisError as e:
            logger.error(f"Redis exists error for key {key}: {e}")
            return False

class HybridCache(CacheBackend):
    """Hybrid cache with Redis primary and memory fallback"""
    
    def __init__(self, redis_url: str, memory_max_size: int = 1000):
        self.redis_cache = RedisCache(redis_url)
        self.memory_cache = MemoryCache(memory_max_size)
    
    async def get(self, key: str) -> Optional[Any]:
        # Try Redis first
        value = await self.redis_cache.get(key)
        if value is not None:
            # Store in memory cache for faster access
            await self.memory_cache.set(key, value, ttl=300)  # 5 min in memory
            return value
        
        # Fallback to memory cache
        return await self.memory_cache.get(key)
    
    async def set(self, key: str, value: Any, ttl: int = None) -> bool:
        # Try Redis first
        redis_success = await self.redis_cache.set(key, value, ttl)
        
        # Always store in memory cache
        memory_success = await self.memory_cache.set(key, value, ttl)
        
        return redis_success or memory_success
    
    async def delete(self, key: str) -> bool:
        redis_success = await self.redis_cache.delete(key)
        memory_success = await self.memory_cache.delete(key)
        return redis_success or memory_success
    
    async def clear(self) -> bool:
        redis_success = await self.redis_cache.clear()
        memory_success = await self.memory_cache.clear()
        return redis_success or memory_success
    
    async def exists(self, key: str) -> bool:
        return await self.redis_cache.exists(key) or await self.memory_cache.exists(key)

class CacheManager:
    """Main cache manager with feature-specific caching strategies"""
    
    def __init__(self):
        self.backend = self._create_backend()
        self.default_ttl = settings.cache_ttl
    
    def _create_backend(self) -> CacheBackend:
        """Create appropriate cache backend based on configuration"""
        if settings.cache_type == "redis" and REDIS_AVAILABLE:
            return HybridCache(settings.cache_redis_url)
        elif settings.cache_type == "memory":
            return MemoryCache(max_size=10000)
        else:
            logger.warning(f"Unknown cache type: {settings.cache_type}, using memory cache")
            return MemoryCache(max_size=10000)
    
    def _generate_key(self, prefix: str, *args, **kwargs) -> str:
        """Generate cache key from prefix and arguments"""
        key_parts = [prefix]
        
        # Add positional arguments
        for arg in args:
            if isinstance(arg, (dict, list)):
                key_parts.append(hashlib.md5(json.dumps(arg, sort_keys=True).encode()).hexdigest())
            else:
                key_parts.append(str(arg))
        
        # Add keyword arguments
        if kwargs:
            sorted_kwargs = sorted(kwargs.items())
            kwargs_str = json.dumps(sorted_kwargs, sort_keys=True)
            key_parts.append(hashlib.md5(kwargs_str.encode()).hexdigest())
        
        return ":".join(key_parts)
    
    async def get_features(self, bounds: Dict[str, float] = None, feature_types: List[str] = None) -> Optional[Any]:
        """Get cached features for specific bounds and types"""
        if not settings.enable_feature_caching:
            return None
        
        key = self._generate_key("features", bounds=bounds, types=feature_types)
        return await self.backend.get(key)
    
    async def set_features(self, features: Any, bounds: Dict[str, float] = None, feature_types: List[str] = None, ttl: int = None) -> bool:
        """Cache features for specific bounds and types"""
        if not settings.enable_feature_caching:
            return False
        
        key = self._generate_key("features", bounds=bounds, types=feature_types)
        return await self.backend.set(key, features, ttl or self.default_ttl)
    
    async def get_osm_data(self, query_hash: str) -> Optional[Any]:
        """Get cached OSM data"""
        key = self._generate_key("osm", query_hash)
        return await self.backend.get(key)
    
    async def set_osm_data(self, data: Any, query_hash: str, ttl: int = None) -> bool:
        """Cache OSM data"""
        key = self._generate_key("osm", query_hash)
        # OSM data can be cached longer
        return await self.backend.set(key, data, ttl or (self.default_ttl * 24))
    
    async def get_user_session(self, user_id: int) -> Optional[Any]:
        """Get cached user session data"""
        key = self._generate_key("user_session", user_id)
        return await self.backend.get(key)
    
    async def set_user_session(self, session_data: Any, user_id: int, ttl: int = None) -> bool:
        """Cache user session data"""
        key = self._generate_key("user_session", user_id)
        return await self.backend.set(key, session_data, ttl or 1800)  # 30 minutes
    
    async def invalidate_features(self, bounds: Dict[str, float] = None) -> bool:
        """Invalidate feature cache for specific bounds"""
        if bounds:
            key = self._generate_key("features", bounds=bounds)
            return await self.backend.delete(key)
        else:
            # Clear all feature caches (expensive operation)
            return await self.clear_pattern("features:*")
    
    async def clear_pattern(self, pattern: str) -> bool:
        """Clear cache entries matching pattern (Redis only)"""
        if isinstance(self.backend, (RedisCache, HybridCache)):
            try:
                client = await self.backend.redis_cache._get_client()
                if client:
                    keys = await client.keys(pattern)
                    if keys:
                        await client.delete(*keys)
                    return True
            except Exception as e:
                logger.error(f"Error clearing cache pattern {pattern}: {e}")
        
        return False
    
    async def clear_all(self) -> bool:
        """Clear all cache entries"""
        return await self.backend.clear()

# Global cache manager instance
cache_manager = CacheManager()

def cache_result(key_prefix: str, ttl: int = None):
    """Decorator to cache function results"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Generate cache key
            key = cache_manager._generate_key(key_prefix, *args, **kwargs)
            
            # Try to get from cache
            cached_result = await cache_manager.backend.get(key)
            if cached_result is not None:
                logger.debug(f"Cache hit for key: {key}")
                return cached_result
            
            # Execute function
            result = await func(*args, **kwargs)
            
            # Cache result
            if result is not None:
                await cache_manager.backend.set(key, result, ttl or cache_manager.default_ttl)
                logger.debug(f"Cached result for key: {key}")
            
            return result
        
        return wrapper
    return decorator

async def warm_cache():
    """Pre-populate cache with frequently accessed data"""
    logger.info("Starting cache warm-up...")
    
    try:
        # You can add cache warming logic here
        # For example, pre-load common feature queries
        logger.info("Cache warm-up completed")
        
    except Exception as e:
        logger.error(f"Cache warm-up failed: {e}")

async def cache_health_check() -> Dict[str, Any]:
    """Check cache health and return status"""
    status = {
        "cache_type": settings.cache_type,
        "redis_available": REDIS_AVAILABLE,
        "backend_type": type(cache_manager.backend).__name__,
        "healthy": False
    }
    
    try:
        # Test cache operations
        test_key = "health_check_test"
        test_value = {"timestamp": time.time()}
        
        # Test write
        write_success = await cache_manager.backend.set(test_key, test_value, 60)
        
        # Test read
        read_value = await cache_manager.backend.get(test_key)
        
        # Test delete
        delete_success = await cache_manager.backend.delete(test_key)
        
        status["healthy"] = write_success and read_value is not None and delete_success
        status["operations"] = {
            "write": write_success,
            "read": read_value is not None,
            "delete": delete_success
        }
        
    except Exception as e:
        status["error"] = str(e)
        logger.error(f"Cache health check failed: {e}")
    
    return status