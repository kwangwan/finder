import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base

class FileVersion(Base):
    """A past snapshot of a note's content, kept for version history.

    Deliberately has no relationship to DocumentChunk/embeddings — past
    snapshots are never indexed or searched, only the file's current
    `content` is (see document_service.index_file_chunks).

    `is_open` marks the one row (per file, at most) that's still tracking an
    ongoing editing session: while a session continues, autosave rolls this
    same row forward in place (UPDATE, not INSERT) instead of creating a new
    row every few minutes — otherwise one long continuous sitting would leave
    many near-duplicate rows cluttering the history list. It's finalized
    (`is_open = False`) once the session actually ends (the editor's idle
    checkpoint, a tab close, or a version restore), at which point it becomes
    a permanent, no-longer-touched history entry and the next edit starts a
    fresh open row."""
    __tablename__ = "kb_file_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_id = Column(UUID(as_uuid=True), ForeignKey("kb_files.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=True)  # the note's title at snapshot time
    content = Column(Text, nullable=False)
    edited_by = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    is_open = Column(Boolean, default=False, nullable=False)

    def to_dict(self, include_content: bool = True):
        data = {
            "id": str(self.id),
            "file_id": str(self.file_id),
            "name": self.name,
            "edited_by": str(self.edited_by) if self.edited_by else None,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "is_open": self.is_open,
        }
        if include_content:
            data["content"] = self.content
        return data
