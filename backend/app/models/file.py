import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, BigInteger, Boolean, Text, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base

class FileItem(Base):
    __tablename__ = "kb_files"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    folder_id = Column(UUID(as_uuid=True), ForeignKey("kb_folders.id", ondelete="SET NULL"), nullable=True)
    workspace_id = Column(UUID(as_uuid=True), ForeignKey("kb_workspaces.id", ondelete="CASCADE"), nullable=True, index=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="SET NULL"), nullable=True)
    last_edited_by = Column(UUID(as_uuid=True), ForeignKey("kb_users.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False, default="other")  # note, pdf, docx, xlsx, text, image, video, audio, code, other
    mime_type = Column(String(100), nullable=True)
    size_bytes = Column(BigInteger, default=0, nullable=False)
    s3_key = Column(String(1024), nullable=True)  # MinIO storage key
    thumbnail_s3_key = Column(String(1024), nullable=True)  # MinIO thumbnail key
    content = Column(Text, nullable=True)  # Text content for markdown notes / parsed text
    is_markdown = Column(Boolean, default=False, nullable=False)
    is_embedded = Column(Boolean, default=False, nullable=False)  # Embedding completed flag
    embedded_chunks_count = Column(BigInteger, default=0, nullable=False)
    is_favorite = Column(Boolean, default=False, nullable=False)
    is_trashed = Column(Boolean, default=False, nullable=False, index=True)
    trashed_at = Column(DateTime(timezone=True), nullable=True)
    tags = Column(JSON, default=list, nullable=False)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)

    # Relationships
    folder = relationship("Folder", back_populates="files")
    workspace = relationship("Workspace", foreign_keys=[workspace_id])
    creator = relationship("User", foreign_keys=[created_by])
    last_editor = relationship("User", foreign_keys=[last_edited_by])
    chunks = relationship("DocumentChunk", back_populates="file", cascade="all, delete-orphan")

    def to_dict(self, include_content: bool = True):
        data = {
            "id": str(self.id),
            "folder_id": str(self.folder_id) if self.folder_id else None,
            "workspace_id": str(self.workspace_id) if self.workspace_id else None,
            "created_by": str(self.created_by) if self.created_by else None,
            "last_edited_by": str(self.last_edited_by) if self.last_edited_by else None,
            "name": self.name,
            "file_type": self.file_type,
            "mime_type": self.mime_type,
            "size_bytes": self.size_bytes,
            "s3_key": self.s3_key,
            "thumbnail_s3_key": self.thumbnail_s3_key,
            "is_markdown": self.is_markdown,
            "is_embedded": self.is_embedded,
            "embedded_chunks_count": self.embedded_chunks_count,
            "is_favorite": self.is_favorite,
            "is_trashed": self.is_trashed,
            "trashed_at": self.trashed_at.isoformat() if self.trashed_at else None,
            "tags": self.tags or [],
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_content:
            data["content"] = self.content
        return data
