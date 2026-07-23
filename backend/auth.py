"""Password hashing, JWT sessions, and request auth dependencies (rule B1).

Reads are public; every write route depends on `require_user`, and user
management depends on `require_admin`. The token lives in an httpOnly,
SameSite=Lax cookie so JavaScript never touches it and cross-site writes cannot
carry it.
"""
import datetime as dt
from typing import Optional

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from config import (
    AUTH_COOKIE_NAME,
    BOOTSTRAP_ADMIN_PASSWORD,
    BOOTSTRAP_ADMIN_USERNAME,
    JWT_SECRET,
    JWT_TTL_HOURS,
)
from database import async_session, get_db
from models import User

_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_token(user_id: int) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {"sub": str(user_id), "iat": now, "exp": now + dt.timedelta(hours=JWT_TTL_HOURS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=_ALGORITHM)


def _user_id_from_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[_ALGORITHM])
        return int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, ValueError):
        return None


async def current_user(
    session_token: Optional[str] = Cookie(default=None, alias=AUTH_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """The signed-in user, or None. Used where auth is optional."""
    if not session_token:
        return None
    user_id = _user_id_from_token(session_token)
    if user_id is None:
        return None
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        return None
    return user


async def require_user(user: Optional[User] = Depends(current_user)) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


async def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


async def ensure_bootstrap_admin() -> None:
    """Seed the first admin from env, but only while the users table is empty,
    so a fresh install is never left with editing wide open — and an existing
    deployment's accounts are never touched."""
    if not (BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD):
        return
    async with async_session() as db:
        await db.execute(text(
            "SELECT pg_advisory_xact_lock(hashtext('maptile_bootstrap_admin'))"
        ))
        if await db.scalar(select(func.count(User.id))):
            return
        db.add(User(
            username=BOOTSTRAP_ADMIN_USERNAME,
            password_hash=hash_password(BOOTSTRAP_ADMIN_PASSWORD),
            is_admin=True,
        ))
        await db.commit()
