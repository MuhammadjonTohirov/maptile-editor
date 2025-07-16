"""
Production-ready database configuration
Handles connection pooling and secure settings
"""

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.pool import NullPool
import logging

from config import settings, get_database_url, is_production

logger = logging.getLogger(__name__)

# Database engine configuration
engine_kwargs = {
    'echo': settings.dev_db_echo,
    'pool_pre_ping': True,
    'pool_recycle': 3600,  # Recycle connections after 1 hour
}

# Production-specific settings
if is_production():
    engine_kwargs.update({
        'pool_size': 20,
        'max_overflow': 30,
        'pool_timeout': 30,
        'echo': False,  # Never echo in production
    })
else:
    engine_kwargs.update({
        'pool_size': 5,
        'max_overflow': 10,
        'poolclass': NullPool,  # Use NullPool for development
    })

# Create async engine
engine = create_async_engine(
    get_database_url(),
    **engine_kwargs
)

# Session factory
async_session = sessionmaker(
    engine, 
    class_=AsyncSession, 
    expire_on_commit=False
)

# Base class for models
Base = declarative_base()

async def get_db():
    """Database dependency for FastAPI"""
    async with async_session() as session:
        try:
            yield session
        except Exception as e:
            logger.error(f"Database session error: {e}")
            await session.rollback()
            raise
        finally:
            await session.close()

async def init_db():
    """Initialize database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def close_db():
    """Close database connections"""
    await engine.dispose()