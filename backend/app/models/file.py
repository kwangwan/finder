import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, BigInteger, Boolean, Text, DateTime, ForeignKey, JSON, Float, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import event, inspect
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

    # Capture metadata read out of the media file itself (EXIF for photos,
    # the MP4/MOV moov atom for video) — distinct from created_at, which is
    # only when the file was uploaded here. Kept as real columns rather than
    # a JSON blob so they stay queryable (sorting or filtering by when a
    # photo was actually taken is the obvious next thing to want).
    taken_at = Column(DateTime(timezone=True), nullable=True)
    gps_latitude = Column(Float, nullable=True)
    gps_longitude = Column(Float, nullable=True)
    camera_make = Column(String(128), nullable=True)
    camera_model = Column(String(128), nullable=True)
    media_width = Column(Integer, nullable=True)
    media_height = Column(Integer, nullable=True)
    # When extraction last ran. Set even when nothing was found, so the
    # backfill can tell "not attempted yet" from "attempted, this file simply
    # has no metadata" (screenshots never do) and never re-reads it forever.
    media_scanned_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    # When this file last changed in a way a *listing* of it shows: it was
    # added, renamed, moved, thrown away or restored. `updated_at` cannot
    # answer that — a document's autosave moves it every second the author is
    # typing, and telling everyone else looking at the folder that they are
    # out of date because somebody is writing is noise, not news. Maintained
    # by the mapper hook below rather than by each write path, so a new write
    # path cannot forget it. Read by files.py's watermark endpoint.
    listing_updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=True)

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


# What a listing shows about a file. A change to one of these is worth telling
# other people looking at the same folder about; a change to anything else
# (content, size, embedding state, thumbnail) is not.
LISTING_FIELDS = ("name", "file_type", "folder_id", "workspace_id", "is_trashed")


@event.listens_for(FileItem, "before_update")
def _touch_listing_updated_at(mapper, connection, target):
    state = inspect(target)
    for field in LISTING_FIELDS:
        if state.attrs[field].history.has_changes():
            target.listing_updated_at = datetime.now(timezone.utc)
            return
