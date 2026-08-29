import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class FolderWriteGrant(Base):
    """
    Write access one person has given another inside their personal folder.

    Collaboration in the shared workspace is granted by the folder's owner
    rather than by an administrator: the owner is the only one who knows who
    should be working on their material, and routing every request through an
    administrator would make sharing something you ask permission for.
    """
    __tablename__ = "kb_folder_write_grants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    folder_id = Column(UUID(as_uuid=True), ForeignKey("kb_folders.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), nullable=False, index=True)
    granted_by = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint("folder_id", "user_id", name="uq_folder_write_grant"),
    )


class ContentReport(Base):
    """
    A report that something in a shared space does not belong there.

    Kept as a queue an administrator works through rather than an action that
    removes content on its own: reporting has to be easy enough that people
    actually use it, which means it cannot be trusted to delete anything by
    itself.
    """
    __tablename__ = "kb_content_reports"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_id = Column(UUID(as_uuid=True), ForeignKey("kb_files.id", ondelete="CASCADE"), nullable=False, index=True)
    reporter_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="SET NULL"), nullable=True)
    reason = Column(String(64), nullable=False)          # a fixed category
    detail = Column(Text, nullable=True)                 # optional free text

    # pending -> resolved | dismissed
    status = Column(String(32), default="pending", nullable=False, index=True)
    resolution = Column(String(64), nullable=True)       # what the admin did
    resolved_by = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="SET NULL"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    admin_note = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)

    __table_args__ = (
        Index("ix_reports_status_created", "status", "created_at"),
    )
