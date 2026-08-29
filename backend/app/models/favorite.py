import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class Favorite(Base):
    """
    One person's shortcut to a folder or a file.

    Per user, not per workspace or per item. A favourite says "this is what I
    am working on", which is a fact about the person, not about the thing —
    two people in the same workspace have different working sets. It matters
    most in the shared workspace, where every registered user sees the same
    space: an item-level flag there would mean one person's shortcut list is
    everybody's, and anyone could clear anyone else's.

    `target_id` deliberately carries no foreign key, because it points at
    either table. A favourite whose target is gone is filtered out on read and
    cleaned up when the target is permanently deleted.
    """

    __tablename__ = "kb_favorites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Kept alongside the target so the list can be scoped to one workspace
    # without joining out to the target's table first.
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("kb_workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    target_type = Column(String(10), nullable=False)   # 'folder' | 'file'
    target_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "target_type", "target_id", name="uq_favorite_user_target"),
        Index("ix_favorite_user_ws", "user_id", "workspace_id"),
    )
