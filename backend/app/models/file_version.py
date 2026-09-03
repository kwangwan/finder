import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Text, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base

class FileVersion(Base):
    """A past snapshot of a note's content, kept for version history.

    Deliberately has no relationship to DocumentChunk/embeddings — past
    snapshots are never indexed or searched, only the file's current
    `content` is (see document_service.index_file_chunks).

    `period_start` is the half hour this row stands for: every save inside
    that window overwrites this same row, so it always holds the document as
    it stood at the end of that half hour and a long sitting leaves one entry
    per half hour rather than one per keystroke-burst. A row with no period
    (NULL) is a one-off snapshot that nothing overwrites — what a restore
    replaced, or an entry made before history was divided by the clock."""

    __tablename__ = "kb_file_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_id = Column(UUID(as_uuid=True), ForeignKey("kb_files.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=True)  # the note's title at snapshot time
    content = Column(Text, nullable=False)
    edited_by = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    period_start = Column(DateTime(timezone=True), nullable=True, index=True)

    def to_dict(self, include_content: bool = True):
        data = {
            "id": str(self.id),
            "file_id": str(self.file_id),
            "name": self.name,
            "edited_by": str(self.edited_by) if self.edited_by else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
        if include_content:
            data["content"] = self.content
        return data
