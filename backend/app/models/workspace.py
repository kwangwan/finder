import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base


class Workspace(Base):
    __tablename__ = "kb_workspaces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    slug = Column(String(100), unique=True, index=True, nullable=False)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), nullable=False)
    icon = Column(String(50), default="briefcase", nullable=True)
    # The workspace auto-created for a user on first login (see
    # ensure_user_default_workspace). Every user always has exactly one of
    # these and it can't be deleted, so the app never has to render a
    # "no workspace selected" state — the frontend falls back to it whenever
    # the previously active workspace is missing or unset.
    is_default = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    owner = relationship("User", foreign_keys=[owner_id])
    members = relationship("WorkspaceMember", back_populates="workspace", cascade="all, delete-orphan")

    def to_dict(self, current_user_id=None):
        user_role = None
        if current_user_id and self.members:
            for m in self.members:
                if str(m.user_id) == str(current_user_id):
                    user_role = m.role
                    break
        if not user_role and current_user_id and str(self.owner_id) == str(current_user_id):
            user_role = "owner"

        return {
            "id": str(self.id),
            "name": self.name,
            "description": self.description,
            "slug": self.slug,
            "owner_id": str(self.owner_id),
            "owner_name": self.owner.name if self.owner else None,
            "owner_email": self.owner.email if self.owner else None,
            "icon": self.icon,
            "is_default": self.is_default,
            "member_count": len(self.members) if self.members else 0,
            "role": user_role,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }


class WorkspaceMember(Base):
    __tablename__ = "kb_workspace_members"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("kb_workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(50), default="member", nullable=False)  # 'owner', 'admin', 'member'
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="uq_workspace_user"),
    )

    # Relationships
    workspace = relationship("Workspace", back_populates="members")
    user = relationship("User", foreign_keys=[user_id])

    def to_dict(self):
        return {
            "id": str(self.id),
            "workspace_id": str(self.workspace_id),
            "user_id": str(self.user_id),
            "user_email": self.user.email if self.user else None,
            "user_name": self.user.name if self.user else None,
            "user_picture": self.user.picture if self.user else None,
            "role": self.role,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
