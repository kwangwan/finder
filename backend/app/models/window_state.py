import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class UserWindowState(Base):
    """
    The taskbar's open-window list, per user, so it survives a reload and
    follows the user between browsers.

    Only *which* files are open and whether each is minimized live here.
    Geometry (position, size, z-order) is deliberately excluded: it is a
    property of the screen the window was arranged on, and replaying one
    browser's coordinates in another — a laptop's layout onto a phone, say —
    would drop windows off-viewport. The receiving client lays the restored
    windows out with its own cascade logic instead.

    One row per user, keyed by user_id, updated in place. updated_at is what
    lets a polling client tell whether the server has something newer than
    what it last wrote.
    """
    __tablename__ = "kb_user_window_state"

    user_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), primary_key=True)
    # [{ "file_id": "...", "is_minimized": bool }, ...] in taskbar order.
    windows = Column(JSON, default=list, nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
