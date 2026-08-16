from pydantic import BaseModel, Field
from typing import Optional, List
import uuid

class StorageConfigResponse(BaseModel):
    max_chunk_size_mb: int
    chunk_size_bytes: int
    public_url: str

class PresignedUploadRequest(BaseModel):
    filename: str
    folder_id: Optional[uuid.UUID] = None
    content_type: str = "application/octet-stream"
    size_bytes: int

class PresignedUploadResponse(BaseModel):
    upload_url: str
    s3_key: str
    method: str = "PUT"
    headers: dict = {}

class PresignedDownloadResponse(BaseModel):
    download_url: str
    filename: str
    expires_in: int

class MultipartInitRequest(BaseModel):
    filename: str
    workspace_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    content_type: str = "application/octet-stream"
    size_bytes: int

class MultipartInitResponse(BaseModel):
    upload_id: str
    s3_key: str
    chunk_size_mb: int
    chunk_size_bytes: int
    total_parts: int

class MultipartPartUrlsRequest(BaseModel):
    s3_key: str
    upload_id: str
    part_numbers: List[int]

class PartUrlItem(BaseModel):
    part_number: int
    upload_url: str

class MultipartPartUrlsResponse(BaseModel):
    parts: List[PartUrlItem]

class CompletedPartItem(BaseModel):
    PartNumber: int
    ETag: str

class MultipartCompleteRequest(BaseModel):
    s3_key: str
    upload_id: str
    parts: List[CompletedPartItem]
    filename: str
    workspace_id: Optional[uuid.UUID] = None
    folder_id: Optional[uuid.UUID] = None
    file_type: str = "other"
    mime_type: Optional[str] = None
    size_bytes: int

class MultipartAbortRequest(BaseModel):
    s3_key: str
    upload_id: str
