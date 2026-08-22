from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
import uuid

class NoteCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    folder_id: Optional[uuid.UUID] = None
    workspace_id: Optional[uuid.UUID] = None
    content: str = ""
    tags: List[str] = []

class NoteUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    folder_id: Optional[uuid.UUID] = None
    workspace_id: Optional[uuid.UUID] = None
    content: Optional[str] = None
    tags: Optional[List[str]] = None
    is_favorite: Optional[bool] = None

class FileMetadataCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    folder_id: Optional[uuid.UUID] = None
    workspace_id: Optional[uuid.UUID] = None
    file_type: str = "other"
    mime_type: Optional[str] = None
    size_bytes: int = 0
    s3_key: str
    content: Optional[str] = None
    is_markdown: bool = False
    tags: List[str] = []

class FileMoveRequest(BaseModel):
    folder_id: Optional[uuid.UUID] = None

class BatchMoveRequest(BaseModel):
    workspace_id: uuid.UUID
    file_ids: List[uuid.UUID]
    folder_id: Optional[uuid.UUID] = None

class FileRenameRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)

class FileResponse(BaseModel):
    id: uuid.UUID
    folder_id: Optional[uuid.UUID] = None
    workspace_id: Optional[uuid.UUID] = None
    created_by: Optional[uuid.UUID] = None
    creator_name: Optional[str] = None
    last_edited_by: Optional[uuid.UUID] = None
    last_editor_name: Optional[str] = None
    name: str
    file_type: str
    mime_type: Optional[str] = None
    size_bytes: int
    s3_key: Optional[str] = None
    thumbnail_s3_key: Optional[str] = None
    thumbnail_url: Optional[str] = None
    is_markdown: bool
    is_embedded: bool = False
    embedded_chunks_count: int = 0
    is_favorite: bool
    is_trashed: bool = False
    trashed_at: Optional[datetime] = None
    tags: List[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class FileDetailResponse(FileResponse):
    content: Optional[str] = None
    folder_name: Optional[str] = None
    download_url: Optional[str] = None

class PagedFileResponse(BaseModel):
    items: List[FileResponse]
    total_count: int
    page: int
    page_size: int
    total_pages: int

class FileVersionResponse(BaseModel):
    id: uuid.UUID
    file_id: uuid.UUID
    name: Optional[str] = None
    edited_by: Optional[uuid.UUID] = None
    editor_name: Optional[str] = None
    created_at: datetime
    is_open: bool = False

    model_config = ConfigDict(from_attributes=True)

class FileVersionDetailResponse(FileVersionResponse):
    content: str

class BatchDownloadRequest(BaseModel):
    workspace_id: uuid.UUID
    file_ids: List[uuid.UUID] = []
    folder_ids: List[uuid.UUID] = []
    archive_name: Optional[str] = "download_archive.zip"


