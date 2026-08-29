import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Boolean, DateTime, Integer, BigInteger, Text, JSON, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class CopyJob(Base):
    """
    A queued copy/move of already-stored files and folders.

    Copying duplicates every object in the selected subtree, which for a large
    folder is far too long to hold a request open for — and tying it to a
    request means closing the tab abandons the work halfway, leaving a
    partially-copied tree behind. The request instead records the intent here
    and returns; a single background worker drains the queue in order, so the
    browser can be closed the moment the job is accepted.

    Progress is written back onto the row as it goes, so a client that comes
    back later sees where the job got to rather than only whether it finished.
    """
    __tablename__ = "kb_copy_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="CASCADE"), nullable=False, index=True)

    source_workspace_id = Column(UUID(as_uuid=True), nullable=True)
    target_workspace_id = Column(UUID(as_uuid=True), nullable=True)
    target_folder_id = Column(UUID(as_uuid=True), nullable=True)
    file_ids = Column(JSON, default=list, nullable=False)
    folder_ids = Column(JSON, default=list, nullable=False)
    # A cross-workspace move: copy, then send the originals to the trash.
    trash_source = Column(Boolean, default=False, nullable=False)

    # pending -> running -> done | failed
    status = Column(String(32), default="pending", nullable=False, index=True)
    # Filled in when the job is accepted, so progress can be shown as a
    # fraction from the first tick rather than only once the work is finished.
    total_files = Column(Integer, default=0, nullable=False)
    total_bytes = Column(BigInteger, default=0, nullable=False)
    copied_files = Column(Integer, default=0, nullable=False)
    copied_folders = Column(Integer, default=0, nullable=False)
    copied_bytes = Column(BigInteger, default=0, nullable=False)
    skipped = Column(Integer, default=0, nullable=False)
    skipped_cycles = Column(Integer, default=0, nullable=False)
    trashed_files = Column(Integer, default=0, nullable=False)
    trashed_folders = Column(Integer, default=0, nullable=False)
    error_message = Column(Text, nullable=True)

    # A label for the UI, captured at enqueue time — the source items may be
    # renamed or gone by the time anyone reads the job back.
    summary = Column(String(512), nullable=True)

    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)


# The worker's own claim query: oldest pending job first.
Index("ix_copy_jobs_status_created", CopyJob.status, CopyJob.created_at)
