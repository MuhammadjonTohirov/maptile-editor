from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from config import DATABASE_URL, SQL_ECHO

engine = create_async_engine(DATABASE_URL, echo=SQL_ECHO)
async_session = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncIterator[AsyncSession]:
    """One session per request; any escaped exception rolls its work back (rule B4)."""
    async with async_session() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
