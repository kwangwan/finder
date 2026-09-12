import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base

class Invitation(Base):
    __tablename__ = "kb_invitations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), index=True, nullable=False)
    token = Column(String(128), unique=True, index=True, nullable=False)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("kb_workspaces.id", ondelete="CASCADE"), nullable=True)
    role = Column(String(50), default="member", nullable=False)  # 'admin' or 'member'
    invited_by = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), nullable=False)
    is_admin_invite = Column(Boolean, default=False, nullable=False)  # If true, auto-approves user account on accept
    expires_at = Column(DateTime(timezone=True), nullable=False)  # 7 days from creation
    status = Column(String(50), default="pending", nullable=False)  # 'pending', 'accepted', 'expired', 'cancelled'
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    inviter = relationship("User", foreign_keys=[invited_by])
    workspace = relationship("Workspace", foreign_keys=[workspace_id])

    @property
    def is_expired(self) -> bool:
        expires_at = self.expires_at
        if expires_at is None:
            # An invitation with no end is not something this app makes; if one
            # exists, it is not honoured.
            return True
        if expires_at.tzinfo is None:
            # The column is timestamptz, so this only happens for a value that
            # has not been through the database yet. UTC is what everything
            # here means by a bare timestamp.
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > expires_at

    def to_dict(self):
        return {
            "id": str(self.id),
            "email": self.email,
            "token": self.token,
            "workspace_id": str(self.workspace_id) if self.workspace_id else None,
            "workspace_name": self.workspace.name if self.workspace else None,
            "role": self.role,
            "invited_by": str(self.invited_by),
            "inviter_name": self.inviter.name if self.inviter else None,
            "inviter_email": self.inviter.email if self.inviter else None,
            "is_admin_invite": self.is_admin_invite,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "is_expired": self.is_expired,
            "status": "expired" if (self.status == "pending" and self.is_expired) else self.status,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
