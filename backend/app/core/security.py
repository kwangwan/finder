import uuid
import bcrypt
from datetime import datetime, timedelta
from typing import Optional
from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User

security_scheme = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    """Hash plain password using bcrypt."""
    pw_bytes = password.encode("utf-8")[:72]  # bcrypt max 72 bytes
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(pw_bytes, salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain password against bcrypt hash."""
    if not hashed_password:
        return False
    try:
        pw_bytes = plain_password.encode("utf-8")[:72]
        return bcrypt.checkpw(pw_bytes, hashed_password.encode("utf-8"))
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Generate JWT Access Token."""
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

MEDIA_TOKEN_EXPIRE_MINUTES = 15

def create_media_access_token(user_id: str) -> str:
    """
    Short-lived, purpose-scoped token for URLs that browser tags (<img>, <video>,
    <a>) hit directly and can't attach an Authorization header to (preview/
    thumbnail/download). Kept separate from the full session token so a token
    leaked via browser history, server access logs, or a Referer header is only
    usable for media endpoints and only for a few minutes, not full API access
    for the session's remaining lifetime.
    """
    return create_access_token({"sub": user_id, "scope": "media"}, expires_delta=timedelta(minutes=MEDIA_TOKEN_EXPIRE_MINUTES))

def decode_access_token(token: str) -> Optional[dict]:
    """Decode and validate JWT Access Token."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        return None

def verify_google_token(token_str: str) -> Optional[dict]:
    """Verify Google OAuth IdToken."""
    try:
        audience = settings.GOOGLE_CLIENT_ID if settings.GOOGLE_CLIENT_ID else None
        id_info = id_token.verify_oauth2_token(token_str, google_requests.Request(), audience)
        return {
            "google_id": id_info.get("sub"),
            "email": id_info.get("email"),
            "name": id_info.get("name"),
            "picture": id_info.get("picture"),
        }
    except Exception as e:
        print(f"[Google Auth Warning] IdToken verification failed: {e}")
        return None

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Authenticate current user from Bearer JWT token."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(credentials.credentials)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # A media-scoped token (see create_media_access_token) is only ever meant to
    # authenticate the ?token= query-string path on preview/thumbnail/download
    # URLs. Without this check it would work as a fully general session token
    # everywhere else too as long as it's passed via the header instead, which
    # defeats the point of scoping it down in the first place.
    if payload.get("scope") == "media":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Media token cannot be used as a session token")

    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user ID format")

    user = await db.get(User, user_uuid)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User account inactive or not found")

    return user

async def get_current_approved_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """Ensure the user is approved by an administrator, or is an administrator."""
    if current_user.is_superadmin or current_user.is_approved:
        return current_user

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="가입 승인 대기 중입니다. 관리자의 승인 후 이용하실 수 있습니다.",
        headers={"X-Auth-Status": "PENDING_APPROVAL"}
    )

async def get_current_admin_user(
    current_user: User = Depends(get_current_user)
) -> User:
    """Ensure the user has administrator privileges (is_superadmin == True)."""
    if not current_user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다."
        )
    return current_user

async def get_current_approved_user_query_or_header(
    token: Optional[str] = None,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    db: AsyncSession = Depends(get_db)
) -> User:
    """
    Authenticate user from query parameter ?token= or Authorization header.
    A query-string token must be a short-lived media-scoped token (see
    create_media_access_token) — a full session token is only accepted via the
    Authorization header, so one leaking out of a media URL can't be used to
    call the rest of the API for the session's full lifetime.
    """
    if credentials:
        raw_token = credentials.credentials
        require_media_scope = False
    elif token:
        raw_token = token
        require_media_scope = True
    else:
        raw_token = None
        require_media_scope = False

    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(raw_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if require_media_scope and payload.get("scope") != "media":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이 URL에는 media-scoped 토큰만 사용할 수 있습니다.",
        )

    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    try:
        user_uuid = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user ID format")

    user = await db.get(User, user_uuid)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User account inactive or not found")

    if not (user.is_superadmin or user.is_approved):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="가입 승인 대기 중입니다. 관리자의 승인 후 이용하실 수 있습니다.",
            headers={"X-Auth-Status": "PENDING_APPROVAL"}
        )

    return user

