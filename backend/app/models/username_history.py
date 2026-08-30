import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class UsernameHistory(Base):
    """
    Every handle an account has held, and when.

    A handle is how work is attributed — "@jhkim uploaded this" — so letting it
    change silently would let the record of who did what change with it. Kept
    as a row per handle: when it was taken, and when it was given up. What the
    file listing shows is still the current one; this is how anybody can ask
    what it used to be.

    It is also what makes a released handle safe to hand on: nobody else may
    take it until the reservation window has passed, so an old attribution
    cannot quietly start pointing at a different person.
    """

    __tablename__ = "kb_username_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), nullable=False, index=True)
    username = Column(String(20), nullable=False, index=True)
    taken_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    # Null while this is the account's current handle.
    released_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_username_history_user_time", "user_id", "taken_at"),
        Index("ix_username_history_name_released", "username", "released_at"),
    )
