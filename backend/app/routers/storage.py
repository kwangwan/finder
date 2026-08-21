import uuid
import math
import urllib.parse
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header, Response, UploadFile, File, Form, status
from sqlalchemy.ext.asyncio import AsyncSession

import os
import shutil
from pathlib import Path
from app.core.config import settings
from app.core.database import get_db
from app.models import FileItem, User, Folder
from app.core.security import get_current_approved_user, get_current_approved_user_query_or_header
from app.schemas.storage import (
    StorageConfigResponse, PresignedUploadRequest, PresignedUploadResponse,
    PresignedDownloadResponse, MultipartInitRequest, MultipartInitResponse,
    MultipartPartUrlsRequest, MultipartPartUrlsResponse, MultipartCompleteRequest,
    MultipartAbortRequest, ChunkInitRequest, ChunkInitResponse,
    ChunkCompleteRequest, ChunkAbortRequest
)
from app.schemas.file import FileResponse
from app.services.s3_service import s3_service, sanitize_filename, build_storage_key
from app.services.document_service import document_service
from app.services.thumbnail_service import thumbnail_service
from app.services.access_service import access_service
from app.services.quota_service import quota_service
from app.services.svg_sanitizer import sanitize_svg

router = APIRouter(prefix="/api/storage", tags=["Storage & Uploads"])

@router.get("/config", response_model=StorageConfigResponse)
async def get_storage_config(
    current_user: User = Depends(get_current_approved_user)
):
    """Return storage chunking configuration (MINIO_MAX_CHUNK_SIZE_MB)."""
    chunk_mb = settings.MINIO_MAX_CHUNK_SIZE_MB
    return StorageConfigResponse(
        max_chunk_size_mb=chunk_mb,
        chunk_size_bytes=chunk_mb * 1024 * 1024,
        public_url=settings.MINIO_PUBLIC_URL
    )

