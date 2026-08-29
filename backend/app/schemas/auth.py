import uuid
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, ConfigDict

class GoogleLoginRequest(BaseModel):
    id_token: str
    invite_token: Optional[str] = None

class PasswordRegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=4, max_length=100)
    # The account's public handle, chosen by the person signing up. Optional at
    # the API level so an invitation flow that predates it still works; the
    # signup form asks for it.
    username: Optional[str] = Field(None, max_length=20)
    name: Optional[str] = None
    invite_token: Optional[str] = None

class PasswordLoginRequest(BaseModel):
    email: EmailStr
    password: str

class DevLoginRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    picture: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    username: Optional[str] = None
    is_admin: bool
    is_approved: bool
    is_active: bool
    # Write access to the shared workspace; managed instead of removing the
    # user from it, since for some users it is the only space they have.
    can_write_shared: bool = True
    storage_quota_bytes: int = 0  # 0B default (Admin assigns quota)
    storage_used_bytes: int = 0
    created_at: datetime
    last_login_at: datetime

    model_config = ConfigDict(from_attributes=True)

class UserApproveRequest(BaseModel):
    is_approved: bool

class UserAdminRequest(BaseModel):
    is_admin: bool

class UserQuotaRequest(BaseModel):
    storage_quota_bytes: int = Field(..., ge=0, description="Storage quota in bytes")
