"""Auth and user-management endpoints (rule B1).

Login/logout/me are open to anyone; listing users is available to any signed-in
editor (so the properties panel can show who edited a feature); creating and
editing accounts is admin-only.
"""
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from auth import (
    create_token,
    hash_password,
    require_admin,
    require_user,
    verify_password,
)
from config import AUTH_COOKIE_NAME, AUTH_COOKIE_SECURE, JWT_TTL_HOURS
from database import get_db
from models import User
from schemas import CreateUserRequest, LoginRequest, UpdateUserRequest, UserOut

router = APIRouter()


def _set_session_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        AUTH_COOKIE_NAME,
        create_token(user_id),
        max_age=JWT_TTL_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=AUTH_COOKIE_SECURE,
        path="/",
    )


@router.post("/auth/login", response_model=UserOut)
async def login(credentials: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == credentials.username))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    _set_session_cookie(response, user.id)
    return user


@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
    return {"message": "Logged out"}


@router.get("/auth/me", response_model=UserOut)
async def me(user: User = Depends(require_user)):
    return user


@router.get("/auth/users", response_model=list[UserOut])
async def list_users(_: User = Depends(require_user), db: AsyncSession = Depends(get_db)):
    """Any signed-in editor can read the roster — the panel resolves audit ids
    to names — but only admins can change it."""
    result = await db.execute(select(User).order_by(User.username))
    return list(result.scalars())


@router.post("/auth/users", response_model=UserOut, status_code=201)
async def create_user(
    payload: CreateUserRequest,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        is_admin=payload.is_admin,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Username already exists") from error
    await db.refresh(user)
    return user


@router.patch("/auth/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    payload: UpdateUserRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    # An admin cannot lock themselves out: no self-deactivate, no self-demote.
    if user.id == admin.id and (payload.is_active is False or payload.is_admin is False):
        raise HTTPException(status_code=400, detail="You cannot deactivate or demote your own account")
    if payload.password is not None:
        user.password_hash = hash_password(payload.password)
    if payload.is_admin is not None:
        user.is_admin = payload.is_admin
    if payload.is_active is not None:
        user.is_active = payload.is_active
    await db.commit()
    await db.refresh(user)
    return user