@router.post("/presigned-upload", response_model=PresignedUploadResponse)
async def get_presigned_upload_url(
    req: PresignedUploadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Generate a single presigned PUT URL for files smaller than chunk size."""
    # Storage quota check on workspace owner
    workspace_id = None
    if req.folder_id:
        folder = await db.get(Folder, req.folder_id)
        if folder:
            workspace_id = folder.workspace_id
    await quota_service.check_quota(db, workspace_id, current_user, req.size_bytes)

    file_uuid = uuid.uuid4()
    s3_key = build_storage_key("uploads", file_uuid, req.filename)

    try:
        url = s3_service.generate_presigned_put_url(
            s3_key=s3_key,
            content_type=req.content_type
        )
        return PresignedUploadResponse(
            upload_url=url,
            s3_key=s3_key,
            method="PUT",
            headers={"Content-Type": req.content_type}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate presigned upload URL: {str(e)}")

@router.get("/presigned-download/{file_id}", response_model=PresignedDownloadResponse)
async def get_presigned_download_url(
    file_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Generate a presigned GET URL for downloading or viewing a file."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 다운로드 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.s3_key:
        raise HTTPException(status_code=404, detail="File or storage key not found")

    try:
        url = s3_service.generate_presigned_get_url(
            s3_key=file_item.s3_key,
            filename=file_item.name,
            expires_in=3600
        )
        return PresignedDownloadResponse(
            download_url=url,
            filename=file_item.name,
            expires_in=3600
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate download URL: {str(e)}")

@router.get("/chunk-download/{file_id}")
async def download_file_chunk(
    file_id: uuid.UUID,
    range: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """
    Download a byte range of a file (Chunked Range Download).
    Allows downloading massive files through Cloudflare Zero Trust by splitting into 50MB range chunks.
    """
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 다운로드 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.s3_key:
        raise HTTPException(status_code=404, detail="File not found")

    range_header = range or f"bytes=0-{file_item.size_bytes - 1}"
    res = s3_service.get_object_range(file_item.s3_key, range_header)
    
    if not res:
        raise HTTPException(status_code=500, detail="Failed to fetch byte chunk from storage")

    safe_name = urllib.parse.quote(file_item.name)
    headers = {
        "Content-Range": res["content_range"] or f"bytes 0-{len(res['body'])-1}/{file_item.size_bytes}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(len(res["body"])),
        "Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}",
        "Content-Type": res["content_type"],
    }

    return Response(
        content=res["body"],
        status_code=status.HTTP_206_PARTIAL_CONTENT if range else status.HTTP_200_OK,
        headers=headers,
        media_type=res["content_type"]
    )

@router.post("/multipart/initiate", response_model=MultipartInitResponse)
async def initiate_multipart_upload(
    req: MultipartInitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Initiate S3 multipart upload for large files based on MINIO_MAX_CHUNK_SIZE_MB."""
    workspace_id = req.workspace_id
    if not workspace_id and req.folder_id:
        folder = await db.get(Folder, req.folder_id)
        if folder:
            workspace_id = folder.workspace_id
    await quota_service.check_quota(db, workspace_id, current_user, req.size_bytes)

    file_uuid = uuid.uuid4()
    s3_key = build_storage_key("uploads", file_uuid, req.filename)
    
    chunk_bytes = settings.MINIO_MAX_CHUNK_SIZE_MB * 1024 * 1024
    total_parts = math.ceil(req.size_bytes / chunk_bytes) if req.size_bytes > 0 else 1

    try:
        upload_id = s3_service.create_multipart_upload(
            s3_key=s3_key,
            content_type=req.content_type
        )
        return MultipartInitResponse(
            upload_id=upload_id,
            s3_key=s3_key,
            chunk_size_mb=settings.MINIO_MAX_CHUNK_SIZE_MB,
            chunk_size_bytes=chunk_bytes,
            total_parts=total_parts
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initiate multipart upload: {str(e)}")

@router.post("/multipart/part-urls", response_model=MultipartPartUrlsResponse)
async def get_multipart_part_urls(
    req: MultipartPartUrlsRequest,
    current_user: User = Depends(get_current_approved_user)
):
    """Generate presigned PUT URLs for each requested part number."""
    try:
        parts = s3_service.generate_multipart_presigned_urls(
            s3_key=req.s3_key,
            upload_id=req.upload_id,
            part_numbers=req.part_numbers
        )
        return MultipartPartUrlsResponse(parts=parts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate part URLs: {str(e)}")

@router.post("/multipart/complete", response_model=FileResponse)
async def complete_multipart_upload(
    req: MultipartCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Complete S3 multipart upload and save file metadata in PostgreSQL."""
    try:
        s3_service.complete_multipart_upload(
            s3_key=req.s3_key,
            upload_id=req.upload_id,
            parts=[p.dict() for p in req.parts]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to complete multipart upload on S3: {str(e)}")

    # Detect file type
    name_lower = req.filename.lower()
    file_type = req.file_type or "other"
    is_markdown = False
    if name_lower.endswith(".md"):
        file_type = "markdown"
        is_markdown = True
    elif name_lower.endswith(".pdf"):
        file_type = "pdf"
    elif name_lower.endswith((".docx", ".doc")):
        file_type = "docx"
    elif name_lower.endswith((".xlsx", ".xls")):
        file_type = "xlsx"
    elif name_lower.endswith((".txt", ".json", ".csv", ".py", ".js", ".html", ".css", ".yaml", ".yml")):
        file_type = "text"
    elif name_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")):
        file_type = "image"
    elif name_lower.endswith((".zip", ".tar", ".gz", ".7z", ".rar")):
        file_type = "archive"

    workspace_id = req.workspace_id
    if req.folder_id:
        if not await access_service.can_access_folder(db, current_user, req.folder_id):
            raise HTTPException(status_code=403, detail="폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, req.folder_id)
        if folder:
            if workspace_id and folder.workspace_id and workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="지정한 폴더와 워크스페이스가 일치하지 않습니다.")
            if not workspace_id:
                workspace_id = folder.workspace_id

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")

    # Generate thumbnail for media files if applicable
    thumbnail_s3_key = None
    if file_type in ("image", "video"):
        try:
            # Download bytes from S3 (or range for video) to generate thumbnail
            media_bytes = s3_service.get_object_content(req.s3_key)
            if media_bytes:
                file_uuid = req.s3_key.split("/")[1] if "/" in req.s3_key else str(uuid.uuid4())
                thumbnail_s3_key = thumbnail_service.create_and_store_thumbnail(
                    file_uuid=file_uuid,
                    filename=req.filename,
                    file_bytes=media_bytes,
                    file_type=file_type
                )
        except Exception as thumb_err:
            print(f"[Thumbnail Warning] Multipart thumbnail generation failed: {thumb_err}")

    file_item = FileItem(
        folder_id=req.folder_id,
        workspace_id=workspace_id,
        created_by=current_user.id,
        name=req.filename,
        file_type=file_type,
        mime_type=req.mime_type,
        size_bytes=req.size_bytes,
        s3_key=req.s3_key,
        thumbnail_s3_key=thumbnail_s3_key,
        is_markdown=is_markdown
    )
    db.add(file_item)
    await db.commit()
    await db.refresh(file_item)

    # Update workspace owner storage usage
    await quota_service.record_storage_added(db, workspace_id, current_user, req.size_bytes or 0)

    # Index embeddings
    try:
        await document_service.index_file_chunks(db, file_item)
    except Exception as e:
        print(f"[Embedding Warning] Indexing failed for multipart file {file_item.id}: {e}")

    resp = FileResponse.model_validate(file_item)
    if file_item.thumbnail_s3_key:
        resp.thumbnail_url = f"/api/storage/thumbnail/{file_item.id}"
    return resp

@router.post("/multipart/abort")
async def abort_multipart_upload(
    req: MultipartAbortRequest,
    current_user: User = Depends(get_current_approved_user)
):
    """Abort multipart upload session."""
    s3_service.abort_multipart_upload(s3_key=req.s3_key, upload_id=req.upload_id)
    return {"status": "aborted"}

TEMP_CHUNKS_DIR = Path(__file__).resolve().parent.parent.parent / "storage_data" / "temp_chunks"
TEMP_CHUNKS_DIR.mkdir(parents=True, exist_ok=True)


def cleanup_stale_chunk_sessions(max_age_hours: int = 24) -> int:
    """Remove abandoned chunk-upload session directories (e.g. left behind when a
    browser tab is closed mid-upload) that have not received a new part in over
    max_age_hours. An active upload keeps writing parts, so its directory's newest
    file mtime stays recent and it is never touched by this cleanup."""
    import time
    removed = 0
    cutoff = time.time() - max_age_hours * 3600
    for session_dir in TEMP_CHUNKS_DIR.iterdir():
        if not session_dir.is_dir():
            continue
        try:
            newest_mtime = max(
                (p.stat().st_mtime for p in session_dir.rglob("*") if p.is_file()),
                default=session_dir.stat().st_mtime
            )
            if newest_mtime < cutoff:
                shutil.rmtree(session_dir, ignore_errors=True)
                removed += 1
        except Exception:
            pass
    return removed

@router.post("/chunk/init", response_model=ChunkInitResponse)
async def init_chunk_upload(
    req: ChunkInitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Initialize a proxy chunked upload session (5MB per chunk, 100% Cloudflare Tunnel safe)."""
    workspace_id = req.workspace_id
    if not workspace_id and req.folder_id:
        folder = await db.get(Folder, req.folder_id)
        if folder:
            workspace_id = folder.workspace_id
    await quota_service.check_quota(db, workspace_id, current_user, req.size_bytes)

    upload_id = str(uuid.uuid4())
    session_dir = TEMP_CHUNKS_DIR / upload_id
    session_dir.mkdir(parents=True, exist_ok=True)

    chunk_bytes = settings.MINIO_MAX_CHUNK_SIZE_MB * 1024 * 1024
    total_parts = math.ceil(req.size_bytes / chunk_bytes) if req.size_bytes > 0 else 1

    return ChunkInitResponse(
        upload_id=upload_id,
        chunk_size_mb=settings.MINIO_MAX_CHUNK_SIZE_MB,
        chunk_size_bytes=chunk_bytes,
        total_parts=total_parts
    )

@router.post("/chunk/part")
async def upload_chunk_part(
    upload_id: str = Form(...),
    part_number: int = Form(...),
    chunk: UploadFile = File(...),
    current_user: User = Depends(get_current_approved_user)
):
    """Save an individual chunk part (5MB) into temporary session storage."""
    session_dir = TEMP_CHUNKS_DIR / upload_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="Upload session expired or not found")

    part_file = session_dir / f"part_{part_number:05d}.bin"
    chunk_bytes = await chunk.read()

    with open(part_file, "wb") as f:
        f.write(chunk_bytes)

    return {"upload_id": upload_id, "part_number": part_number, "bytes_received": len(chunk_bytes)}

@router.post("/chunk/complete", response_model=FileResponse)
async def complete_chunk_upload(
    req: ChunkCompleteRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Merge all chunk parts, save file, generate thumbnail, and record in PostgreSQL."""
    session_dir = TEMP_CHUNKS_DIR / req.upload_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="Upload session not found")

    file_uuid = uuid.uuid4()
    s3_key = build_storage_key("uploads", file_uuid, req.filename)
    local_target_path = s3_service._get_local_path(s3_key)

    try:
        # Merge all part files in order
        with open(local_target_path, "wb") as out_f:
            for part_num in range(1, req.total_parts + 1):
                part_file = session_dir / f"part_{part_num:05d}.bin"
                if not part_file.exists():
                    raise HTTPException(status_code=400, detail=f"Missing chunk part {part_num}")
                with open(part_file, "rb") as in_f:
                    shutil.copyfileobj(in_f, out_f)

        # Cleanup temporary chunk parts
        shutil.rmtree(session_dir, ignore_errors=True)
    except Exception as merge_err:
        shutil.rmtree(session_dir, ignore_errors=True)
        if local_target_path.exists():
            local_target_path.unlink()
        raise HTTPException(status_code=500, detail=f"Failed to merge file chunks: {str(merge_err)}")

    # Detect file type
    name_lower = req.filename.lower()
    file_type = "other"
    is_markdown = False
    if name_lower.endswith(".md"):
        file_type = "markdown"
        is_markdown = True
    elif name_lower.endswith(".pdf"):
        file_type = "pdf"
    elif name_lower.endswith((".docx", ".doc")):
        file_type = "docx"
    elif name_lower.endswith((".xlsx", ".xls")):
        file_type = "xlsx"
    elif name_lower.endswith((".txt", ".json", ".csv", ".py", ".js", ".html", ".css", ".yaml", ".yml")):
        file_type = "text"
    elif name_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp")):
        file_type = "image"
    elif name_lower.endswith((".mp4", ".webm", ".mov", ".avi", ".mkv")):
        file_type = "video"
    elif name_lower.endswith((".mp3", ".wav", ".ogg", ".m4a", ".flac")):
        file_type = "audio"
    elif name_lower.endswith((".zip", ".tar", ".gz", ".7z", ".rar")):
        file_type = "archive"

    workspace_id = req.workspace_id
    if req.folder_id:
        if not await access_service.can_access_folder(db, current_user, req.folder_id):
            raise HTTPException(status_code=403, detail="폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, req.folder_id)
        if folder:
            if workspace_id and folder.workspace_id and workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="지정한 폴더와 워크스페이스가 일치하지 않습니다.")
            if not workspace_id:
                workspace_id = folder.workspace_id

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")

    # Generate thumbnail for media files
    thumbnail_s3_key = None
    if file_type in ("image", "video"):
        try:
            thumbnail_s3_key = thumbnail_service.create_and_store_thumbnail_from_path(
                file_uuid=str(file_uuid),
                filename=req.filename,
                file_path=str(local_target_path),
                file_type=file_type
            )
        except Exception as thumb_err:
            print(f"[Thumbnail Warning] Chunk thumbnail generation failed: {thumb_err}")

    # Read content for text/markdown
    content = None
    if is_markdown or file_type == "text":
        try:
            with open(local_target_path, "rb") as f:
                content_bytes = f.read()
            content = content_bytes.decode("utf-8", errors="ignore")
        except Exception:
            pass

    actual_size = local_target_path.stat().st_size if local_target_path.exists() else req.size_bytes
    mime_type = req.mime_type or get_media_mime_type(req.filename)

    # Stream upload merged file to MinIO S3
    if s3_service.client and local_target_path.exists():
        try:
            uploaded_to_s3 = s3_service.upload_file(
                s3_key=s3_key,
                local_path=str(local_target_path),
                content_type=mime_type
            )
            if uploaded_to_s3:
                # Successfully stored in MinIO! Delete local server disk copy to save disk space
                try:
                    local_target_path.unlink()
                except Exception as unl_err:
                    print(f"[Storage Warning] Could not delete local merged copy: {unl_err}")
        except Exception as upload_err:
            print(f"[MinIO Upload Error] Failed to upload chunked file to S3: {upload_err}")

    file_item = FileItem(
        folder_id=req.folder_id,
        workspace_id=workspace_id,
        created_by=current_user.id,
        name=req.filename,
        file_type=file_type,
        mime_type=mime_type,
        size_bytes=actual_size,
        s3_key=s3_key,
        thumbnail_s3_key=thumbnail_s3_key,
        content=content,
        is_markdown=is_markdown
    )
    db.add(file_item)
    await db.commit()
    await db.refresh(file_item)

    # Record quota
    await quota_service.record_storage_added(db, workspace_id, current_user, actual_size)

    # Index embeddings
    try:
        await document_service.index_file_chunks(db, file_item)
    except Exception as e:
        print(f"[Embedding Warning] Indexing failed for chunk file {file_item.id}: {e}")

    resp = FileResponse.model_validate(file_item)
    if file_item.thumbnail_s3_key:
        resp.thumbnail_url = f"/api/storage/thumbnail/{file_item.id}"
    return resp

@router.post("/chunk/abort")
async def abort_chunk_upload(
    req: ChunkAbortRequest,
    current_user: User = Depends(get_current_approved_user)
):
    """Abort proxy chunk upload and delete temporary chunk parts."""
    session_dir = TEMP_CHUNKS_DIR / req.upload_id
    if session_dir.exists():
        shutil.rmtree(session_dir, ignore_errors=True)
    return {"status": "aborted"}


@router.post("/direct-upload", response_model=FileResponse)
async def direct_upload(
    file: UploadFile = File(...),
    workspace_id: Optional[uuid.UUID] = Form(None),
    folder_id: Optional[uuid.UUID] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user)
):
    """Direct upload fallback route for smaller files or direct proxying."""
    file_bytes = await file.read()

    if folder_id:
        if not await access_service.can_access_folder(db, current_user, folder_id):
            raise HTTPException(status_code=403, detail="폴더에 접근할 권한이 없습니다.")
        folder = await db.get(Folder, folder_id)
        if folder:
            if workspace_id and folder.workspace_id and workspace_id != folder.workspace_id:
                raise HTTPException(status_code=400, detail="지정한 폴더와 워크스페이스가 일치하지 않습니다.")
            if not workspace_id:
                workspace_id = folder.workspace_id

    if workspace_id:
        if not await access_service.is_workspace_member(db, current_user, workspace_id):
            raise HTTPException(status_code=403, detail="이 워크스페이스에 접근할 권한이 없습니다.")

    # Storage quota check on workspace owner
    await quota_service.check_quota(db, workspace_id, current_user, len(file_bytes))
    file_uuid = uuid.uuid4()
    s3_key = build_storage_key("uploads", file_uuid, file.filename)
    
    try:
        s3_service.put_object(s3_key, file_bytes, file.content_type or "application/octet-stream")
    except Exception as e:
        print(f"[MinIO Warning] Direct upload to S3 failed: {e}")

    name_lower = file.filename.lower()
    is_markdown = name_lower.endswith(".md")
    file_type = "other"
    if is_markdown:
        file_type = "markdown"
    elif name_lower.endswith(".pdf"):
        file_type = "pdf"
    elif name_lower.endswith((".docx", ".doc")):
        file_type = "docx"
    elif name_lower.endswith((".xlsx", ".xls")):
        file_type = "xlsx"
    elif name_lower.endswith((".txt", ".json", ".csv", ".py", ".js", ".html", ".css", ".yaml", ".yml")):
        file_type = "text"
    elif name_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp")):
        file_type = "image"
    elif name_lower.endswith((".mp4", ".webm", ".mov", ".avi", ".mkv")):
        file_type = "video"
    elif name_lower.endswith((".zip", ".tar", ".gz", ".7z", ".rar")):
        file_type = "archive"

    content = None
    if is_markdown or file_type == "text":
        try:
            content = file_bytes.decode("utf-8")
        except Exception:
            pass

    # Generate thumbnail for media files
    thumbnail_s3_key = None
    if file_type in ("image", "video"):
        try:
            thumbnail_s3_key = thumbnail_service.create_and_store_thumbnail(
                file_uuid=str(file_uuid),
                filename=file.filename,
                file_bytes=file_bytes,
                file_type=file_type
            )
        except Exception as thumb_err:
            print(f"[Thumbnail Warning] Direct upload thumbnail failed: {thumb_err}")

    file_item = FileItem(
        folder_id=folder_id,
        workspace_id=workspace_id,
        created_by=current_user.id,
        name=file.filename,
        file_type=file_type,
        mime_type=file.content_type,
        size_bytes=len(file_bytes),
        s3_key=s3_key,
        thumbnail_s3_key=thumbnail_s3_key,
        content=content,
        is_markdown=is_markdown
    )
    db.add(file_item)
    await db.commit()
    await db.refresh(file_item)

    # Update workspace owner storage usage
    await quota_service.record_storage_added(db, workspace_id, current_user, len(file_bytes))

    try:
        await document_service.index_file_chunks(db, file_item, raw_bytes=file_bytes)
    except Exception as e:
        print(f"[Embedding Warning] Indexing failed for direct file {file_item.id}: {e}")

    resp = FileResponse.model_validate(file_item)
    if file_item.thumbnail_s3_key:
        resp.thumbnail_url = f"/api/storage/thumbnail/{file_item.id}"
    return resp

def get_media_mime_type(filename: str, stored_mime: Optional[str] = None) -> str:
    if stored_mime and stored_mime != "application/octet-stream":
        return stored_mime
    name_lower = filename.lower()
    if name_lower.endswith(".png"): return "image/png"
    if name_lower.endswith((".jpg", ".jpeg")): return "image/jpeg"
    if name_lower.endswith(".gif"): return "image/gif"
    if name_lower.endswith(".webp"): return "image/webp"
    if name_lower.endswith(".svg"): return "image/svg+xml"
    if name_lower.endswith(".mp4"): return "video/mp4"
    if name_lower.endswith(".webm"): return "video/webm"
    if name_lower.endswith(".mov"): return "video/quicktime"
    if name_lower.endswith(".pdf"): return "application/pdf"
    if name_lower.endswith(".md"): return "text/markdown; charset=utf-8"
    if name_lower.endswith(".txt"): return "text/plain; charset=utf-8"
    return stored_mime or "application/octet-stream"

@router.get("/preview/{file_id}")
async def preview_file(
    file_id: uuid.UUID,
    range: Optional[str] = Header(None),
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user_query_or_header)
):
    """Serve file inline for browser preview (images, videos with range seek, pdf, etc.)."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 접근 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.s3_key:
        raise HTTPException(status_code=404, detail="File or storage key not found")

    mime_type = get_media_mime_type(file_item.name, file_item.mime_type)
    safe_name = urllib.parse.quote(file_item.name)
    is_svg = mime_type == "image/svg+xml"

    # SVG is XML and can carry <script>/event-handler attributes that the browser
    # executes when rendered inline in the app's own origin. Never serve raw SVG
    # bytes inline — always sanitize first (small documents, so skip range-serving).
    if range and not is_svg:
        res = s3_service.get_object_range(file_item.s3_key, range)
        if res:
            headers = {
                "Content-Range": res["content_range"] or f"bytes 0-{len(res['body'])-1}/{file_item.size_bytes}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(res["body"])),
                "Content-Disposition": f"inline; filename*=UTF-8''{safe_name}",
                "Content-Type": mime_type,
                "Cache-Control": "public, max-age=3600"
            }
            return Response(
                content=res["body"],
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                headers=headers,
                media_type=mime_type
            )

    raw_bytes = s3_service.get_object_content(file_item.s3_key)
    if raw_bytes is None:
        raise HTTPException(status_code=404, detail="파일 데이터를 찾을 수 없습니다.")

    content_disposition = f"inline; filename*=UTF-8''{safe_name}"
    if is_svg:
        sanitized = sanitize_svg(raw_bytes)
        if sanitized is None:
            # Couldn't safely parse/sanitize it — fall back to a forced download
            # instead of ever rendering unsanitized SVG inline.
            content_disposition = f"attachment; filename*=UTF-8''{safe_name}"
        else:
            raw_bytes = sanitized

    return Response(
        content=raw_bytes,
        status_code=status.HTTP_200_OK,
        headers={
            "Content-Disposition": content_disposition,
            "Content-Type": mime_type,
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(raw_bytes)),
            "Cache-Control": "public, max-age=3600"
        },
        media_type=mime_type
    )

@router.get("/download/{file_id}")
async def direct_file_download(
    file_id: uuid.UUID,
    range: Optional[str] = Header(None),
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user_query_or_header)
):
    """Directly download file with attachment header."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 다운로드 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.s3_key:
        raise HTTPException(status_code=404, detail="File or storage key not found")

    safe_name = urllib.parse.quote(file_item.name)

    if range:
        res = s3_service.get_object_range(file_item.s3_key, range)
        if res:
            headers = {
                "Content-Range": res["content_range"] or f"bytes 0-{len(res['body'])-1}/{file_item.size_bytes}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(res["body"])),
                "Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}",
                "Content-Type": "application/octet-stream"
            }
            return Response(
                content=res["body"],
                status_code=status.HTTP_206_PARTIAL_CONTENT,
                headers=headers,
                media_type="application/octet-stream"
            )

    raw_bytes = s3_service.get_object_content(file_item.s3_key)
    if raw_bytes is None:
        raise HTTPException(status_code=404, detail="파일 데이터를 찾을 수 없습니다.")

    return Response(
        content=raw_bytes,
        status_code=status.HTTP_200_OK,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{safe_name}",
            "Content-Type": "application/octet-stream",
            "Content-Length": str(len(raw_bytes)),
            "Accept-Ranges": "bytes"
        },
        media_type="application/octet-stream"
    )

@router.get("/thumbnail/{file_id}")
async def get_file_thumbnail(
    file_id: uuid.UUID,
    token: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_approved_user_query_or_header)
):
    """Serve the WebP thumbnail for an image/video file."""
    can_access = await access_service.can_access_file(db, current_user, file_id)
    if not can_access:
        raise HTTPException(status_code=403, detail="파일 접근 권한이 없습니다.")

    file_item = await db.get(FileItem, file_id)
    if not file_item or not file_item.thumbnail_s3_key:
        raise HTTPException(status_code=404, detail="썸네일이 존재하지 않습니다.")

    thumb_bytes = s3_service.get_object_content(file_item.thumbnail_s3_key)
    if not thumb_bytes:
        raise HTTPException(status_code=404, detail="썸네일 데이터를 불러올 수 없습니다.")

    return Response(
        content=thumb_bytes,
        media_type="image/webp",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Type": "image/webp"
        }
    )

