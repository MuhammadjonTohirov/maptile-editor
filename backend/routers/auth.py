"""
Authentication endpoints
Handles login, user info, and JWT token management
"""

from fastapi import APIRouter, Depends, HTTPException, status
from datetime import timedelta
from auth import authenticate_user, create_access_token, create_refresh_token, Token, get_current_active_user, User
from config import settings

router = APIRouter(prefix="/auth", tags=["authentication"])


@router.post("/login", response_model=Token)
async def login(form_data: dict):
    """Login endpoint for JWT authentication"""
    username = form_data.get("username")
    password = form_data.get("password")
    
    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username and password required"
        )
    
    user = authenticate_user(username, password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = timedelta(minutes=settings.jwt_access_token_expire_minutes)
    access_token = create_access_token(
        data={"sub": user["username"], "user_id": user["id"], "scopes": user["scopes"]},
        expires_delta=access_token_expires
    )
    
    refresh_token = create_refresh_token(
        data={"sub": user["username"], "user_id": user["id"], "scopes": user["scopes"]}
    )
    
    return Token(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.jwt_access_token_expire_minutes * 60
    )


@router.get("/me")
async def get_current_user_info(current_user: User = Depends(get_current_active_user)):
    """Get current user information"""
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "is_admin": current_user.is_admin,
        "scopes": current_user.scopes
    }