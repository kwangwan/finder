from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime
import uuid

class CreateInvitationRequest(BaseModel):
    email: EmailStr
    workspace_id: Optional[uuid.UUID] = None
    role: str = "member"  # 'admin' or 'member'

class AcceptInvitationRequest(BaseModel):
    token: str
    name: Optional[str] = None
    password: Optional[str] = None  # If registering with password

class InvitationResponse(BaseModel):
    id: uuid.UUID
    email: str
    token: str
    workspace_id: Optional[uuid.UUID] = None
    workspace_name: Optional[str] = None
    role: str
    invited_by: uuid.UUID
    inviter_name: Optional[str] = None
    inviter_email: Optional[str] = None
    is_admin_invite: bool
    expires_at: datetime
    is_expired: bool
    status: str
    created_at: datetime
