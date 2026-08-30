import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class FileLink(Base):
    """
    A document refers to a file.

    Attaching a file to a document used to leave no trace anywhere except a
    URL inside the document's markdown, so nothing could answer "what is this
    file used by" — and deleting a file quietly broke every document holding
    it. This is that relationship written down, kept in step with the
    document's content on every save (see link_service.sync_document_links).

    Only the referring direction is stored. Whether the file still exists, and
    whether it is in the trash, is read from the file itself, so restoring
    from the trash restores the attachment with nothing else to undo.
    """

    __tablename__ = "kb_file_links"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # The document doing the referring. CASCADE: the links are part of it.
    document_id = Column(UUID(as_uuid=True), ForeignKey("kb_files.id", ondelete="CASCADE"), nullable=False, index=True)
    # The file being referred to. CASCADE as well: a link to a row that is
    # gone for good is not worth keeping — "the file was deleted" is told by
    # the document's content still naming it, not by a dangling row.
    target_file_id = Column(UUID(as_uuid=True), ForeignKey("kb_files.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)

    __table_args__ = (
        UniqueConstraint("document_id", "target_file_id", name="uq_file_link"),
        Index("ix_file_link_target", "target_file_id", "document_id"),
    )
