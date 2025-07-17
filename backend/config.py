"""
Production-ready configuration management
Handles environment variables and secure settings
"""

import os
from typing import List, Optional
from pydantic import BaseSettings, validator
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings with environment variable support"""
    
    # Database Configuration
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "mapdata"
    db_user: str = "postgres"
    db_password: str = "postgres"
    database_url: Optional[str] = None
    
    # API Configuration
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_debug: bool = False
    
    # Security Configuration
    secret_key: str = "change-this-in-production"
    jwt_secret_key: str = "change-this-jwt-secret-in-production"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 30
    
    # CORS Configuration
    cors_origins: List[str] = ["http://localhost:3000"]
    cors_allow_credentials: bool = True
    
    # Rate Limiting
    rate_limit_requests: int = 1000
    rate_limit_window: int = 3600
    
    # External Services
    osm_api_base_url: str = "https://overpass-api.de/api/interpreter"
    osm_api_timeout: int = 30
    
    # Logging Configuration
    log_level: str = "INFO"
    log_format: str = "json"
    log_file: str = "logs/app.log"
    
    # SSL/TLS Configuration
    ssl_enabled: bool = False
    ssl_cert_path: Optional[str] = None
    ssl_key_path: Optional[str] = None
    ssl_ca_cert_path: Optional[str] = None
    ssl_key_password: Optional[str] = None
    ssl_require_client_cert: bool = False
    
    # Cache Configuration
    cache_type: str = "memory"
    cache_redis_url: str = "redis://localhost:6379/0"
    cache_ttl: int = 3600
    
    # Feature Configuration
    max_features_per_request: int = 1000
    max_geometry_size: int = 10000
    enable_feature_caching: bool = True
    
    # Development Settings
    dev_mode: bool = False
    dev_reload: bool = False
    dev_db_echo: bool = False
    
    @validator('cors_origins', pre=True)
    def parse_cors_origins(cls, v):
        """Parse comma-separated CORS origins"""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(',')]
        return v
    
    @validator('database_url', pre=True)
    def build_database_url(cls, v, values):
        """Build database URL if not provided"""
        if v:
            return v
        return (
            f"postgresql+asyncpg://{values.get('db_user')}:"
            f"{values.get('db_password')}@{values.get('db_host')}:"
            f"{values.get('db_port')}/{values.get('db_name')}"
        )
    
    @validator('secret_key', 'jwt_secret_key')
    def validate_secrets(cls, v):
        """Ensure secrets are changed from default"""
        if v in ('change-this-in-production', 'change-this-jwt-secret-in-production'):
            raise ValueError('Secret keys must be changed from default values')
        return v
    
    @validator('log_level')
    def validate_log_level(cls, v):
        """Validate log level"""
        valid_levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
        if v.upper() not in valid_levels:
            raise ValueError(f'Log level must be one of {valid_levels}')
        return v.upper()
    
    class Config:
        env_file = ".env"
        case_sensitive = False
        
        # Environment variable mappings
        fields = {
            'db_host': {'env': 'DB_HOST'},
            'db_port': {'env': 'DB_PORT'},
            'db_name': {'env': 'DB_NAME'},
            'db_user': {'env': 'DB_USER'},
            'db_password': {'env': 'DB_PASSWORD'},
            'database_url': {'env': 'DATABASE_URL'},
            'api_host': {'env': 'API_HOST'},
            'api_port': {'env': 'API_PORT'},
            'api_debug': {'env': 'API_DEBUG'},
            'secret_key': {'env': 'SECRET_KEY'},
            'jwt_secret_key': {'env': 'JWT_SECRET_KEY'},
            'jwt_access_token_expire_minutes': {'env': 'JWT_ACCESS_TOKEN_EXPIRE_MINUTES'},
            'jwt_refresh_token_expire_days': {'env': 'JWT_REFRESH_TOKEN_EXPIRE_DAYS'},
            'cors_origins': {'env': 'CORS_ORIGINS'},
            'cors_allow_credentials': {'env': 'CORS_ALLOW_CREDENTIALS'},
            'rate_limit_requests': {'env': 'RATE_LIMIT_REQUESTS'},
            'rate_limit_window': {'env': 'RATE_LIMIT_WINDOW'},
            'osm_api_base_url': {'env': 'OSM_API_BASE_URL'},
            'osm_api_timeout': {'env': 'OSM_API_TIMEOUT'},
            'log_level': {'env': 'LOG_LEVEL'},
            'log_format': {'env': 'LOG_FORMAT'},
            'log_file': {'env': 'LOG_FILE'},
            'ssl_enabled': {'env': 'SSL_ENABLED'},
            'ssl_cert_path': {'env': 'SSL_CERT_PATH'},
            'ssl_key_path': {'env': 'SSL_KEY_PATH'},
            'ssl_ca_cert_path': {'env': 'SSL_CA_CERT_PATH'},
            'ssl_key_password': {'env': 'SSL_KEY_PASSWORD'},
            'ssl_require_client_cert': {'env': 'SSL_REQUIRE_CLIENT_CERT'},
            'cache_type': {'env': 'CACHE_TYPE'},
            'cache_redis_url': {'env': 'CACHE_REDIS_URL'},
            'cache_ttl': {'env': 'CACHE_TTL'},
            'max_features_per_request': {'env': 'MAX_FEATURES_PER_REQUEST'},
            'max_geometry_size': {'env': 'MAX_GEOMETRY_SIZE'},
            'enable_feature_caching': {'env': 'ENABLE_FEATURE_CACHING'},
            'dev_mode': {'env': 'DEV_MODE'},
            'dev_reload': {'env': 'DEV_RELOAD'},
            'dev_db_echo': {'env': 'DEV_DB_ECHO'},
        }


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance"""
    return Settings()


# Global settings instance
settings = get_settings()


def is_production() -> bool:
    """Check if running in production mode"""
    return not settings.dev_mode


def get_database_url() -> str:
    """Get database URL for connections"""
    return settings.database_url


def get_cors_origins() -> List[str]:
    """Get CORS origins list"""
    return settings.cors_origins


def get_log_config() -> dict:
    """Get logging configuration"""
    return {
        'level': settings.log_level,
        'format': settings.log_format,
        'file': settings.log_file
    }