import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, JSON, DateTime, Date, BigInteger, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class AppSetting(Base):
    """
    Small key/value store for policy an administrator can change at runtime.

    Deliberately not environment variables: these are decisions the person
    running the service makes from the dashboard while it is live (how much a
    user may upload in a day, what to refuse, when to warn), and a redeploy is
    the wrong unit of change for them.
    """
    __tablename__ = "kb_app_settings"

    key = Column(String(128), primary_key=True)
    value = Column(JSON, nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc), nullable=False)


class SharedDailyUsage(Base):
    """
    How many bytes a user has added to the shared workspace on a given day.

    Kept as its own ledger rather than summed from the files that exist,
    because a rate limit has to count what was uploaded, not what was kept —
    otherwise uploading and deleting in a loop costs nothing and the limit
    means nothing.
    """
    __tablename__ = "kb_shared_daily_usage"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), nullable=False)
    usage_date = Column(Date, nullable=False)
    bytes_used = Column(BigInteger, default=0, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "usage_date", name="uq_shared_daily_usage_user_date"),
        Index("ix_shared_daily_usage_date", "usage_date"),
    )
